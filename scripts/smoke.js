#!/usr/bin/env bun
/** The browser gate — because 426 green tests once shipped a page that did nothing.
 *
 *     bun run scripts/smoke.js [--dist dist]
 *
 * Two silent defects kept the predecessor's page from ever starting and no unit
 * test could see either: a test runs the modules, and the failure was in what
 * the *browser* does with them. So this drives the built export in a real engine
 * — `Bun.WebView`, headless, no dependency (PORTING-GUIDE §1.9) — over http and
 * not `file://`, because OPFS and workers behave differently on a file origin
 * and the deployed page is served.
 *
 * `document.title` is deliberately not a probe channel: metadata gets reapplied
 * and the probe reads a value that was never the page's state. Every assertion
 * reads DOM the interface actually rendered.
 *
 * Three measured facts shaped this file. `backend: "chrome"` is unusable here —
 * every CDP method, including the one `evaluate()` is built on, answers "wasn't
 * found" — so console capture uses WebKit's `console` option and the error probe
 * is injected by the server below. OPFS throws `UnknownError` on the default
 * ephemeral data store, so each run gets its own `dataStore.directory` and
 * deletes it, which also makes assertion 5 a real first boot every time. And the
 * model address in `agents/models.json` is a port a developer's real server is
 * already listening on — binding it to stub the model fails with EADDRINUSE on
 * exactly the machine this runs on — so the stub is served from the page's own
 * origin and pointed at by writing `agents/models.json` into OPFS before boot,
 * which the page then leaves alone because `app/seed.js` never overwrites.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const argv = Bun.argv.slice(2)
const at = argv.indexOf("--dist")
const DIST = (at === -1 ? undefined : argv[at + 1]) ?? join(dirname(import.meta.dir), "dist")
const NONCE = Bun.randomUUIDv7().slice(-8)
/** Files `app/seed.js` carries in the bundle. Not `agents/models.json`: this run writes that one, so it proves nothing. */
const SEEDED = ["agents/main/agent.md", "core/agents/summarizer/agent.md", "core/agents/verifier/agent.md", "skills/summarize-file/SKILL.md"]

/** Recorded before the page's own module runs — the only way to see an error thrown during boot. Capture phase, so a 404 on a script counts. */
const PROBE = `<script>
window.__smoke = { errors: [], rejections: [] };
addEventListener("error", (e) => __smoke.errors.push(String(e.message || (e.target && (e.target.src || e.target.href)) || e)), true);
addEventListener("unhandledrejection", (e) => __smoke.rejections.push(String((e.reason && e.reason.message) || e.reason)));
</script>`

/** @type {{ n: number, ok: boolean }[]} */
const results = []
/** @param {number} n @param {string} name @param {boolean} ok @param {string} [detail] @returns {void} */
function check(n, name, ok, detail = "") {
  results.push({ n, ok })
  console.log(`${ok ? "PASS" : "FAIL"} ${n}. ${name}${detail ? ` — ${detail}` : ""}`)
}


/** The origin: the export, the error probe, the OPFS pre-seed page, and the
 * stubbed model. One server, because they have to share an origin.
 * @param {string[]} missing @param {{ calls: number }} tally @returns {ReturnType<typeof Bun.serve>} */
function serveOrigin(missing, tally) {
  return Bun.serve({
    port: 0, hostname: "127.0.0.1", idleTimeout: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/v1/chat/completions" || path === "/v1/responses") {
        tally.calls += 1
        const text = `act: answer\n\nresult: ${NONCE}-${tally.calls}`
        return Response.json({ choices: [{ message: { content: text } }], output_text: text })
      }
      if (path === "/smoke-seed") return new Response(seedPage(), { headers: { "content-type": "text/html; charset=utf-8" } })
      const file = Bun.file(join(DIST, path === "/" ? "index.html" : path))
      // A 404 is recorded rather than only answered: "the page asked for
      // worker.js and the build never emitted it" is a defect this has shipped.
      if (!(await file.exists()) && missing.push(path)) return new Response(`no ${path} in the export`, { status: 404 })
      if (!path.endsWith(".html") && path !== "/") return new Response(file)
      return new Response((await file.text()).replace("<head>", `<head>${PROBE}`), { headers: { "content-type": "text/html; charset=utf-8" } })
    },
  })
}

