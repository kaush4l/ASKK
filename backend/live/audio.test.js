import { expect, test } from "bun:test"
import { audioUrl, chapterUrl, heardOf, lengthText, partsShare, ttsModel } from "./audio.js"

test("the audio view's model: url only when done, lengths, the newest transcript of a file, the tts in use", () => {
  expect(audioUrl({ status: "running", url: null })).toBeNull()
  expect(audioUrl({ status: "done", url: "/__askk/audio/file?id=aud-x-1" })).toContain("/__askk/audio/file?id=aud-x-1")
  expect(lengthText(42.4)).toBe("42 s")
  expect(lengthText(185)).toBe("3 min 05 s")
  const state = { tts: "kokoro", models: { tts: [{ name: "say" }, { name: "kokoro", voices: ["af_heart"] }] }, transcripts: [{ of: "aud-x-1", match: 0.97 }, { of: "aud-x-1", match: 0.5 }] }
  expect(heardOf(state, "aud-x-1").match).toBe(0.97)
  expect(heardOf(state, "aud-x-2")).toBeNull()
  expect(ttsModel(state).voices).toEqual(["af_heart"])
})

test("a long piece: a chapter playable once made, the parts made so far", () => {
  const job = { id: "aud-x-1", parts: { done: 3, total: 12 }, chapters: [{ n: 1, status: "done", url: "/__askk/audio/file?id=aud-x-1&chapter=1" }, { n: 2, status: "running" }] }
  expect(chapterUrl(job, job.chapters[0])).toContain("chapter=1")
  expect(chapterUrl(job, job.chapters[1])).toBeNull()
  expect(chapterUrl({ chapters: [{ n: 1, status: "done" }] }, { n: 1, status: "done" })).toBeNull()
  expect(partsShare(job)).toBe(0.25)
})
