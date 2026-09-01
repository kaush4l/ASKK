#!/usr/bin/env bun
// The one entry point:  bun scripts/probe/run.js
//
// It serves scripts/probe/page/ from a host that sends NO isolation headers,
// stands up a CORP-less recording endpoint beside it, drives real browsers
// through the probes, and writes a dated artifact into scripts/probe/results/.
//
// It is NOT part of `bun run build` and nothing here reaches `out/`: this file
// lives under scripts/, which the Next static export never reads, and it is
// invoked by hand.
//
//   bun scripts/probe/run.js                       every probe the machine can run
//   bun scripts/probe/run.js isolation model       named probes only
//   bun scripts/probe/run.js pty --stages=session,reload
//   bun scripts/probe/run.js model --engines=chromium --modes=require-corp
//   bun scripts/probe/run.js --list                what each probe establishes
//
// Flags: --engines, --modes, --stages, --idle=<s>, --local=<url>, --out=<path>,
//        --port, --echo-port, --guest-port, --no-write.
//
// Every server takes a port flag because two agents probe the same tree at once
// and the defaults collide — an EADDRINUSE from a neighbour's run reads as a
// broken probe otherwise.
//
// Requires `playwright` and its browsers. It is not a dependency of this repo —
// the app does not need it and a 300 MB download does not belong in `bun
// install` — so the probe asks for it and says how to get it.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crossOriginHost, echoServer, staticServer } from './lib/servers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const PAGE_DIR = join(HERE, 'page')
const SANDBOX_DIR = join(ROOT, 'public/sandbox')
const RESULTS_DIR = join(HERE, 'results')

const PROBES = {
  isolation: {
    establishes:
      'cross-origin isolation, SharedArrayBuffer and a blocking Atomics.wait (page, worker, nested worker) on a host that sends no COOP/COEP, and the subresource price of turning it on',
    cannot:
      'anything about https://kaush4l.github.io/ASKK/, Safari.app, iOS or Firefox — this is 127.0.0.1, a secure-context exemption, against a probe page and not the Next export',
    engines: ['chromium', 'webkit'],
    modes: ['off', 'require-corp', 'credentialless'],
  },
  model: {
    establishes:
      "whether the app's real streaming model requests — the preflighted Anthropic POST, an OpenAI-compatible POST with and without a key, and a long local stream read to the last byte — arrive under each COEP mode, from the page and from a nested worker, with a server-side record of whether the CORS preflight was sent",
    cannot:
      'anything about a VALID api key (every key here is deliberately invalid, so what is measured is arrival, not an answer), or about any host other than the three it calls',
    engines: ['chromium', 'webkit'],
    modes: ['off', 'require-corp', 'credentialless'],
  },
  pty: {
    establishes:
      'whether one guest boot survives many commands with blocking stdin, whether its filesystem carries state between them, what a resident guest costs in host RSS, where the input-line boundary is, and whether any of it survives a page reload',
    cannot:
      'anything about src/backend/sandbox/C2wSandbox.js or the built app in out/ — neither is loaded here — and nothing about a phone: this is headless desktop Chromium pulling the whole image over loopback',
    engines: ['chromium'],
    modes: ['require-corp'],
    stages: ['oneshot', 'session', 'bench', 'speed', 'install', 'reload'],
  },
  host: {
    establishes:
      "whether the guest boots from a host that is not the page's own while the page is cross-origin isolated, under each header profile a real host sends; what two real third-party hosts send today; whether a split artifact reassembles to the same bytes; and what the compressed image costs against the raw one",
    cannot:
      'anything about https://kaush4l.github.io/ASKK/ or about what GitHub Pages does with a .gz — nothing here has been deployed. Every server but the two named remote hosts is on 127.0.0.1, so no cross-origin cell here is a measurement of a real connection',
    engines: ['chromium', 'webkit'],
    modes: ['off', 'require-corp'],
  },
}

// ------------------------------------------------------------------ argv
const argv = process.argv.slice(2)
const flags = {}
const names = []
for (const a of argv) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=')
    flags[k] = v ?? true
  } else names.push(a)
}

if (flags.list) {
  for (const [name, p] of Object.entries(PROBES)) {
    console.log(`\n${name}`)
    console.log(`  establishes: ${p.establishes}`)
    console.log(`  cannot say:  ${p.cannot}`)
  }
  process.exit(0)
}

const selected = names.length ? names : Object.keys(PROBES)
for (const n of selected) {
  if (!PROBES[n]) {
    console.error(`unknown probe: ${n}. known: ${Object.keys(PROBES).join(', ')}`)
    process.exit(2)
  }
}
const list = (v, dflt) => (typeof v === 'string' ? v.split(',').filter(Boolean) : dflt)

// ------------------------------------------------------------- playwright
let playwright
try {
  playwright = await import('playwright')
} catch {
  console.error(
    [
      'This probe drives real browsers and needs playwright, which this repo does not depend on.',
      '',
      '  bun add -d playwright && bunx playwright install chromium webkit',
      '',
      'It is deliberately not in package.json: the app does not use it, and it must not',
      'be able to reach a build.',
    ].join('\n'),
  )
  process.exit(2)
}
const LAUNCHERS = {
  chromium: () => playwright.chromium.launch({ headless: true, channel: 'chromium' }),
  webkit: () => playwright.webkit.launch({ headless: true }),
  firefox: () => playwright.firefox.launch({ headless: true }),
}

