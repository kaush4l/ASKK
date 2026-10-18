import { expect, test } from "bun:test"
import { LineView, stripAnsi } from "./term-lines.js"

test("stripAnsi drops colours, titles and control characters, keeps newlines and tabs", () => {
  expect(stripAnsi("\x1b[1;32mok\x1b[0m\tdone\r\nnext")).toBe("ok\tdone\nnext")
  expect(stripAnsi("\x1b]0;title\x07x\x1b(By\x07")).toBe("xy")
})

test("lines end at \\n; colours never reach the text", () => {
  const v = new LineView()
  v.write("\x1b[31mred\x1b[0m line\nsecond\n")
  expect(v.text()).toEqual(["red line", "second"])
})

test("\\r returns to the line's start: a progress bar keeps its last state", () => {
  const v = new LineView()
  v.write("epoch 1  10%\repoch 1  50%\repoch 1 100%\n")
  expect(v.text()).toEqual(["epoch 1 100%"])
  // a shorter rewrite overwrites only what it covers (a terminal does the same); ESC[K erases the rest
  v.write("loss 12.5\rloss 3\x1b[K")
  expect(v.text()).toEqual(["epoch 1 100%", "loss 3"])
})

test("\\r\\n split across two chunks keeps the line", () => {
  const v = new LineView()
  v.write("first\r")
  v.write("\nsecond\r")
  v.write("\n")
  expect(v.text()).toEqual(["first", "second"])
})

test("an escape sequence cut between chunks waits for the next one", () => {
  const v = new LineView()
  v.write("a\x1b[3")
  expect(v.text()).toEqual(["a"])
  v.write("1mb\x1b")
  v.write("[0mc\n")
  expect(v.text()).toEqual(["abc"])
})

test("backspace, erase line and column moves", () => {
  const v = new LineView()
  v.write("abc\bX\n")
  v.write("hello\x1b[2K\rbye\n")
  v.write("12345\x1b[3Gx\n")
  expect(v.text()).toEqual(["abX", "bye", "12x45"])
})

test("a snapshot's lines are whole; a trailing empty line is not a line", () => {
  const v = new LineView()
  v.reset(["one", "two", ""])
  v.write("three\n")
  expect(v.text()).toEqual(["one", "two", "three"])
  v.reset(["one"], "50%")
  v.write("\r60%")
  expect(v.text()).toEqual(["one", "60%"])
})

test("capped: old lines drop off the top and are counted", () => {
  const v = new LineView({ maxLines: 10, maxChars: 8 })
  for (let i = 0; i < 40; i++) v.write(`line ${i}\n`)
  expect(v.text().length).toBeLessThanOrEqual(13)
  expect(v.text().at(-1)).toBe("line 39")
  expect(v.dropped + v.lines.length).toBe(40)
  v.write("x".repeat(50))
  expect(v.current.length).toBe(8)
})
