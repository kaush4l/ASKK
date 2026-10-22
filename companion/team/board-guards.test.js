import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SharedBoard } from "../../backend/kernel/index.js"
import { boardFile } from "../shared/paths.js"
import { readBoardFile } from "./board-file.js"
import { parseHistory } from "./kernel-history.js"

test("a team named like a memory folder gets its own folder, never reports/ or practice/", () => {
  expect(boardFile("/m/desk", "reports")).toBe("/m/desk/reports-team/board.md")
  expect(boardFile("/m/desk", "lab")).toBe("/m/desk/lab/board.md")
  expect(boardFile("/m/desk", "../x")).toBe("/m/desk/___x/board.md")
})

test("files saved with \\r\\n line endings still read back", () => {
  const dir = mkdtempSync(join(tmpdir(), "bg-"))
  writeFileSync(join(dir, "board.md"), '# lab\r\n\r\n```json\r\n{"id":"lab.board","entries":{"a":{"text":"x"}}}\r\n```\r\n')
  expect(readBoardFile(join(dir, "board.md")).entries.a.text).toBe("x")
  expect(parseHistory('## run\r\n```json\r\n{"answer":"ok"}\r\n```\r\n')).toEqual([{ answer: "ok" }])
})

test("a hand-edited board entry without text is dropped, not a crash on every prompt", () => {
  const b = new SharedBoard({ team: "lab" })
  b.restore({ entries: { good: { author: "a", text: "fine" }, bad: { author: "b" } } })
  expect(Object.keys(b.state.entries)).toEqual(["good"])
})
