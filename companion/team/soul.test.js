// The soul (compose.js readSoul; docs/soul-and-role.md): desks/soul.md for every desk, a desk's own soul.md over it,
// a mounted desk's agents with that desk's soul — the prompt's opening, and on the twin for the agent page.

import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { composeDesk, DEFAULT_SOUL, readSoul } from "./compose.js"

const tmp = mkdtempSync(join(tmpdir(), "soul-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const body = (file) => readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim()
const reply = "VERDICT: ok\nEVIDENCE: 1 (stub, now)\nCONFIDENCE: 0.9\nFALSIFIER: none\nGAPS: none"

function desk(name, { soul, mounts } = {}) {
  const folder = join(tmp, name)
  mkdirSync(join(folder, `${name}-lead`), { recursive: true })
  writeFileSync(join(folder, `${name}-lead`, `${name}-lead.md`), `---\nname: ${name}-lead\n${mounts ? `desks: [${mounts}]\n` : ""}---\nLeads ${name}.\n`)
  writeFileSync(join(folder, "main.js"), "export default () => ({ start: async () => ({}) })\n")
  if (soul != null) writeFileSync(join(folder, "soul.md"), soul)
  return folder
}

describe("readSoul", () => {
  test("the repo's desks/soul.md is the default; frontmatter stays out of the prompt", () => {
    const s = readSoul(desk("plain"))
    expect(s.file).toBe("desks/soul.md")
    expect(s.text).toBe(body(DEFAULT_SOUL))
    expect(s.text.startsWith("---")).toBe(false)
  })

  test("a desk's own soul.md wins", () => {
    const s = readSoul(desk("own", { soul: "---\nname: soul\n---\nYou are the own desk.\n" }))
    expect(s.text).toBe("You are the own desk.")
    expect(s.file.endsWith("own/soul.md")).toBe(true)
  })

  test("the desks root's soul.md (custom/soul.md) is every desk's there; the desk's own still wins", () => {
    const root = join(tmp, "root")
    mkdirSync(join(root, "a"), { recursive: true })
    writeFileSync(join(root, "soul.md"), "You are the custom root.")
    expect(readSoul(join(root, "a")).text).toBe("You are the custom root.")
    writeFileSync(join(root, "a", "soul.md"), "You are a.")
    expect(readSoul(join(root, "a")).text).toBe("You are a.")
  })

  test("no file, or an empty body → null (the prompt opens at # YOU ARE)", () => {
    expect(readSoul(desk("none"), null)).toBeNull()
    expect(readSoul(desk("empty", { soul: "---\nname: soul\n---\n\n" }))).toBeNull()
  })
})

describe("composeDesk", () => {
  test("every agent carries its desk's soul; a mounted desk's agents carry that desk's", async () => {
    desk("ext", { soul: "You are the ext desk." })
    const host = desk("host", { soul: "You are the host desk.", mounts: "ext" })
    const d = await composeDesk({ folder: host, infer: async () => reply })
    const lead = d.agents().get("host-lead")
    const ext = d.agents().get("ext-lead")
    expect(lead.config.soul).toBe("You are the host desk.")
    expect(ext.config.soul).toBe("You are the ext desk.")
    expect(lead.twin()).toMatchObject({ soul: "You are the host desk." })
    expect(lead.twin().soul_file.endsWith("host/soul.md")).toBe(true)
    // the soul opens the prompt, before # YOU ARE
    let prompt = ""
    lead.infer = async (p) => ((prompt ||= p), reply)
    await lead.ask("hello").catch(() => {})
    expect(prompt.startsWith("You are the host desk.")).toBe(true)
    expect(prompt.indexOf("You are the host desk.")).toBeLessThan(prompt.indexOf("# YOU ARE"))
  })
})
