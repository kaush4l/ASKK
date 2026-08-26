import { test, expect } from "bun:test"
import { Transcript, COMPACT_PROMPT, SUMMARY_HEADING } from "../core/memory.js"
import { memoryFs } from "../core/ports/memory-fs.js"

/** @typedef {import("../core/ports.js").FsPort} FsPort */

const LOG = "agents/t/log.txt"

/**
 * A Transcript over an in-memory filesystem, with the fs handed back so a test
 * can read what actually landed.
 * @param {object} [options]
 * @param {number} [options.compactAt]
 * @param {number} [options.keepRecent]
 * @param {boolean} [options.stateless]
 * @param {(op: string, path: string) => (Error | null | undefined)} [options.fault]
 * @param {string[]} [options.warnings] collects what the logger was told
 */
function build(options = {}) {
  const fs = memoryFs({ fault: options.fault })
  /** @type {string[]} */
  const warnings = options.warnings ?? []
  const transcript = new Transcript({
    name: "t",
    logPath: LOG,
    stateless: options.stateless,
    compactAt: options.compactAt ?? 4,
    keepRecent: options.keepRecent ?? 2,
    ports: { fs },
    log: { warning: (m) => warnings.push(m), info: () => {} },
  })
  return { transcript, fs, warnings }
}

/** @param {string} answer @returns {{ invoke(prompt: string): Promise<string> }} */
function summarizer(answer) {
  return { async invoke() { return answer } }
}

test("test_transcript — the log is written, compaction runs, the log is rewritten", async () => {
  const { transcript, fs } = build()
  for (let i = 0; i < 4; i++) transcript.add(i % 2 === 0 ? "user" : "assistant", `turn ${i}`)
  await transcript.drain()

  const written = /** @type {string} */ (await fs.read(LOG))
  expect(written.split("turn").length - 1).toBe(4)
  expect(written).toBe(
    "[USER]: turn 0\n\n[ASSISTANT]: turn 1\n\n[USER]: turn 2\n\n[ASSISTANT]: turn 3\n\n",
  )

  expect(await transcript.maybeCompact(summarizer("the summary"))).toBe(true)
  expect(transcript.messages.length).toBe(3)
  expect(transcript.messages[0]?.content).toContain("the summary")
  expect(transcript.messages[0]?.content).toBe(`${SUMMARY_HEADING}\nthe summary`)
  expect(/** @type {string} */ (await fs.read(LOG))).toContain("the summary")
  expect(transcript.component().render()).toBe(`${transcript.lines.join("\n\n")}\n\n`)
})

test("appends land in the order they were made, though the turn never awaits them", async () => {
  const { transcript, fs } = build()
  for (let i = 0; i < 20; i++) transcript.add("user", `turn ${i}`)
  // Nothing has been awaited yet: the turn does not wait on the disk.
  expect(await fs.read(LOG)).toBe(null)
  await transcript.drain()
  const lines = /** @type {string} */ (await fs.read(LOG)).trim().split("\n\n")
  expect(lines).toEqual(Array.from({ length: 20 }, (_, i) => `[USER]: turn ${i}`))
})

test("the summarizer is handed everything but the tail, under COMPACT_PROMPT", async () => {
  const { transcript } = build()
  for (let i = 0; i < 4; i++) transcript.add("user", `turn ${i}`)
  /** @type {string[]} */
  const seen = []
  await transcript.maybeCompact({
    async invoke(prompt) {
      seen.push(prompt)
      return "s1"
    },
  })
  expect(seen[0]).toBe(`${COMPACT_PROMPT}[USER]: turn 0\n\n[USER]: turn 1`)
})

test("the window rolls: the next compaction is handed the previous summary", async () => {
  const { transcript } = build()
  for (let i = 0; i < 4; i++) transcript.add("user", `turn ${i}`)
  await transcript.maybeCompact(summarizer("first summary"))
  transcript.add("user", "turn 4")
  transcript.add("user", "turn 5")

  /** @type {string[]} */
  const seen = []
  await transcript.maybeCompact({
    async invoke(prompt) {
      seen.push(prompt)
      return "second summary"
    },
  })
  expect(seen[0]).toContain(`[SYSTEM]: ${SUMMARY_HEADING}\nfirst summary`)
  expect(transcript.messages.length).toBe(3)
  expect(transcript.messages[0]?.content).toBe(`${SUMMARY_HEADING}\nsecond summary`)
})

test("F-4: a holder of the messages array sees the compaction", async () => {
  const { transcript } = build()
  const held = transcript.messages
  for (let i = 0; i < 4; i++) transcript.add("user", `turn ${i}`)
  await transcript.maybeCompact(summarizer("the summary"))
  expect(held).toBe(transcript.messages)
  expect(held.length).toBe(3)
  expect(held[0]?.content).toContain("the summary")
})

