import { expect, test } from "bun:test"
import { bestImage, imageUrl, lineage, progress } from "./studio.js"

const S = {
  images: [
    { id: "c", status: "running", step: 5, steps: 20, from: "b", critiques: [] },
    { id: "b", status: "done", from: "a", critiques: [{ score: 8 }] },
    { id: "a", status: "done", critiques: [{ score: 5 }] },
  ],
  picked: null,
}

test("bestImage: the pick, else the best score, else the newest done", () => {
  expect(bestImage(S).id).toBe("b")
  expect(bestImage({ ...S, picked: { image: "a" } }).id).toBe("a")
  expect(bestImage({ images: [{ id: "x", status: "done", critiques: [] }] }).id).toBe("x")
  expect(bestImage({})).toBeNull()
})

test("lineage, progress and the file address", () => {
  expect(lineage(S, "c").map((i) => i.id)).toEqual(["a", "b", "c"])
  expect(progress(S.images[0])).toBe(0.25)
  expect(progress(S.images[1])).toBe(1)
  expect(imageUrl(S.images[0])).toBeNull()
  expect(imageUrl(S.images[1])).toBe("/__askk/image/file?id=b")
})