/** One file into OPFS before anything reads it. Relative `base_url`, so it needs no port. @returns {string} */
function seedPage() {
  const models = JSON.stringify({ default: "stub", models: { stub: { model: "smoke-stub", base_url: "/v1", api: "completions" } } })
  return `<!doctype html><title>seed</title><script type="module">
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("agents", { create: true });
    const stream = await (await dir.getFileHandle("models.json", { create: true })).createWritable();
    await stream.write(${JSON.stringify(models)}); await stream.close(); window.__seeded = true;
  </script>`
}

/** @param {Bun.WebView} view @param {string} expression @param {number} ms @returns {Promise<boolean>} */
async function until(view, expression, ms) {
  const deadline = Date.now() + ms
  do {
    if (await view.evaluate(`!!(${expression})`)) return true
  } while ((await Bun.sleep(120)) === undefined && Date.now() < deadline)
  return false
}

/** @param {Bun.WebView} view @param {string} id @returns {Promise<{ chars: number, failure: string }>} */
async function visit(view, id) {
  await view.evaluate(`(location.hash = "#/${id}", 1)`) // the hash is the only route this export has
  await until(view, `document.querySelector('a[data-dest="${id}"][aria-current="page"]')`, 8000)
  await until(view, `document.getElementById("stage").textContent.trim().length > 80`, 8000)
  return /** @type {any} */ (await view.evaluate(`({ chars: document.getElementById("stage").textContent.trim().length,
    failure: document.querySelector("#stage .failure h1")?.textContent ?? "" })`))
}

/** One turn the way a person takes it: type into the composer, send, wait for the
 * answer in the transcript. @param {Bun.WebView} view @param {string} text @param {string} expect @returns {Promise<boolean>} */
async function turn(view, text, expect) {
  if (!(await until(view, `document.querySelector(".composer .send:not([disabled])")`, 60000))) return false
  await view.click("#turn-input")
  await view.type(text)
  await view.click(".composer .send") // Enter maps to an editing command on WebKit; the button is the honest path
  return await until(view, `document.querySelector(".transcript")?.textContent.includes(${JSON.stringify(expect)})`, 90000)
}

/** Read OPFS directly: the interface saying it seeded is not evidence anything was written. @returns {string} */
const opfsScript = () => `(async () => {
  const out = {}; const root = await navigator.storage.getDirectory();
  for (const path of ${JSON.stringify(SEEDED)}) {
    try {
      const parts = path.split("/"); const name = parts.pop(); let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      out[path] = (await (await dir.getFileHandle(name)).getFile()).size;
    } catch { out[path] = 0; }
  } return out; })()`

