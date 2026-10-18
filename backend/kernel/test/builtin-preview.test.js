// The preview artifact (backend/kernel/builtin/preview.js, 2026-10-17) over a fake host: pages through browser/*,
// actions answered with the page's text outline, a prompt of text only, the twin as the spec says.

import { describe, expect, test } from "bun:test"
import { Agent, Preview } from "../index.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-17T14:00:00Z")
function holder(name, preview, host, hold = {}) {
  const agent = new Agent({ name, report: false }, { infer: async () => "", context: { host } }).addArtifact(preview, hold)
  const run = (cmd, input = {}) => agent.tools.get(`${preview.id}.${cmd}`).run(input, { ...agent.context, agent })
  return { agent, run }
}

describe("preview", () => {
  test("open: browser/open with the holder's name; the answer is the page's line and its text outline", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    const out = await coder.run("open", { url: "http://localhost:8001/" })
    expect(host.calls[0]).toEqual({ method: "POST", path: "browser/open", body: { url: "http://localhost:8001/", by: "coder" } })
    expect(host.calls[1]).toMatchObject({ method: "POST", path: "browser/text" })
    expect(out).toMatch(/^▶ page-x-\d+ http:\/\/localhost:8001\/ — "Dashboard" \(opened by coder\) · shot 1\n {2}# Dashboard\n {2}loss 3\.10\n {2}\[button\] Train$/)
    await expect(coder.run("open", { url: "https://example.org" })).rejects.toThrow("browser/open: HTTP 403: only pages on this computer")
  })

  test("the page is the newest open one unless id; click, type, press, scroll, goto act on it and shoot", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await expect(coder.run("click", { selector: "button" })).rejects.toThrow("no page open: preview.open {url} first")
    await coder.run("open", { url: "http://localhost:8001/" })
    const id = preview.state.pages[0].id
    expect(await coder.run("click", { selector: "button#train" })).toContain("· shot 2")
    expect(host.calls.find((c) => c.path === "browser/click").body).toEqual({ id, selector: "button#train" })
    await coder.run("type", { text: "0.01", selector: "#lr" })
    await coder.run("press", { key: "Enter" })
    await coder.run("scroll", { dy: 400 })
    await coder.run("goto", { url: "http://localhost:8001/runs" })
    expect(host.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["browser/open", "browser/text", "browser/click", "browser/text", "browser/type", "browser/text", "browser/press", "browser/text", "browser/scroll", "browser/text", "browser/navigate", "browser/text"])
    expect(preview.state.pages[0]).toMatchObject({ id, url: "http://localhost:8001/runs", shot: { n: 6 } })
    expect(await coder.run("eval", { expression: "document.title" })).toBe('{"expression":"document.title"}')
    expect(await coder.run("shot")).toBe(`shot 7 of ${id} (1280×800) — the owner sees it on the Live preview; you read the page with preview.text`)
    expect(await coder.run("console")).toBe("no console lines")
    expect(await coder.run("close")).toBe(`closed ${id}`)
    expect(preview.state.pages[0].status).toBe("closed")
  })

  test("the prompt is text only: url, title, console errors, the last text outline (≤ 40 lines) — no image, no shot URL", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await coder.run("open", { url: "http://localhost:8001/" })
    const page = host.pages[0]
    page.text = Array.from({ length: 70 }, (_, i) => `row ${i + 1}`).join("\n")
    page.console.push({ level: "log", text: "booted", at: "2026-10-17T14:00:01Z" }, { level: "error", text: "TypeError: x is undefined", at: "2026-10-17T14:00:02Z" })
    page.errors = 1
    await coder.run("text")
    preview.pulled = 0
    await preview.refresh(coder.agent)
    const block = coder.agent.render({ text: "x", from: "owner" }, []).split("# preview — preview — the app's pages\n")[1].split("\n\n# REQUEST")[0]
    const lines = block.split("\n")
    expect(lines[0]).toBe("the app's pages (apps on this computer; you see their text, the owner their screenshots): preview.open, preview.goto, preview.click, preview.type, preview.press, preview.scroll, preview.text, preview.eval, preview.console, preview.shot, preview.close")
    expect(lines[1]).toMatch(/^▶ page-x-\d+ http:\/\/localhost:8001\/ — "Dashboard" \(opened by coder\) · shot 1 · 1 console error$/)
    expect(lines[2]).toBe("  console errors (1, the last 1):")
    expect(lines[3]).toBe("    TypeError: x is undefined")
    expect(lines[4]).toBe("  text (read 14:00:00):")
    const text = lines.filter((l) => /^ {4}row \d+$/.test(l))
    expect(text).toHaveLength(40)
    expect(lines.at(-1)).toBe("    … 30 more lines: preview.text")
    expect(block).not.toContain("/__askk/browser/shot")
    expect(block).not.toMatch(/data:image|base64|\.png/)
  })

  test("the twin: {pages: [the spec's page fields]}, console ≤ 20; changed() only when it changed; a separate preview lists its own", async () => {
    const host = fakeHost()
    const preview = new Preview({ clock })
    const coder = holder("coder", preview, host)
    await coder.run("open", { url: "http://localhost:8001/" })
    for (let i = 0; i < 30; i++) host.pages[0].console.push({ level: "log", text: `line ${i}`, at: "2026-10-17T14:00:00Z" })
    let changes = 0
    preview.onChange(() => changes++)
    preview.pulled = 0
    await preview.refresh(coder.agent)
    const s = preview.twin().state
    expect(Object.keys(s)).toEqual(["pages"])
    expect(Object.keys(s.pages[0])).toEqual(["id", "url", "title", "status", "by", "at", "shot", "console", "errors"])
    expect(Object.keys(s.pages[0].shot)).toEqual(["n", "at", "width", "height", "url"])
    expect(s.pages[0].shot.url).toBe(`/__askk/browser/shot?id=${s.pages[0].id}&n=1`)
    expect(s.pages[0].console).toHaveLength(20)
    expect(Object.keys(s.pages[0].console[0])).toEqual(["level", "text", "at"])
    expect(changes).toBe(1)
    preview.pulled = 0
    await preview.refresh(coder.agent)
    expect(changes).toBe(1)
    const own = new Preview({ id: "lab", separate: true, clock })
    const helper = holder("helper", own, host)
    await helper.run("open", { url: "http://localhost:8002/" })
    own.pulled = 0
    await own.refresh(helper.agent)
    expect(own.state.pages.map((p) => p.url)).toEqual(["http://localhost:8002/"])
    preview.pulled = 0
    await preview.refresh(coder.agent)
    expect(preview.state.pages.map((p) => p.url)).toEqual(["http://localhost:8002/", "http://localhost:8001/"])
    expect(helper.agent.tools.get("lab.open")).toMatchObject({ type: "dev", view: "preview" })
  })
})
