import { expect, test } from "bun:test"
import { LiveTree, watchEvent, watchFiles } from "./fs-watch.js"

test("watchEvent: a change's paths, named or typed; anything else is not a change", () => {
  expect(watchEvent("message", '{"type":"change","paths":["a/b.py"]}')).toEqual(["a/b.py"])
  expect(watchEvent("change", '{"paths":["x"]}')).toEqual(["x"])
  expect(watchEvent("message", '{"paths":["y"]}')).toEqual(["y"])
  expect(watchEvent("message", '{"type":"ping"}')).toBeNull()
  expect(watchEvent("message", "nope")).toBeNull()
})

test("watchFiles opens fs/watch for the path and hands over each change", () => {
  let source
  class Fake {
    constructor(url) {
      this.url = url
      source = this
    }
    addEventListener(type, fn) {
      this[`on_${type}`] = fn
    }
    close() {
      this.closed = true
    }
  }
  const seen = []
  const close = watchFiles("projects/llm", (paths) => seen.push(paths), { EventSource: Fake })
  expect(source.url).toBe("/__askk/fs/watch?path=projects%2Fllm")
  source.on_change({ data: '{"paths":["projects/llm/out.txt"]}' })
  source.onmessage({ data: '{"type":"change","paths":[]}' })
  expect(seen).toEqual([["projects/llm/out.txt"], []])
  close()
  expect(source.closed).toBe(true)
})

test("LiveTree: reads the disk when the watch opens, once per burst of changes; a refused watch falls back to the twin", async () => {
  let hooks = null
  let reads = 0
  const watch = (root, onChange, h) => {
    hooks = { ...h, onChange }
    return () => (hooks.closed = true)
  }
  const read = async (root) => {
    reads++
    return { path: root, entries: [{ name: "train.py", type: "file" }, { name: "runs", type: "dir", children: [{ name: `${reads}.log`, type: "file" }] }] }
  }
  const tree = new LiveTree("projects/llm", { read, watch, debounceMs: 5 })
  tree.start()
  expect(tree.getSnapshot().entries).toBeNull() // the twin's tree until the disk answers
  hooks.onOpen()
  await Bun.sleep(15)
  expect(reads).toBe(1)
  expect(tree.getSnapshot()).toMatchObject({ live: true, version: 1 })
  expect(tree.getSnapshot().entries.map((e) => e.path)).toEqual(["projects/llm/train.py", "projects/llm/runs", "projects/llm/runs/1.log"])
  hooks.onChange(["projects/llm/runs/2.log"])
  hooks.onChange(["projects/llm/train.py"])
  await Bun.sleep(15)
  expect(reads).toBe(2)
  expect(tree.getSnapshot().changed.sort()).toEqual(["projects/llm/runs/2.log", "projects/llm/train.py"])
  hooks.onError(true)
  expect(tree.getSnapshot()).toMatchObject({ live: false, entries: null })
  tree.close()
  expect(hooks.closed).toBe(true)
})
