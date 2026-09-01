// PROBE 4 — will the guest run from a host that is not the page's own, and
// does the artifact have to arrive whole?
//
// This exists because the environment this project's whole claim rests on is a
// 404 on the site it deploys to: `public/sandbox/sandbox.wasm` is over GitHub's
// 100 MiB per-file block and the block is on the file AT REST, so the guest is
// in neither the repository nor the Pages branch. `docs/GATE.md` carries both
// sizes and the commands that weigh them. Two ways out were on the table and neither
// had ever been run — put the image on some other host and point the build at
// it (`SANDBOX_IMAGE`), or make the artifact small enough to carry.
//
// Establishes: whether a cross-origin guest fetch survives a cross-origin
// ISOLATED page under each header profile a real host actually sends, what two
// real third-party hosts send today, whether a split artifact reassembles to
// the same bytes, and what the compressed image costs against the raw one.
//
// Cannot establish: anything about https://kaush4l.github.io/ASKK/ or about
// what GitHub Pages does with a `.gz`. Every server here is on 127.0.0.1 except
// the two named remote hosts, and nothing here has ever been deployed. It also
// says nothing about a phone or a real connection: the cross-origin cells pull
// over loopback, which is why the two remote cells are in the table at all.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Real hosts, asked what they send. Neither is ours and neither was uploaded to. */
const REMOTE = [
  [
    'huggingface.co LFS — takes files of any size, and this tree already fetches this host',
    'https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/onnx/encoder_model.onnx',
  ],
  [
    'cdn.jsdelivr.net — a real cross-origin .wasm, fetched and compiled',
    'https://cdn.jsdelivr.net/npm/@jsquash/webp@1.4.0/codec/enc/webp_enc.wasm',
  ],
]

