import { afterEach, describe, expect, test } from "bun:test"

import { errorText, teamCall } from "./stream"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const answering = (body, status = 200) => {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("ask-answer: a call's error reaches the page with its text", () => {
  test("errorText reads both shapes, and falls back only when there is no text", () => {
    expect(errorText({ message: "no artifact \"ask\"" })).toBe('no artifact "ask"')
    expect(errorText("could not read talk.js: 404")).toBe("could not read talk.js: 404")
    expect(errorText(undefined)).toBe("Team call failed")
    expect(errorText({})).toBe("Team call failed")
  })

  test("a host-api route error {error: \"<text>\"} throws that text", async () => {
    answering({ error: "Host capabilities answer on localhost only." }, 421)
    await expect(teamCall("artifact", "what", [{ id: "ask" }])).rejects.toThrow("Host capabilities answer on localhost only.")
  })

  test("a team error {ok: false, error: {message}} throws its message", async () => {
    answering({ ok: false, error: { message: "question: what you ask" } })
    await expect(teamCall("artifact", "what", [{ id: "ask" }])).rejects.toThrow("question: what you ask")
  })
})
