// The host routes the kernel's kit calls, answered in this tab (2026-10-20: the hosted version runs one agent in the
// browser, no desk server): the kit's tools reach the machine only through ctx.host (backend/kernel/builtin/*), so the
// same files and web tools run here unchanged over this object. What a tab can do, it does; the rest says so.
//
//   browserHost({store, fetch?, clock?}) → {get(path, {signal}), post(path, body, {signal}), browser: true}
//     GET  fs/list?path=          {path, entries: [{name, type: file | dir, size, mtime}]}   the workspace in the store
//     GET  fs/read?path=          {path, text, size, mtime, revision}                        (404: not found)
//     POST fs/write {path, text, revision?}  {path, size, mtime, revision, created}          (409: changed since read)
//     GET  fs/tree?path=          {path, entries: [{name, type, children?}]}                 (the Files page)
//     POST fs/delete {path, recursive?, revision?}  {path, type}                             (a folder needs recursive)
//     GET  web/search?q=&limit=&source=      {engine, query, results: [{title, url, snippet, source}], note?}
//                                 wikipedia and hn (their APIs answer a browser); web: both, with a note (a tab has no
//                                 general search engine); arxiv: refused (no browser access)
//     GET  web/read?url=          {url, title, text, truncated}: the page fetched from this tab — only a page that allows
//                                 it (CORS; a Wikipedia article through its API); else 502 saying the desk server reads
//                                 the open web
// Anything else: 501 "not in the browser" (terminal, preview pages, MCP, desks: the desk server's).
// A failure is an Error with .status, as companion/team/compose.js hostClient throws.

const fail = (status, message) => Object.assign(new Error(message), { status })
const READ_CHARS = 40_000
// Addresses web.read never fetches from a tab (2026-10-20 review: a page an agent read could steer it to a router's
// admin page or a local server): this computer, the local network, link-local, *.local / *.localhost / *.internal, and
// IP literals in private ranges — as the desk server's web/read keeps to public addresses.
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}|\[.*\])$/i
export const privateHost = (hostname) => PRIVATE_HOST.test(String(hostname ?? ""))

// A workspace path as stored: forward slashes, no leading slash, no "." or ".." segment, never .env* or .mcp.json.
export function cleanWorkspacePath(raw) {
  const parts = String(raw ?? "").replace(/\\/g, "/").split("/").filter((p) => p && p !== ".")
  if (parts.some((p) => p === "..")) throw fail(400, `path ${raw}: no ".." in a workspace path`)
  const path = parts.join("/")
  if (parts.some((p) => /^\.env/.test(p) || p === ".mcp.json")) throw fail(403, `${path}: never written or read here`)
  return path
}

const revisionOf = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h.toString(16).padStart(8, "0")
}
const size = (text) => new TextEncoder().encode(text).length

