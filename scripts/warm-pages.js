// Warms the pages a restart leaves cold: scripts/dev.js asks Next for each one on its private origin once it listens, so
// the owner's first load does not wait on a Turbopack compile. One page at a time (each compile has the CPU to itself).
// Never throws: a page that fails is status 0 with its error.
//
//   warmPages("http://127.0.0.1:53211", ["/", "/live"]) → [{ path: "/", status: 200, ms: 4210 }, …]
//   writeWarm("logs/warm.json", results) → {at, pages}: what dev.health shows as the warm line

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export async function warmPages(origin, paths, fetchFn = fetch, now = () => performance.now()) {
  const results = []
  for (const path of paths) {
    const start = now()
    try {
      const response = await fetchFn(`${origin}${path}`)
      await response.arrayBuffer?.() // the page is compiled once its whole body is read
      results.push({ path, status: response.status, ms: Math.round(now() - start) })
    } catch (error) {
      results.push({ path, status: 0, ms: Math.round(now() - start), error: error?.message ?? String(error) })
    }
  }
  return results
}
// What a restart's warm pass found, as logs/warm.json keeps it: every page, a failure (status 0) with its error too.
export function warmReport(results, at = new Date().toISOString()) {
  return { at, pages: results.map(({ path, status, ms, error }) => (error ? { path, status, ms, error } : { path, status, ms })) }
}

export function writeWarm(file, results, at) {
  const report = warmReport(results, at)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  return report
}
