// PROBE 2 — does the app's REAL model call survive cross-origin isolation?
//
// Establishes: whether the exact requests `src/core/inference/` issues — a
// preflighted streaming POST to api.anthropic.com with x-api-key +
// anthropic-version + anthropic-dangerous-direct-browser-access, the same to an
// OpenAI-compatible endpoint, and a long stream from the local testbed read to
// the last byte — reach JavaScript under COEP off / require-corp /
// credentialless, from the page AND from a nested worker. It also asks the echo
// server, server-side, whether the CORS preflight itself reached the network.
//
// Every pass carries TWO controls, and a cell without both is void:
//   (i)  a browser-executed 404 against our own host, proving no COEP on the wire;
//   (ii) an ENFORCEMENT control — a cross-origin no-CORP <img>. Under a real
//        `require-corp` it MUST fail. If it loads, isolation is not being
//        enforced and every "ARRIVED" below would be an artefact.
//
// Cannot establish: anything about a VALID api key. The keys here are
// deliberately invalid, so what is measured is whether the request arrives, not
// whether it is answered. It also cannot speak for a host other than the three
// it calls.

const CALLS = ['anthropic', 'openai', 'openai_noauth', 'local_short', 'local_long']

export async function run({ engine, launch, base, mode, echo, local, idleSeconds = 30, log }) {
  const browser = await launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const noise = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.startsWith('PROBE ')) log(`  [console] ${t}`)
    else noise.push(`[console.${m.type()}] ${t}`)
  })
  page.on('pageerror', (e) => noise.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => noise.push(`[requestfailed] ${r.method()} ${r.url().slice(0, 72)} :: ${r.failure()?.errorText}`))

  // CDP is the ONLY place a COEP block names itself, and the only place a CORS
  // preflight is visible at all — Playwright's request events never surface one.
  const cdp = []
  if (engine === 'chromium') {
    const s = await ctx.newCDPSession(page)
    await s.send('Network.enable')
    s.on('Network.requestWillBeSent', (e) => {
      if (e.type === 'Preflight' || e.request.method === 'OPTIONS') cdp.push({ k: 'preflight-sent', url: e.request.url.slice(0, 70) })
    })
    s.on('Network.responseReceived', (e) => {
      if (e.type === 'Preflight')
        cdp.push({
          k: 'preflight-resp',
          url: e.response.url.slice(0, 70),
          status: e.response.status,
          corp: e.response.headers['cross-origin-resource-policy'] ?? '(absent)',
          acao: e.response.headers['access-control-allow-origin'] ?? '(absent)',
        })
    })
    s.on('Network.loadingFailed', (e) => {
      cdp.push({ k: 'loadingFailed', type: e.type, err: e.errorText, blockedReason: e.blockedReason ?? null, corsError: e.corsErrorStatus?.corsError ?? null })
    })
  }

  const cell = { probe: 'model', engine, mode }
  try {
    const ctl = await page.goto(`${base}does-not-exist-${Date.now()}.html`)
    cell.control_404 = {
      status: ctl.status(),
      server: ctl.headers().server,
      coep: ctl.headers()['cross-origin-embedder-policy'] ?? '(absent)',
      coop: ctl.headers()['cross-origin-opener-policy'] ?? '(absent)',
      corp: ctl.headers()['cross-origin-resource-policy'] ?? '(absent)',
    }
    log(`404 CONTROL: status=${cell.control_404.status} server=${cell.control_404.server} coep=${cell.control_404.coep} coop=${cell.control_404.coop} corp=${cell.control_404.corp}`)

    await page.addInitScript(
      ([e, l]) => {
        self.PROBE_ECHO = e
        self.PROBE_LOCAL = l
      },
      [echo.url, local.url],
    )
    await page.goto(`${base}model.html?coep=${mode}`, { waitUntil: 'load' })
    let settled = true
    await page.waitForFunction(() => window.__SETTLED === true, null, { timeout: 90000 }).catch((e) => {
      settled = false
      log(`  SETTLE FAILED: ${e.message}`)
    })
    cell.controls = settled ? await page.evaluate(() => window.__CONTROLS) : {}
    cell.coi = await page.evaluate(() => self.crossOriginIsolated)
    cell.reloads = await page.evaluate(() => window.__RELOADS ?? 0)
    log(`crossOriginIsolated=${cell.coi}  SAB=${cell.controls.SAB}  reloads=${cell.reloads}`)
    log(`ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): ${JSON.stringify(cell.controls.enforcement_nocorp_img)}`)

    for (const which of CALLS) {
      const r = await page.evaluate((w) => self.REAL_CALLS[w](), which).catch((e) => ({ driver_error: String(e).slice(0, 200) }))
      cell[which] = r
      log(`PAGE  ${which.padEnd(13)} ${JSON.stringify(r)}`)
    }

    // ---- server-side preflight evidence at a CORP-LESS host
    echo.reset()
    cell.echo = await page.evaluate(() => self.REAL_CALLS.echo()).catch((e) => ({ driver_error: String(e).slice(0, 200) }))
    log(`ECHO (CORP-less, preflighted, SSE) ${JSON.stringify(cell.echo)}`)
    cell.echo_server_saw = echo.read().filter((r) => r.path.startsWith('/v1')).map((r) => ({ method: r.method, path: r.path, origin: r.origin, acrm: r.acrm, acrh: r.acrh, sec_fetch_mode: r.sec_fetch_mode, custom: r.custom }))
    log(`ECHO SERVER RECEIVED: ${JSON.stringify(cell.echo_server_saw)}`)

    // ---- the app's real realm: page -> worker -> worker
    cell.nested_local_short = await page
      .evaluate(
        ([e, l]) =>
          new Promise((res) => {
            let w
            try {
              w = new Worker('nested-outer2.js')
            } catch (err) {
              return res({ err: `outer ctor: ${err}` })
            }
            w.onmessage = (m) => res(m.data)
            w.onerror = (err) => res({ err: `outer onerror: ${err.message || err}` })
            w.postMessage({ which: 'local_short', echo: e, local: l })
            setTimeout(() => res({ err: 'timeout 120s' }), 120000)
          }),
        [echo.url, local.url],
      )
      .catch((e) => ({ err: String(e).slice(0, 200) }))
    log(`NESTED local_short (page->worker->worker) ${JSON.stringify(cell.nested_local_short)}`)

    if (idleSeconds > 0) {
      log(`… idling ${idleSeconds}s while isolated …`)
      await page.waitForTimeout(idleSeconds * 1000)
      cell.local_long_aged = await page.evaluate(() => self.REAL_CALLS.local_long()).catch((e) => ({ driver_error: String(e).slice(0, 200) }))
      log(`AGED local_long (after ${idleSeconds}s isolated) ${JSON.stringify(cell.local_long_aged)}`)
    }

    cell.control_404_end = await page.evaluate(async () => {
      const r = await fetch(`does-not-exist-end-${Date.now()}.html`, { cache: 'no-store' })
      return { status: r.status, coep: r.headers.get('cross-origin-embedder-policy') }
    })
    log(`404 CONTROL (end of pass, in-page through SW): ${JSON.stringify(cell.control_404_end)}`)
  } finally {
    cell.cdp = cdp
    cell.noise = noise
    if (cdp.length) {
      log('----- CDP network events (preflights + blocks) -----')
      for (const e of cdp) log(`  ${JSON.stringify(e)}`)
    }
    if (noise.length) {
      log('----- network / console noise -----')
      for (const l of noise) log(`  ${l}`)
    }
    await browser.close()
  }
  return cell
}