// The page's text and title from its HTML (DOMParser in a tab; tags stripped elsewhere).
function pageText(html) {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html")
    for (const el of doc.querySelectorAll("script, style, noscript, svg, nav, footer")) el.remove()
    return { title: doc.title?.trim() ?? "", text: (doc.body?.innerText ?? doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim() }
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ""
  return { title, text: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }
}

export function browserHost({ store, fetch: fetcher = globalThis.fetch?.bind(globalThis), clock = () => Date.now() } = {}) {
  if (!store) throw new Error("browserHost needs a store (backend/browser/storage.js)")
  const files = () => store.keys("fs:").map((k) => k.slice(3))

  function list(path) {
    const dir = cleanWorkspacePath(path)
    const prefix = dir ? `${dir}/` : ""
    if (dir && store.get(`fs:${dir}`)) throw fail(400, `${dir}: not a folder`)
    const seen = new Map()
    for (const p of files()) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length).split("/")
      const name = rest[0]
      if (seen.has(name)) continue
      if (rest.length === 1) {
        const f = store.get(`fs:${p}`) ?? {}
        seen.set(name, { name, type: "file", size: size(f.text ?? ""), mtime: f.mtime ?? 0 })
      } else seen.set(name, { name, type: "dir", size: 0, mtime: 0 })
    }
    if (dir && !seen.size) throw fail(404, `Not found: ${dir}`)
    return { path: dir, entries: [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)) }
  }

  function read(path) {
    const p = cleanWorkspacePath(path)
    const f = store.get(`fs:${p}`)
    if (!f) throw fail(404, `Not found: ${p}`)
    return { path: p, text: f.text, size: size(f.text), mtime: f.mtime, revision: revisionOf(f.text) }
  }

  function write({ path, text, revision } = {}) {
    const p = cleanWorkspacePath(path)
    if (!p) throw fail(400, "path is required")
    if (typeof text !== "string") throw fail(400, "text: the file's whole text")
    const old = store.get(`fs:${p}`)
    if (revision !== undefined && revision !== null && old && revisionOf(old.text) !== revision) throw fail(409, `${p} changed since it was read: read it again`)
    if (revision === null && old) throw fail(409, `${p} exists: read it first`)
    if (files().some((f) => f.startsWith(`${p}/`))) throw fail(400, `${p} is a folder`)
    const mtime = clock()
    if (!store.set(`fs:${p}`, { text, mtime })) throw fail(507, `${p}: this browser's storage is full`)
    return { path: p, size: size(text), mtime, revision: revisionOf(text), created: !old }
  }

  // The Files page's tree (backend/live/workspace.js): folders with their children, files by name.
  function tree(path) {
    const { path: dir, entries } = list(path)
    return { path: dir, entries: entries.map((e) => (e.type === "dir" ? { name: e.name, type: "dir", children: tree(dir ? `${dir}/${e.name}` : e.name).entries } : { name: e.name, type: "file" })) }
  }

  function remove({ path, recursive = false, revision } = {}) {
    const p = cleanWorkspacePath(path)
    if (!p) throw fail(400, "path is required")
    const f = store.get(`fs:${p}`)
    if (f) {
      if (revision !== undefined && revision !== null && revisionOf(f.text) !== revision) throw fail(409, `${p} changed since it was read: read it again`)
      store.remove(`fs:${p}`)
      return { path: p, type: "file" }
    }
    const under = files().filter((k) => k.startsWith(`${p}/`))
    if (!under.length) throw fail(404, `Not found: ${p}`)
    if (!recursive) throw fail(400, `${p} is a folder with files: recursive to delete it`)
    for (const k of under) store.remove(`fs:${k}`)
    return { path: p, type: "dir" }
  }

  async function json(url, signal) {
    let res
    try {
      res = await fetcher(url, { signal })
    } catch (error) {
      if (error?.name === "AbortError") throw error
      throw fail(502, `${new URL(url).host} did not answer this browser`)
    }
    if (!res.ok) throw fail(res.status === 429 ? 429 : 502, `${new URL(url).host}: HTTP ${res.status}`)
    return res.json()
  }
  const wikipedia = async (q, limit, signal) => {
    const r = await json(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`, signal)
    return (r?.query?.search ?? []).map((x) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, snippet: String(x.snippet ?? "").replace(/<[^>]+>/g, ""), source: "wikipedia" }))
  }
  const hn = async (q, limit, signal) => {
    const r = await json(`https://hn.algolia.com/api/v1/search?hitsPerPage=${limit}&query=${encodeURIComponent(q)}`, signal)
    return (r?.hits ?? []).map((x) => ({ title: x.title ?? x.story_title ?? "(untitled)", url: x.url ?? `https://news.ycombinator.com/item?id=${x.objectID}`, snippet: `${x.points ?? 0} points · ${String(x.created_at ?? "").slice(0, 10)}`, source: "hn" }))
  }

  async function search(params, signal) {
    const q = String(params.get("q") ?? "").trim()
    if (!q) throw fail(400, "q: the search terms")
    const limit = Math.min(Math.max(Number(params.get("limit")) || 8, 1), 20)
    const source = params.get("source") || "web"
    if (source === "wikipedia") return { engine: "wikipedia", query: q, results: await wikipedia(q, limit, signal) }
    if (source === "hn") return { engine: "hn", query: q, results: await hn(q, limit, signal) }
    if (source === "arxiv") throw fail(501, "arxiv does not answer a browser: run the desk server for arxiv")
    const [w, h] = await Promise.allSettled([wikipedia(q, limit, signal), hn(q, Math.ceil(limit / 2), signal)])
    const results = [...(w.status === "fulfilled" ? w.value : []), ...(h.status === "fulfilled" ? h.value : [])].slice(0, limit)
    if (!results.length && w.status === "rejected" && h.status === "rejected") throw fail(502, `search failed in this browser (${w.reason?.message}; ${h.reason?.message})`)
    return { engine: "browser", query: q, results, note: "this tab has no general web search: results from wikipedia and hn; web.read a known URL (it must allow browser reads), or run the desk server for the open web" }
  }

  async function readPage(params, signal) {
    const url = String(params.get("url") ?? "").trim()
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      throw fail(400, `url: a full http(s) address (${url || "none"})`)
    }
    if (!/^https?:$/.test(parsed.protocol)) throw fail(400, "url: http or https only")
    if (privateHost(parsed.hostname)) throw fail(403, `${parsed.hostname}: web.read reads public pages only (not this computer or the local network)`)
    // A Wikipedia article: its pages send no CORS headers, its API does — the article's plain text from the extracts API.
    const wiki = parsed.hostname.match(/^([a-z-]+)(?:\.m)?\.wikipedia\.org$/)
    if (wiki && parsed.pathname.startsWith("/wiki/")) {
      const title = decodeURIComponent(parsed.pathname.slice(6))
      const r = await json(`https://${wiki[1]}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`, signal)
      const page = Object.values(r?.query?.pages ?? {})[0]
      if (!page || page.missing !== undefined) throw fail(404, `no Wikipedia article ${title}`)
      const text = String(page.extract ?? "")
      return { url: parsed.href, title: page.title ?? title, text: text.slice(0, READ_CHARS), truncated: text.length > READ_CHARS }
    }
    let res
    try {
      res = await fetcher(parsed.href, { signal })
    } catch (error) {
      if (error?.name === "AbortError") throw error
      throw fail(502, `${parsed.host} does not let a browser page read it (CORS), or did not answer: the desk server reads the open web`)
    }
    if (res.url && privateHost(new URL(res.url).hostname)) throw fail(403, `${parsed.host} redirected to a private address: not read`)
    if (!res.ok) throw fail(502, `${parsed.host}: HTTP ${res.status}`)
    const type = res.headers.get("content-type") ?? ""
    const body = await res.text()
    const { title, text } = /html/.test(type) || /^\s*</.test(body) ? pageText(body) : { title: "", text: body }
    return { url: res.url || parsed.href, title, text: text.slice(0, READ_CHARS), truncated: text.length > READ_CHARS }
  }

  const route = (path) => {
    const [name, query = ""] = String(path).replace(/^\/+/, "").split("?")
    return { name, params: new URLSearchParams(query) }
  }
  return {
    browser: true,
    base: "browser",
    async get(path, { signal } = {}) {
      const { name, params } = route(path)
      if (name === "fs/list") return list(params.get("path") ?? "")
      if (name === "fs/read") return read(params.get("path") ?? "")
      if (name === "fs/tree") return tree(params.get("path") ?? "")
      if (name === "web/search") return search(params, signal)
      if (name === "web/read") return readPage(params, signal)
      throw fail(501, `${name}: not in the browser — the desk server has it (bun run dev)`)
    },
    async post(path, body = {}) {
      const { name } = route(path)
      if (name === "fs/write") return write(body)
      if (name === "fs/delete") return remove(body)
      throw fail(501, `${name}: not in the browser — the desk server has it (bun run dev)`)
    },
  }
}
