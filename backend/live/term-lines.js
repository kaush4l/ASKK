// A terminal session's text as lines, from the raw PTY chunks term/stream sends (companion/capabilities/terminal.js)
// — pure, browser-safe (no Bun.stripANSI), tested (term-lines.test.js). The host keeps the same line view for
// term/read; this one folds the live chunks in the tab so the Terminal pane shows what a terminal would.
//
//   stripAnsi(text) → text without escape sequences or control characters (\n and \t kept)
//   const view = new LineView({ maxLines, maxChars })
//   view.reset(lines, current?)   start from a snapshot (term/stream's first event)
//   view.write(chunk)             fold one raw chunk in: \n ends a line, \r returns to its start (what follows
//                                 overwrites it: progress bars), \b steps back, ESC[K erases; colours and other
//                                 sequences dropped; a sequence cut between two chunks waits for the next one
//   view.text() → lines to draw (the line being written last, when it has text); view.dropped → lines cut off the top
//
// 2026-10-17: a cursor model, not "replace on \r": "\r\n" split across two chunks must not lose the line, and tqdm
// pads with spaces instead of erasing.

import { LIMITS } from "@/lib/config"

const W = LIMITS.ui.workbench

// One escape sequence or control character. CSI (ESC [ … final) keeps its parameter and final byte for the few the
// line view acts on (K erase, G column).
const TOKEN = /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\|\x1b[()*+#][ -~]|\x1b[^[\]P()*+#]|\r\n|[\r\n\b]|[\x00-\x07\x0b-\x0c\x0e-\x1a\x1c-\x1f\x7f]|\x9b[0-?]*[ -/]*[@-~]|\x1b/g
// A whole sequence at the start of a string (else it is cut and waits for the next chunk).
const COMPLETE = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\|\x1b[()*+#][ -~]|\x1b[^[\]P()*+#])/
const CARRY_MAX = 256 // a "sequence" longer than this is junk, not a cut sequence

export function stripAnsi(text) {
  return String(text ?? "").replace(TOKEN, (t) => (t === "\n" || t === "\r\n" ? "\n" : ""))
}

// [text to fold now, the cut sequence at its end to keep for the next chunk]
function splitCarry(text) {
  const i = text.lastIndexOf("\x1b")
  if (i < 0 || text.length - i > CARRY_MAX || COMPLETE.test(text.slice(i))) return [text, ""]
  return [text.slice(0, i), text.slice(i)]
}

export class LineView {
  constructor({ maxLines = W.terminalLines, maxChars = W.lineChars } = {}) {
    this.maxLines = maxLines
    this.maxChars = maxChars
    this.reset()
  }

  // From a snapshot: its lines are whole (a trailing "" is the empty line after the last \n, not a line); `current`,
  // when the host sends it, is the line still being written.
  reset(lines = [], current = null) {
    const all = (Array.isArray(lines) ? lines : []).map((l) => stripAnsi(l).replace(/\n/g, " "))
    if (current == null && all.at(-1) === "") all.pop()
    this.lines = all.slice(-this.maxLines)
    this.dropped = all.length - this.lines.length
    this.current = current == null ? "" : stripAnsi(current)
    this.col = this.current.length
    this.carry = ""
  }

  write(chunk) {
    const [text, carry] = splitCarry(this.carry + String(chunk ?? ""))
    this.carry = carry
    let last = 0
    for (const m of text.matchAll(TOKEN)) {
      if (m.index > last) this.#put(text.slice(last, m.index))
      this.#control(m)
      last = m.index + m[0].length
    }
    if (last < text.length) this.#put(text.slice(last))
    this.#trim()
  }

  text() {
    return this.current ? [...this.lines, this.current] : [...this.lines]
  }

  // Overwrite from the cursor, as a terminal does.
  #put(s) {
    const cur = this.current.length < this.col ? this.current.padEnd(this.col) : this.current
    this.current = (cur.slice(0, this.col) + s + cur.slice(this.col + s.length)).slice(0, this.maxChars)
    this.col = Math.min(this.col + s.length, this.maxChars)
  }

  #control([t, param = "", final]) {
    if (t === "\n" || t === "\r\n") {
      this.lines.push(this.current)
      this.current = ""
      this.col = 0
    } else if (t === "\r") this.col = 0
    else if (t === "\b") this.col = Math.max(0, this.col - 1)
    else if (final === "K") {
      if (param === "" || param === "0") this.current = this.current.slice(0, this.col)
      else if (param === "1") this.current = " ".repeat(Math.min(this.col, this.current.length)) + this.current.slice(this.col)
      else if (param === "2") this.current = ""
    } else if (final === "G") this.col = Math.min(Math.max(0, (parseInt(param, 10) || 1) - 1), this.maxChars)
    // every other sequence (colours, cursor up/down, titles) has no place in a line view: dropped
  }

  // Cut the top in batches, not one line per \n (splice is O(lines)).
  #trim() {
    if (this.lines.length <= this.maxLines * 1.25) return
    const cut = this.lines.length - this.maxLines
    this.lines.splice(0, cut)
    this.dropped += cut
  }
}
