// The local-model route's messages → content blocks (2026-10-18: the preview's screenshots reach the Claude CLI as
// stream-json image blocks): data: URLs only, never a remote address.
import { describe, expect, test } from "bun:test"
import { chatBlocks } from "./local-models.js"

describe("chatBlocks (the host's local-model route)", () => {
  test("text and data: images in their order; a remote image URL or another type is dropped, never fetched", () => {
    const blocks = chatBlocks([
      { role: "user", content: "first" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          { type: "image_url", image_url: { url: "https://evil.example/x.png" } },
          { type: "image_url", image_url: { url: "data:text/html;base64,PGgxPg==" } },
        ],
      },
    ])
    expect(blocks).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ])
  })
})
