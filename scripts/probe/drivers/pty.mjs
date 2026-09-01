// PROBE 3 — does a pty actually boot in the guest, and what does it cost?
//
// Realm shape: page -> pty-backend.js (realm 2, owns the SharedArrayBuffer and
// the tty host half) -> sandbox-pty.js (realm 3, the guest). `sandbox-pty.js` is
// `public/sandbox/vm-worker.js` with exactly ONE substitution — `patchStdio`
// replaced by upstream container2wasm's `wasiHack` driven by upstream
// xterm-pty's vendored `TtyClient` — which is the experiment's declared
// variable. The WASI shim, `wasi-util.js` and `sandbox.wasm` are served
// straight out of `public/sandbox/`, so they cannot drift from the tree's.
//
// Establishes: whether one boot survives many commands, whether the guest
// filesystem carries state between them, what a resident guest costs in host
// memory, where the input-line boundary is, and whether the state survives a
// page reload.
//
// Cannot establish: anything about the tree's own `C2wSandbox.js`. This is a
// standalone page; `src/backend/sandbox/C2wSandbox.js` and the built app in
// `out/` are never loaded. It also cannot speak for a phone: every pass here is
// headless desktop Chromium pulling ~107 MB over loopback.

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Peak memory the honest way: the browser's own process tree, in KB.
// `performance.measureUserAgentSpecificMemory` is undefined in this Chromium's
// worker realm, so the tab is weighed from outside it.
function rssKB(rootPid) {
  const rows = execSync('ps -axo pid=,ppid=,rss=')
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
  const kids = new Map()
  for (const [pid, ppid, rss] of rows) {
    if (!kids.has(ppid)) kids.set(ppid, [])
    kids.get(ppid).push([pid, rss])
  }
  let total = 0
  let n = 0
  const walk = (pid) => {
    for (const [c, rss] of kids.get(pid) ?? []) {
      total += rss
      n++
      walk(c)
    }
  }
  walk(rootPid)
  return { totalKB: total, procs: n }
}

