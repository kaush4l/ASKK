// PROBE 1 — is cross-origin isolation reachable from a header-free host, and
// what does it cost?
//
// Establishes: crossOriginIsolated, SharedArrayBuffer, a genuinely blocking
// Atomics.wait (no timeout) in a worker and in a NESTED worker — the
// page -> backend worker -> sandbox worker shape this tree already has — plus
// the price list: which cross-origin subresources survive COEP and which die.
//
// Cannot establish: anything about the real deploy. Everything here runs on
// 127.0.0.1, which is a secure-context exemption, against a probe page rather
// than the Next static export.

export async function run({ engine, launch, base, mode, log }) {
  const browser = await launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const noise = []
  const probes = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.startsWith('PROBE ')) probes.push(t)
    else noise.push(`[console.${m.type()}] ${t}`)
  })
  page.on('pageerror', (e) => noise.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => noise.push(`[requestfailed] ${r.url().slice(0, 90)} :: ${r.failure()?.errorText}`))

  const cell = { probe: 'isolation', engine, mode }
  try {
    // ---- 404 CONTROL, on the wire, before anything else. If this shows a
    //      COEP header the whole pass is void: the host would be doing the work.
    const ctl = await page.goto(`${base}does-not-exist-${Date.now()}.html`)
    cell.control_404 = {
      status: ctl.status(),
      server: ctl.headers().server,
      coep: ctl.headers()['cross-origin-embedder-policy'] ?? '(absent)',
      coop: ctl.headers()['cross-origin-opener-policy'] ?? '(absent)',
      corp: ctl.headers()['cross-origin-resource-policy'] ?? '(absent)',
    }
    log(`404 CONTROL: status=${cell.control_404.status} server=${cell.control_404.server} coep=${cell.control_404.coep} coop=${cell.control_404.coop} corp=${cell.control_404.corp}`)

    const nav = await page.goto(`${base}isolation.html?coep=${mode}`, { waitUntil: 'load' })
    cell.first_nav = { status: nav.status(), coep_on_wire: nav.headers()['cross-origin-embedder-policy'] ?? '(absent)' }
    log(`FIRST NAV: status=${cell.first_nav.status} coep_on_wire=${cell.first_nav.coep_on_wire}`)
    const firstPaint = await page.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer }))
    cell.first_paint = firstPaint
    log(`FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=${firstPaint.coi} SharedArrayBuffer=${firstPaint.sab}`)

    await page
      .waitForFunction(() => window.__RESULTS?.done === true, null, { timeout: 120000 })
      .catch((e) => log(`WAIT FAILED: ${e.message}`))
    cell.results = await page.evaluate(() => window.__RESULTS)
    for (const [k, v] of cell.results?.steps ?? []) log(`  ${k} = ${JSON.stringify(v)}`)

    // ---- nested worker: page -> worker -> worker, blocking Atomics.wait at depth 2
    cell.nested = await page
      .evaluate(
        () =>
          new Promise((res) => {
            let w
            try {
              w = new Worker('nested-outer.js')
            } catch (e) {
              return res({ err: `outer ctor: ${e}` })
            }
            w.onmessage = (m) => res(m.data)
            w.onerror = (e) => res({ err: `outer onerror: ${e.message || e}` })
            w.postMessage({})
            setTimeout(() => res({ err: 'timeout 20s' }), 20000)
          }),
      )
      .catch((e) => ({ err: String(e).slice(0, 200) }))
    log(`NESTED Atomics.wait (page->worker->worker): ${JSON.stringify(cell.nested)}`)

    // ---- headers on a same-origin subresource, as the SW rewrote them
    cell.sw_headers = await page.evaluate(async () => {
      const r = await fetch(`coi-serviceworker.js?probe=${Date.now()}`)
      return {
        status: r.status,
        coep: r.headers.get('cross-origin-embedder-policy'),
        coop: r.headers.get('cross-origin-opener-policy'),
        corp: r.headers.get('cross-origin-resource-policy'),
      }
    })
    log(`SW-SERVED SAME-ORIGIN HEADERS: ${JSON.stringify(cell.sw_headers)}`)

    // ---- second visit: does isolation survive a reload with no extra navigation?
    const r2 = await page.reload({ waitUntil: 'load' })
    cell.after_reload = {
      status: r2.status(),
      ...(await page.evaluate(() => ({
        coi: self.crossOriginIsolated,
        controller: !!navigator.serviceWorker.controller,
      }))),
    }
    log(`HARD RELOAD: nav_status=${cell.after_reload.status} crossOriginIsolated=${cell.after_reload.coi} sw_controller=${cell.after_reload.controller}`)

    // ---- a brand new context: what does a first-ever visitor pay?
    const ctx2 = await browser.newContext()
    const p2 = await ctx2.newPage()
    const navs = []
    p2.on('framenavigated', (f) => {
      if (f === p2.mainFrame()) navs.push(f.url())
    })
    await p2.goto(`${base}isolation.html?coep=${mode}`, { waitUntil: 'load' })
    const cold0 = await p2.evaluate(() => self.crossOriginIsolated)
    await p2.waitForFunction(() => window.__RESULTS?.done === true, null, { timeout: 120000 }).catch(() => {})
    const cold1 = await p2.evaluate(() => ({ coi: self.crossOriginIsolated, reloads: window.__RESULTS?.reloads_needed }))
    cell.cold_visit = { isolated_at_first_load: cold0, after_sw_install: cold1.coi, reloads_needed: cold1.reloads, navigations: navs.length }
    log(`COLD FIRST VISIT: isolated_at_first_load=${cold0} -> after_sw_install=${cold1.coi} reloads_needed=${cold1.reloads} navigations=${navs.length}`)
  } finally {
    cell.noise = noise
    if (noise.length) {
      log('----- network / console noise -----')
      for (const l of noise) log(`  ${l}`)
    }
    await browser.close()
  }
  return cell
}