// ---------------------------------------------------------------- servers
const site = staticServer({ port: Number(flags.port ?? 8811), roots: [PAGE_DIR, SANDBOX_DIR] })
const echo = echoServer({ port: Number(flags['echo-port'] ?? 8814) })
// One port over IS a different origin, and the browser's definition is the one
// every check under test uses. This serves the SAME files as `site`, so a
// difference between the two is the header profile and nothing else.
const guest = crossOriginHost({ port: Number(flags['guest-port'] ?? 8815), dir: SANDBOX_DIR })
const localUrl = typeof flags.local === 'string' ? flags.local : 'http://127.0.0.1:8873'

// ------------------------------------------------------------------ log
const lines = []
const log = (s = '') => {
  const t = String(s)
  lines.push(t)
  console.log(t)
}
const started = new Date()
const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19)

log(`# probe run ${started.toISOString()}`)
log('')
log('```')
log(`entry            bun scripts/probe/run.js ${argv.join(' ')}`.trimEnd())
log(
  `host             ${site.url}   (roots: ${site.roots.map((r) => r.replace(`${ROOT}/`, '')).join(', ')})`,
)
log(`echo endpoint    ${echo.url}   (ACAO *, deliberately no CORP, records what it receives)`)
log(
  `guest host       ${guest.url}   (a SECOND ORIGIN for public/sandbox/, header profile per path)`,
)
log(`local model      ${localUrl}`)
log(`platform         ${process.platform} ${process.arch}, bun ${Bun.version}`)
log(`git              ${gitDescribe()}`)
log(`sandbox.wasm     ${sandboxNote()}`)
log('```')

function gitDescribe() {
  try {
    const rev = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: ROOT })
      .stdout.toString()
      .trim()
    const dirty = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: ROOT })
      .stdout.toString()
      .trim()
    return `${rev}${dirty ? ' (working tree dirty)' : ''}`
  } catch {
    return '(unknown)'
  }
}
function sandboxNote() {
  const parts = []
  for (const name of ['sandbox.wasm', 'sandbox.wasm.gz']) {
    const p = join(SANDBOX_DIR, name)
    parts.push(existsSync(p) ? `${name} ${Bun.file(p).size} bytes` : `${name} (absent)`)
  }
  return `${parts.join(', ')} — build them with scripts/wasm/build.sh`
}

// ------------------------------------------------------------------- run
const cells = []
let failed = 0
try {
  for (const name of selected) {
    const spec = PROBES[name]
    const engines = list(flags.engines, spec.engines)
    const modes = list(flags.modes, spec.modes)
    // `.js`, not `.mjs`: `package.json` is `"type": "module"` so the extension
    // buys nothing, and `biome.json` globs `scripts/**/*.js` — as `.mjs` these
    // four files were 716 lines the lint step could not see, by extension.
    const { run } = await import(`./drivers/${name}.js`)

    log('')
    log(`## ${name}`)
    log('')
    log(`establishes: ${spec.establishes}`)
    log(`cannot say:  ${spec.cannot}`)

    if (name === 'host' && !existsSync(join(SANDBOX_DIR, 'sandbox.wasm.gz'))) {
      log('')
      log('SKIPPED: public/sandbox/sandbox.wasm.gz is absent. Nothing was measured.')
      continue
    }
    if (name === 'pty' && !existsSync(join(SANDBOX_DIR, 'sandbox.wasm'))) {
      log('')
      log('SKIPPED: public/sandbox/sandbox.wasm is absent. Nothing was measured.')
      continue
    }

    for (const engine of engines) {
      for (const mode of modes) {
        log('')
        log(`### ${name} / ${engine} / coep:${mode}`)
        log('')
        log('```')
        try {
          const cell = await run({
            engine,
            launch: LAUNCHERS[engine],
            base: site.url,
            mode,
            echo: {
              url: echo.url,
              read: echo.read,
              reset: () => fetch(`${echo.url}/reset`).catch(() => {}),
            },
            local: { url: localUrl },
            wasmUrl: `${site.url}sandbox.wasm`,
            sandboxDir: SANDBOX_DIR,
            guest: guest.url,
            idleSeconds: Number(flags.idle ?? 30),
            stages: new Set(list(flags.stages, spec.stages ?? [])),
            log,
          })
          cells.push(cell)
        } catch (err) {
          failed++
          log(`DRIVER FAILED: ${err?.stack ?? err}`)
          cells.push({ probe: name, engine, mode, driver_failed: String(err?.message ?? err) })
        }
        log('```')
      }
    }
  }
} finally {
  site.stop()
  echo.stop()
  guest.stop()
}

log('')
log(`finished ${new Date().toISOString()} — ${cells.length} cells, ${failed} driver failures`)

if (!flags['no-write']) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const stem =
    typeof flags.out === 'string' ? flags.out : join(RESULTS_DIR, `${stamp}-${selected.join('+')}`)
  writeFileSync(`${stem}.md`, `${lines.join('\n')}\n`)
  writeFileSync(`${stem}.json`, `${JSON.stringify({ started, argv, cells }, null, 1)}\n`)
  console.log(`\nwrote ${stem}.md`)
  console.log(`wrote ${stem}.json`)
}
process.exit(failed ? 1 : 0)