export async function run({ engine, launch, base, wasmUrl, log, stages }) {
  const browser = await launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const noise = []
  page.on('console', (m) => noise.push(`[console.${m.type()}] ${m.text().slice(0, 200)}`))
  page.on('pageerror', (e) => noise.push(`[pageerror] ${e.message}`))
  page.on('response', (r) => {
    if (!r.url().endsWith('sandbox.wasm')) return
    noise.push(`[wasm] status=${r.status()} ct=${r.headers()['content-type']} coep=${r.headers()['cross-origin-embedder-policy'] ?? '(absent)'}`)
  })

  const cell = { probe: 'pty', engine }
  const MB = (kb) => `${(kb / 1024).toFixed(1)} MB`
  try {
    const ctl = await page.goto(`${base}does-not-exist-${Date.now()}.html`)
    cell.control_404 = {
      status: ctl.status(),
      server: ctl.headers().server,
      coep: ctl.headers()['cross-origin-embedder-policy'] ?? '(absent)',
      coop: ctl.headers()['cross-origin-opener-policy'] ?? '(absent)',
    }
    log(`404 CONTROL: status=${cell.control_404.status} server=${cell.control_404.server} coep=${cell.control_404.coep} coop=${cell.control_404.coop}`)

    const baseline = rssKB(process.pid)
    cell.baseline_rss_kb = baseline.totalKB
    log(`BASELINE browser RSS (page not yet loaded) = ${baseline.totalKB} KB over ${baseline.procs} processes`)

    const nav = await page.goto(`${base}pty.html`, { waitUntil: 'load' })
    log(`FIRST NAV: status=${nav.status()} coep_on_wire=${nav.headers()['cross-origin-embedder-policy'] ?? '(absent)'}`)
    await page.waitForFunction(() => window.__STATE?.ready, null, { timeout: 90000 })
    cell.isolation = await page.evaluate(() => window.__STATE)
    log(`ISOLATION: coi=${cell.isolation.coi} reloads=${cell.isolation.reloads} sw=${cell.isolation.sw}`)
    const call = (op, args) => page.evaluate((m) => window.__CALL(m.op, m.args), { op, args: args ?? {} })
    cell.backend_realm = await call('env')
    log(`BACKEND REALM (page->worker): ${JSON.stringify(cell.backend_realm)}`)

    // ---- STAGE oneshot: the tree's own one-shot path, under isolation ------
    if (stages.has('oneshot')) {
      cell.oneshot = []
      for (const file of ['vm-worker.js', 'vm-worker-streaming.js']) {
        log(`\n===== ONE-SHOT via ${file} (page -> backend worker -> sandbox worker) =====`)
        const b = rssKB(process.pid)
        let peak = b.totalKB
        const sampler = setInterval(() => {
          const s = rssKB(process.pid)
          if (s.totalKB > peak) peak = s.totalKB
        }, 200)
        const t = Date.now()
        const r = await call('oneshot', { file: `./${file}`, wasmUrl, command: 'uname -a; echo RC=$?', measure: true })
        clearInterval(sampler)
        const row = { file, wallMs: Date.now() - t, peakDeltaKB: peak - b.totalKB, ...r }
        cell.oneshot.push(row)
        log(`PEAK browser RSS = ${peak} KB  (delta over baseline = ${peak - b.totalKB} KB = ${MB(peak - b.totalKB)})`)
        log(`wall ms       = ${row.wallMs}`)
        log(`bootMs        = ${r.bootMs}   (fetch + compile)`)
        log(`runMs         = ${r.runMs}    (instantiate + whole guest boot + command)`)
        log(`bytes         = ${r.bytes}`)
        log(`exit code     = ${r.code}   trap=${r.trap ?? '(none)'}`)
        log(`stubbed       = ${JSON.stringify(r.stubbed)}`)
        log(`STDOUT >>>\n${r.stdout}\n<<< STDOUT`)
      }
    }

    // ---- STAGE session: ONE boot, many commands, state carried between them
    if (stages.has('session')) {
      log('\n===== PTY BOOT: one guest, blocking stdin =====')
      const beforeBoot = rssKB(process.pid)
      log(`RSS after page load, before ptyBoot = ${beforeBoot.totalKB} KB`)
      cell.boot = await call('ptyBoot', { wasmUrl, argv: [] })
      log(`ptyBoot -> ${JSON.stringify(cell.boot)}`)
      const first = await call('settle', { quiet: 3000, max: 240000 })
      cell.prompt_ms = first.ms
      log(`FIRST OUTPUT (${first.ms} ms, timedOut=${first.timedOut}):`)
      log(`--- rendered ---\n${first.text}\n--- end ---`)
      const atPrompt = rssKB(process.pid)
      cell.resident_at_prompt_kb = atPrompt.totalKB
      log(`RSS with guest RESIDENT at prompt = ${atPrompt.totalKB} KB (delta over baseline = ${MB(atPrompt.totalKB - cell.baseline_rss_kb)})`)

      // THE DECIDING TEST: does the filesystem survive between commands?
      cell.session = []
      for (const c of ['echo hello > /tmp/a\n', 'cat /tmp/a\n', 'ls -la /tmp\n']) {
        const r = await call('line', { text: c, quiet: 2000, max: 240000 })
        cell.session.push({ cmd: c, ms: r.ms, text: r.text })
        log(`\n$ ${JSON.stringify(c)}   -> ${r.ms} ms (wall ${r.wallMs}, timedOut=${r.timedOut})`)
        log(r.text)
      }
      cell.stats_after_session = await call('stats')
      log(`\nstats: ${JSON.stringify(cell.stats_after_session)}`)

      // GAP CLOSED (refuter lens 3): the resident guest was never weighed.
      const after3 = rssKB(process.pid)
      cell.resident_after_3_cmds_kb = after3.totalKB
      log(`RSS after 3 commands, guest STILL RESIDENT = ${after3.totalKB} KB (delta ${MB(after3.totalKB - cell.baseline_rss_kb)})`)
      await page.waitForTimeout(20000)
      const idle = rssKB(process.pid)
      cell.resident_after_20s_idle_kb = idle.totalKB
      log(`RSS after 20 s IDLE with guest resident = ${idle.totalKB} KB (delta ${MB(idle.totalKB - cell.baseline_rss_kb)})`)

      // GAP CLOSED (refuter lens 3): what IS the store that "survives"?
      const store = await call('line', { text: 'df -h / /tmp 2>&1 | head -5; mount | head -4; free | head -2\n', quiet: 2500, max: 240000 })
      cell.store = store.text
      log(`\n$ df / mount / free  -> ${store.ms} ms\n${store.text}`)
    }

    // ---- STAGE bench: cost per command once the boot is paid ---------------
    if (stages.has('bench')) {
      log('\n===== ten commands on ONE boot =====')
      const times = []
      for (let i = 1; i <= 10; i++) {
        const r = await call('line', { text: `echo n${i}\n`, quiet: 1200, max: 120000 })
        times.push(r.ms)
      }
      cell.times = times
      log(`TIMES = ${JSON.stringify(times)}`)

      log('\n===== the input-line boundary, binary-searched to the byte =====')
      cell.line_boundary = []
      for (const n of [2033, 2034, 2035, 2040, 2048, 4096]) {
        const r = await call('lineP', { text: `echo ${'x'.repeat(n)} | wc -c\n`, max: 300000 })
        const m = r.text.match(/\n(\d+)\r?\n/)
        const row = { payload: n, lineBytes: n + 14, wc: m ? m[1] : null }
        cell.line_boundary.push(row)
        log(`line of ${n + 14} bytes (incl newline) -> wc -c = ${m ? m[1] : 'LINE LOST'}`)
      }

      log('\n===== a heredoc has no such cap =====')
      const big = Array.from({ length: 400 }, (_, i) => `echo line ${i} >> /tmp/big.out`).join('\n')
      const hd = await call('lineP', { text: `cat > /tmp/big.sh <<'EOF'\n${big}\nEOF\n`, max: 900000 })
      const ran = await call('lineP', { text: 'sh /tmp/big.sh; wc -l /tmp/big.out; tail -1 /tmp/big.out\n', max: 900000 })
      cell.heredoc = { bodyBytes: big.length, writeMs: hd.ms, result: ran.text }
      log(`heredoc body = ${big.length} bytes over 400 lines, written in ${hd.ms} ms`)
      log(ran.text)
    }

    // ---- STAGE speed: the guest against the identical binary, natively -----
    if (stages.has('speed')) {
      log('\n===== how much slower is the guest? (same busybox, same bytes) =====')
      const arch = await call('lineP', { text: 'uname -m; busybox | head -1\n', max: 300000 })
      log(`guest: ${arch.text.replace(/\r/g, '')}`)
      await call('lineP', { text: 'dd if=/dev/zero of=/tmp/8m bs=1M count=8 2>/dev/null; echo made\n', max: 900000 })
      const work = [
        ['awk 1e6 loop', "awk 'BEGIN{s=0;for(i=0;i<1000000;i++)s+=i;print s}'"],
        ['sha256sum 8MB', 'sha256sum /tmp/8m'],
        ['gzip -c 8MB', 'gzip -c /tmp/8m | wc -c'],
      ]
      cell.speed = []
      for (const [label, cmd] of work) {
        const r = await call('lineP', { text: `${cmd}\n`, max: 1200000 })
        log(`[guest] ${label}: host-observed ${r.ms} ms`)
        log(r.text.replace(/\r/g, ''))
        cell.speed.push({ label, cmd, guestMs: r.ms, guestOut: r.text })
      }
      // The native control, on this machine, same image, same bytes. Its
      // architecture is NOT the guest's — disclosed, because it matters.
      let nativeArch = '(docker unavailable)'
      try {
        nativeArch = execSync("docker run --rm alpine:3.21 sh -c 'uname -m; busybox | head -1'", { timeout: 120000 }).toString().trim()
      } catch (e) {
        log(`NATIVE CONTROL UNAVAILABLE: ${String(e).slice(0, 160)}`)
      }
      log(`\nnative control: ${nativeArch.replace(/\n/g, ' | ')}`)
      cell.native = { arch: nativeArch, rows: [] }
      if (!nativeArch.startsWith('(')) {
        const script = "dd if=/dev/zero of=/tmp/8m bs=1M count=8 2>/dev/null; " +
          "time awk 'BEGIN{s=0;for(i=0;i<1000000;i++)s+=i;print s}'; " +
          'time sha256sum /tmp/8m; time gzip -c /tmp/8m | wc -c'
        const out = execSync(`docker run --rm alpine:3.21 sh -c ${JSON.stringify(script)} 2>&1`, { timeout: 300000 }).toString()
        log(out)
        cell.native.rows = out
      }
    }

    // ---- STAGE install: can a running page add a binary to its own guest? --
    if (stages.has('install')) {
      log('\n===== install a real .apk into the LIVE guest, delivered over the tty =====')
      const apk = join(HERE, '../fixtures/tree-2.2.1-r0.apk')
      if (!existsSync(apk)) {
        log('SKIPPED: scripts/probe/fixtures/tree-2.2.1-r0.apk is absent. Nothing was measured.')
      } else {
        const bytes = readFileSync(apk)
        const md5 = createHash('md5').update(bytes).digest('hex')
        // WRAPPED AT 76 COLUMNS, and this is not cosmetic. An unwrapped
        // base64 blob is one 40,424-byte input line, and the bench stage two
        // sections up measures a line of 2,048 bytes vanishing without a word.
        // The first run of this stage sent it unwrapped and got
        // `base64: truncated input`, a wrong md5 and `BAD archive` — a real
        // failure caused by a limit this same probe had just measured.
        const b64 = (bytes.toString('base64').match(/.{1,76}/g) ?? []).join('\n')
        log(`host package: ${bytes.length} bytes, md5 ${md5}, ${b64.length} base64 bytes wrapped at 76 columns`)
        const before = await call('lineP', { text: 'apk info | wc -l; apk info -e tree; echo TREE_PRESENT=$?; ls -la /usr/bin/tree 2>&1\n', max: 300000 })
        log(`BEFORE:\n${before.text}`)
        const t0 = Date.now()
        const fed = await call('lineP', { text: `cat > /tmp/t.b64 <<'XEOFX'\n${b64}\nXEOFX\n`, max: 900000 })
        const kbs = b64.length / (fed.ms / 1000) / 1024
        log(`delivered ${b64.length} base64 bytes in ${fed.ms} ms = ${kbs.toFixed(2)} KB/s (timedOut=${fed.timedOut})`)
        const inst = await call('lineP', { text: 'base64 -d /tmp/t.b64 > /tmp/t.apk; md5sum /tmp/t.apk; apk add --allow-untrusted /tmp/t.apk 2>&1 | tail -3\n', max: 900000 })
        log(inst.text)
        const after = await call('lineP', { text: 'apk info | wc -l; apk info -e tree; echo TREE_PRESENT=$?; ls -la /usr/bin/tree; tree --version\n', max: 300000 })
        log(`AFTER:\n${after.text}`)
        const net = await call('lineP', { text: 'ip addr 2>&1 | head -6; cat /etc/resolv.conf 2>&1; apk update 2>&1 | head -4\n', max: 600000 })
        log(`\nand from a REPOSITORY, on the same live shell:\n${net.text}`)
        cell.install = { hostBytes: bytes.length, hostMd5: md5, deliverMs: fed.ms, kbPerSec: Number(kbs.toFixed(2)), before: before.text, install: inst.text, after: after.text, network: net.text, totalMs: Date.now() - t0 }
      }
    }

    // ---- STAGE reload: the run nobody executed ----------------------------
    if (stages.has('reload')) {
      log('\n===== THE RELOAD: page.reload(), same tab, same context =====')
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => window.__STATE?.ready, null, { timeout: 90000 })
      const st2 = await page.evaluate(() => window.__STATE)
      log(`after reload: coi=${st2.coi} reloads=${st2.reloads}`)
      const afterReloadIdle = rssKB(process.pid)
      cell.rss_after_reload_no_guest_kb = afterReloadIdle.totalKB
      log(`RSS right after reload, NO guest running = ${afterReloadIdle.totalKB} KB (delta over baseline ${MB(afterReloadIdle.totalKB - cell.baseline_rss_kb)})`)
      const call2 = (op, args) => page.evaluate((m) => window.__CALL(m.op, m.args), { op, args: args ?? {} })
      const t = Date.now()
      await call2('ptyBoot', { wasmUrl, argv: [] })
      const first2 = await call2('settle', { quiet: 3000, max: 240000 })
      cell.reboot_prompt_ms = first2.ms
      log(`RE-BOOT after reload: prompt after ${first2.ms} ms (wall ${Date.now() - t} ms)`)
      cell.after_reload = []
      for (const c of ['cat /tmp/a; echo RC=$?\n', 'ls -la /tmp\n']) {
        const r = await call2('line', { text: c, quiet: 1500, max: 240000 })
        cell.after_reload.push({ cmd: c, text: r.text })
        log(`$ ${JSON.stringify(c)} -> ${r.ms} ms\n${r.text}`)
      }
    }
  } finally {
    cell.noise = noise
    if (noise.length) {
      log('----- console / network -----')
      for (const l of noise) log(`  ${l}`)
    }
    await browser.close()
  }
  return cell
}
