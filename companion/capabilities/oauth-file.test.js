import { afterEach, beforeEach, expect, test } from "bun:test"
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lockFile, oauthHeaders, refresh, unlockFile } from "./oauth-file.js"

let dir, file, server, calls

beforeEach(() => {
  calls = 0
  server = Bun.serve({
    port: 0,
    async fetch() {
      calls++
      await Bun.sleep(50)
      return Response.json({ access_token: `new-${calls}`, expires_in: 3600 })
    },
  })
  dir = mkdtempSync(join(tmpdir(), "oauth-"))
  file = join(dir, "token.json")
  writeFileSync(file, JSON.stringify({ tokens: { access_token: "old", refresh_token: "r1" }, client: { client_id: "c" }, oauth_metadata: { token_endpoint: `http://localhost:${server.port}/token` }, expires_at: 0 }))
})

afterEach(() => {
  server.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

test("concurrent refreshes in one process share one endpoint call (no self-deadlock on the lock)", async () => {
  const [a, b, c] = await Promise.all([oauthHeaders(file), oauthHeaders(file), oauthHeaders(file)])
  expect(calls).toBe(1)
  expect(a.authorization).toBe("Bearer new-1")
  expect(b).toEqual(a)
  expect(c).toEqual(a)
  // the file was rewritten with the new token: the next call reads it fresh, no refresh
  expect((await oauthHeaders(file)).authorization).toBe("Bearer new-1")
  expect(calls).toBe(1)
})

test("a lock another holder keeps is polled, never blocks the event loop, and times out", async () => {
  const fd = openSync(join(dir, ".token.json.lock"), "a", 0o600)
  await lockFile(fd)
  let ticks = 0
  const timer = setInterval(() => ticks++, 20)
  try {
    await expect(refresh(file, { waitMs: 300, pollMs: 20 })).rejects.toThrow(/another program held it/)
    expect(ticks).toBeGreaterThan(5) // timers ran while it waited
    expect(calls).toBe(0)
  } finally {
    clearInterval(timer)
    await unlockFile(fd)
    closeSync(fd)
  }
  // released: the next refresh goes through
  expect((await oauthHeaders(file)).authorization).toBe("Bearer new-1")
})