/** @param {Bun.WebView} view @param {string[]} noise @param {{ calls: number }} tally @param {string[]} missing @returns {Promise<void>} */
async function assertBoot(view, noise, tally, missing) {
  const booted = await until(view, `document.querySelector("#root .frame .stage")?.textContent.trim().length > 0`, 30000)
  const frame = /** @type {any} */ (await view.evaluate(`({ nav: document.querySelectorAll('#root .frame nav a[data-dest]').length,
    failure: document.querySelector("#stage .failure h1")?.textContent ?? "" })`))
  check(1, "the page reaches a booted state", booted && frame.nav === 4 && !frame.failure,
    `${frame.nav} destinations in the rail${frame.failure ? `, stage says "${frame.failure}"` : ""}${missing.length ? `, 404: ${missing.join(" ")}` : ""}`)
  const probe = /** @type {any} */ (await view.evaluate(`window.__smoke ?? { errors: ["the probe never ran"], rejections: [] }`))
  const all = [...noise, ...probe.errors, ...probe.rejections]
  check(2, "no console error and no unhandled rejection during boot", all.length === 0, all.slice(0, 4).join(" | "))
  /** @type {string[]} */ const thin = []
  for (const id of ["converse", "flow", "roster", "bench"]) {
    const seen = await visit(view, id)
    if (seen.chars < 120 || seen.failure) thin.push(`${id}: ${seen.failure || `${seen.chars} chars`}`)
  }
  check(3, "all four destinations render content", thin.length === 0, thin.join(", "))
  await visit(view, "roster")
  const statuses = /** @type {string[]} */ (await view.evaluate(`[...document.querySelectorAll("#stage tbody.rows tr.row")].map((r) => r.dataset.status)`))
  const live = statuses.filter((s) => s !== "starting" && s !== "failed")
  check(4, "an agent worker actually started", live.length > 0, statuses.join(", ") || "the state table has no rows")
  const files = /** @type {Record<string, number>} */ (await view.evaluate(opfsScript()))
  const absent = Object.entries(files).filter(([, size]) => !size).map(([path]) => path)
  check(5, "OPFS was seeded", absent.length === 0, absent.length ? `missing: ${absent.join(", ")}` : `${Object.keys(files).length} bundled files on disk in the browser`)
  await assertTurns(view, tally)
}

/** @param {Bun.WebView} view @param {{ calls: number }} tally @returns {Promise<void>} */
async function assertTurns(view, tally) {
  await visit(view, "converse")
  const answered = await turn(view, `smoke ${NONCE}`, `${NONCE}-1`)
  check(6, "a full turn completes and the answer appears in the transcript", answered, `${tally.calls} call(s) reached the stubbed model`)
  const first = /** @type {any} */ (await view.evaluate(`({ bands: document.querySelectorAll("#stage .bands .band").length,
    bytes: Number((document.querySelector("#stage .totals .metric-value")?.textContent ?? "").replace(/[^0-9]/g, "")) })`))
  const again = answered && (await turn(view, "and again", `${NONCE}-2`))
  const memo = again ? Number(await view.evaluate(`document.querySelectorAll('#stage .bands .band[data-mark="memo"]').length`)) : 0
  check(7, "the inspector shows bands, a byte count and a memo hit on turn two",
    first.bands > 0 && first.bytes > 0 && memo > 0, `${first.bands} bands, ${first.bytes} bytes, ${memo} memo hit(s) on turn two`)
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.log(`FAIL 0. a built export exists at ${DIST} — run \`bun run build\` first`)
    process.exit(1)
  }
  /** @type {string[]} */ const noise = []
  /** @type {string[]} */ const missing = []
  const tally = { calls: 0 }
  const profile = mkdtempSync(join(tmpdir(), "harness-smoke-"))
  const origin = serveOrigin(missing, tally)
  const view = new Bun.WebView({
    headless: true, width: 1440, height: 900, dataStore: { directory: profile },
    console: (type, ...args) => void (type === "error" && noise.push(args.map(String).join(" "))),
  })
  try {
    await view.navigate(`http://127.0.0.1:${origin.port}/smoke-seed`)
    if (!(await until(view, "window.__seeded", 10000))) throw new Error("OPFS is not writable in this WebView — check dataStore")
    await view.navigate(`http://127.0.0.1:${origin.port}/`)
    await assertBoot(view, noise, tally, missing)
  } catch (error) {
    check(0, "the smoke run itself completed", false, error instanceof Error ? error.message : String(error))
  } finally {
    view.close()
    origin.stop(true)
    rmSync(profile, { recursive: true, force: true })
  }
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\n${failed.length} of ${results.length} failed: ${failed.map((r) => r.n).join(", ")}` : `\nall ${results.length} assertions passed`)
  process.exit(failed.length ? 1 : 0)
}

await main()