export async function run({ engine, launch, base, mode, log, sandboxDir, guest }) {
  const browser = await launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const noise = []
  page.on('console', (m) => {
    if (m.type() === 'error') noise.push(`[console.error] ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => noise.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) =>
    noise.push(`[requestfailed] ${r.url().slice(0, 100)} :: ${r.failure()?.errorText}`),
  )

  const cell = { probe: 'host', engine, mode }
  const raw = join(sandboxDir, 'sandbox.wasm')
  const gz = join(sandboxDir, 'sandbox.wasm.gz')

  try {
    // The two artifacts, weighed and hashed HERE, so the browser's answers are
    // compared against a number this process derived from the file on disk
    // rather than against another number the browser produced.
    cell.artifacts = {}
    for (const [name, path] of [
      ['sandbox.wasm', raw],
      ['sandbox.wasm.gz', gz],
    ]) {
      if (!existsSync(path)) continue
      cell.artifacts[name] = {
        bytes: statSync(path).size,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      }
      log(`${name}: ${cell.artifacts[name].bytes} bytes  sha256 ${cell.artifacts[name].sha256}`)
    }
    // BOTH, because the ratio needs both. A clone that carries the committed
    // `.gz` and has never run the container build has no raw module at all —
    // which is the state this whole probe argues for — and the earlier version
    // of this line tested the `.gz` and then dereferenced the raw, so it threw
    // `TypeError` in all four cells on exactly the tree it was written to serve.
    const both = cell.artifacts['sandbox.wasm'] && cell.artifacts['sandbox.wasm.gz']
    if (both) {
      const ratio = (
        cell.artifacts['sandbox.wasm'].bytes / cell.artifacts['sandbox.wasm.gz'].bytes
      ).toFixed(2)
      log(`compression: ${ratio}:1, and 100 MiB is 104,857,600 — the block is on the file at rest`)
    } else {
      log('the raw module is not on this disk, so the two rows that fetch it are skipped')
    }

    const control = await page.goto(`${base}does-not-exist-${Date.now()}.html`)
    cell.control_404 = {
      status: control.status(),
      server: control.headers().server,
      coep: control.headers()['cross-origin-embedder-policy'] ?? '(absent)',
      corp: control.headers()['cross-origin-resource-policy'] ?? '(absent)',
    }
    log(
      `404 CONTROL: status=${cell.control_404.status} server=${cell.control_404.server} coep=${cell.control_404.coep} corp=${cell.control_404.corp}`,
    )

    await page.goto(`${base}host.html?coep=${mode}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__READY === true, null, { timeout: 30000 })
    cell.crossOriginIsolated = await page.evaluate(() => self.crossOriginIsolated)
    // The worker's answer, not the page's. Every guest cell below fetches from
    // inside a classic worker, so the page's own isolation would be the wrong
    // realm to report and the inheritance is the thing being assumed.
    cell.worker = await page.evaluate(() => window.__workerIsolation())
    log(`page crossOriginIsolated=${cell.crossOriginIsolated}`)
    log(`classic worker (the realm that fetches the guest): ${JSON.stringify(cell.worker)}`)
    if (mode === 'require-corp' && !cell.crossOriginIsolated)
      log(
        'NOTE: the page did NOT isolate, so every cross-origin row below is the UN-isolated answer',
      )

    // --- the guest, from four places ---------------------------------------
    //
    // Same origin first, as the control that says the guest and this machine
    // are fine, so a failure below is the header profile and not the image.
    const places = [
      ['same origin (what ships today)', `${base}sandbox.wasm.gz`],
      [
        'cross-origin, ACAO * + CORP cross-origin  (the cdnjs / jsDelivr profile)',
        `${guest}/corp/sandbox.wasm.gz`,
      ],
      [
        'cross-origin, ACAO * only, NO CORP        (the huggingface profile)',
        `${guest}/cors/sandbox.wasm.gz`,
      ],
      [
        'cross-origin, no ACAO and no CORP         (the C2 control)',
        `${guest}/bare/sandbox.wasm.gz`,
      ],
      // Only where the raw module exists. It is the price comparison, not the
      // claim; the four rows above are the claim and they need the `.gz` alone.
      ...(both
        ? [['cross-origin, the RAW uncompressed module, ACAO * only', `${guest}/cors/sandbox.wasm`]]
        : []),
    ]
    cell.guest = {}
    for (const [label, url] of places) {
      const answer = await page.evaluate(([u, c]) => window.__runGuest(u, c), [url, 'uname -a'])
      cell.guest[label] = answer
      const line = answer.ok
        ? `ok  ${JSON.stringify(String(answer.stdout).trim().slice(0, 60))} exit=${answer.code} boot=${answer.boot?.ms}ms fetched=${answer.boot?.transferred} inflated=${answer.boot?.bytes} total=${answer.ms}ms`
        : `FAILED at ${answer.where}: ${String(answer.err).slice(0, 160)} (${answer.ms}ms)`
      log(`${label.padEnd(58)} ${line}`)
    }

    // --- what two real hosts actually send ---------------------------------
    cell.remote = {}
    for (const [label, url] of REMOTE) {
      cell.remote[label] = await page.evaluate((u) => window.__fetchOnly(u), url)
      log(`${label}\n  ${JSON.stringify(cell.remote[label])}`)
    }

    // --- does it have to arrive whole? -------------------------------------
    if (cell.artifacts['sandbox.wasm']) {
      const parts = 3
      cell.split = await page.evaluate(
        (urls) => window.__reassemble(urls),
        Array.from({ length: parts }, (_, i) => `${guest}/cors/sandbox.wasm?part=${i}/${parts}`),
      )
      cell.split.matches_whole_file = cell.split.sha256 === cell.artifacts['sandbox.wasm'].sha256
      log(
        `split into ${parts}: ${JSON.stringify(cell.split.parts)} -> ${cell.split.bytes} bytes, ` +
          `sha256 matches the whole file = ${cell.split.matches_whole_file}, ` +
          `WebAssembly.compile = ${cell.split.compiled}, ${cell.split.ms}ms`,
      )
    }

    cell.noise = noise
    for (const n of noise) log(`  ${n}`)
  } finally {
    await browser.close()
  }
  return cell
}
