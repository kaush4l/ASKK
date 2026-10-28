// sandboxRunner (sandbox.js): which sandbox terminal programs run under — macOS sandbox-exec, a container only when
// asked for and actually inside one, else none with the reason (the host then leaves out `term`).
import { describe, expect, test } from "bun:test"
import { SANDBOX_EXEC, sandboxRunner } from "./sandbox.js"

const files = (...present) => (p) => present.includes(p)

describe("sandboxRunner", () => {
  test("macOS with sandbox-exec wraps the program in the profile", () => {
    const r = sandboxRunner({ env: {}, platform: "darwin", exists: files(SANDBOX_EXEC) })
    expect(r.kind).toBe("sandbox-exec")
    expect(r.wrap("(version 1)", ["bun", "test"])).toEqual([SANDBOX_EXEC, "-p", "(version 1)", "bun", "test"])
  })

  test("linux without a sandbox: none, and the reason says how to get one", () => {
    const r = sandboxRunner({ env: {}, platform: "linux", exists: files() })
    expect(r.kind).toBe(null)
    expect(r.reason).toContain("ASKK_SANDBOX=container")
  })

  test("a container only when asked for and inside one", () => {
    const inside = sandboxRunner({ env: { ASKK_SANDBOX: "container" }, platform: "linux", exists: files("/.dockerenv") })
    expect(inside.kind).toBe("container")
    expect(inside.wrap("(version 1)", ["bun", "test"])).toEqual(["bun", "test"])
    expect(sandboxRunner({ env: { ASKK_SANDBOX: "container" }, platform: "linux", exists: files("/run/.containerenv") }).kind).toBe("container")
    // asked for on a bare host: refused (programs would run unsandboxed on the host)
    const bare = sandboxRunner({ env: { ASKK_SANDBOX: "container" }, platform: "linux", exists: files() })
    expect(bare.kind).toBe(null)
    expect(bare.reason).toContain("does not run inside a container")
    // inside a container but not asked for: still none
    expect(sandboxRunner({ env: {}, platform: "linux", exists: files("/.dockerenv") }).kind).toBe(null)
  })

  test("off turns it off even on macOS; an unknown value is refused", () => {
    expect(sandboxRunner({ env: { ASKK_SANDBOX: "off" }, platform: "darwin", exists: files(SANDBOX_EXEC) }).kind).toBe(null)
    const odd = sandboxRunner({ env: { ASKK_SANDBOX: "chroot" }, platform: "darwin", exists: files(SANDBOX_EXEC) })
    expect(odd.kind).toBe(null)
    expect(odd.reason).toContain("chroot")
    expect(sandboxRunner({ env: { ASKK_SANDBOX: "sandbox-exec" }, platform: "darwin", exists: files(SANDBOX_EXEC) }).kind).toBe("sandbox-exec")
  })
})