test("a failed summarizer leaves the history and the log alone", async () => {
  const { transcript, fs, warnings } = build()
  for (let i = 0; i < 4; i++) transcript.add("user", `turn ${i}`)
  await transcript.drain()
  const before = await fs.read(LOG)

  const thrower = { async invoke() { throw new Error("no model") } }
  expect(await transcript.maybeCompact(thrower)).toBe(false)
  expect(transcript.messages.length).toBe(4)
  expect(await fs.read(LOG)).toBe(before)
  expect(warnings.some((w) => w.includes("could not compact history"))).toBe(true)
})

test("an empty summary keeps the history", async () => {
  const { transcript, warnings } = build()
  for (let i = 0; i < 4; i++) transcript.add("user", `turn ${i}`)
  expect(await transcript.maybeCompact(summarizer("   "))).toBe(false)
  expect(transcript.messages.length).toBe(4)
  expect(warnings.some((w) => w.includes("summarizer returned nothing"))).toBe(true)
})

test("a summarizer that answers with a response object is read through `answer`", async () => {
  const { transcript } = build()
  for (let i = 0; i < 4; i++) transcript.add("user", `turn ${i}`)
  await transcript.compact({ async invoke() { return { answer: "boxed" } } })
  expect(transcript.messages[0]?.content).toBe(`${SUMMARY_HEADING}\nboxed`)
})

test("an unwritable log costs the log, never the conversation", async () => {
  const { transcript, warnings } = build({ fault: (op) => (op === "append" ? new Error("full") : null) })
  transcript.add("user", "turn 0")
  await transcript.drain()
  expect(transcript.messages.length).toBe(1)
  expect(warnings.some((w) => w.includes("could not append to the log"))).toBe(true)

  const rewrite = build({ fault: (op) => (op === "rename" ? new Error("locked") : null) })
  for (let i = 0; i < 4; i++) rewrite.transcript.add("user", `turn ${i}`)
  expect(await rewrite.transcript.maybeCompact(summarizer("the summary"))).toBe(true)
  expect(rewrite.warnings.some((w) => w.includes("could not rewrite the log"))).toBe(true)
  // The compaction still happened in memory; only the file is stale.
  expect(rewrite.transcript.messages.length).toBe(3)
})

test("stateless writes nothing", async () => {
  const { transcript, fs } = build({ stateless: true })
  transcript.add("user", "turn 0")
  await transcript.drain()
  expect(await fs.read(LOG)).toBe(null)
})

test("clear drops the history and the cached lines", () => {
  const { transcript } = build()
  transcript.add("user", "turn 0")
  transcript.clear()
  expect(transcript.messages.length).toBe(0)
  expect(transcript.lines.length).toBe(0)
  expect(transcript.component().applies()).toBe(false)
})

test("compact does nothing when there is nothing older than the tail", async () => {
  const { transcript } = build()
  transcript.add("user", "turn 0")
  transcript.add("user", "turn 1")
  expect(await transcript.compact(summarizer("unused"))).toBe(false)
  expect(transcript.messages.length).toBe(2)
})

test("compact_at 0 never compacts", async () => {
  const { transcript } = build({ compactAt: 0 })
  for (let i = 0; i < 10; i++) transcript.add("user", `turn ${i}`)
  expect(await transcript.maybeCompact(summarizer("the summary"))).toBe(false)
})

test("keep_recent at or above compact_at is announced at construction", () => {
  const { warnings } = build({ compactAt: 4, keepRecent: 4 })
  expect(warnings[0]).toBe(
    "t: keep_recent=4 is not below compact_at=4, so this agent will never compact",
  )
})

test("COMPACT_PROMPT and SUMMARY_HEADING are the Python's bytes", async () => {
  const source = await Bun.file("/Users/kaush/PycharmProjects/PythonProject1/core/memory.py").text()
  // The Python writes them as adjacent string literals; recovering the value
  // means joining the quoted pieces, which is exactly what the interpreter does.
  const block = /COMPACT_PROMPT = \(\n([\s\S]*?)\n\)/.exec(source)?.[1] ?? ""
  const pieces = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, piece]) =>
    String(piece).replace(/\\n/g, "\n"),
  )
  expect(pieces.length).toBeGreaterThan(0)
  expect(COMPACT_PROMPT).toBe(pieces.join(""))
  expect(source).toContain(`SUMMARY_HEADING = "${SUMMARY_HEADING}"`)
})
