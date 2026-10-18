// Toolchains (toolchains.js): 2026-10-17 every package cache a session may write is the desk's own folder, set by
// environment; the user's caches (~/.bun/install/cache, ~/.npm/_cacache, ~/.cache/uv, ~/.cargo/registry, …) are never
// writable, and the config a toolchain reads at its start inside a private cache is never written either. Real
// sandbox-exec probes in a folder under ~/.askk/tmp, removed after.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { sandboxProfile } from "./sandbox.js"
import { catalogue, detectToolchains, TOOLCHAIN_IDS } from "./toolchains.js"

const base = join(homedir(), ".askk", "tmp")
mkdirSync(base, { recursive: true })
const top = realpathSync(mkdtempSync(join(base, "toolchains-test-")))
afterAll(() => rmSync(top, { recursive: true, force: true }))
const cache = join(top, "caches", "desk")
const HOME = homedir()
const GLOBAL = [".bun/install/cache", ".npm/_cacache", ".npm", ".cache/uv", ".local/share/uv/python", ".cargo/registry", ".cargo", ".m2/repository", ".gradle", "Library/Caches/pip", "Library/pnpm/store"].map((d) => join(HOME, d))

describe("desk-private caches", () => {
  test("every toolchain writes only under the desk's cache folder", () => {
    const chains = catalogue(cache)
    expect(Object.keys(chains)).toEqual(TOOLCHAIN_IDS)
    for (const [id, chain] of Object.entries(chains)) {
      for (const dir of chain.writable) expect(dir.startsWith(`${cache}/`), `${id}: ${dir}`).toBe(true)
      for (const dir of chain.writable) for (const g of GLOBAL) expect(dir === g || dir.startsWith(`${g}/`), `${id}: ${dir}`).toBe(false)
    }
  })

  test("the caches are pointed there by environment", () => {
    const chains = catalogue(cache)
    expect(chains.python.env).toMatchObject({ UV_CACHE_DIR: join(cache, "uv"), UV_PYTHON_INSTALL_DIR: join(cache, "uv-python"), PIP_CACHE_DIR: join(cache, "pip") })
    expect(chains.javascript.env).toMatchObject({ BUN_INSTALL_CACHE_DIR: join(cache, "bun"), npm_config_cache: join(cache, "npm") })
    expect(chains.rust.env).toMatchObject({ CARGO_HOME: join(cache, "cargo") })
    expect(chains.java.env).toMatchObject({ GRADLE_USER_HOME: join(cache, "gradle"), MAVEN_OPTS: `-Dmaven.repo.local=${join(cache, "m2", "repository")}` })
    // every variable that names a folder names one of the toolchain's writable folders (or one inside)
    for (const [id, chain] of Object.entries(chains)) {
      for (const [key, value] of Object.entries(chain.env)) {
        if (!value.startsWith("/") || key === "JAVA_HOME") continue
        expect(chain.writable.some((w) => value === w || value.startsWith(`${w}/`)), `${id} ${key}`).toBe(true)
      }
    }
  })

  test("detectToolchains makes the found toolchains' folders and returns their env, writable and never lists", () => {
    const found = detectToolchains(TOOLCHAIN_IDS, { cache })
    expect(found.cache).toBe(cache)
    for (const dir of found.writable) expect(existsSync(dir)).toBe(true)
    if (found.found.some((c) => c.id === "rust")) {
      expect(found.env.CARGO_HOME).toBe(join(cache, "cargo"))
      expect(found.never).toContain(join(cache, "cargo", "config.toml"))
    }
    if (found.found.some((c) => c.id === "python")) expect(found.env.UV_CACHE_DIR).toBe(join(cache, "uv"))
  })

  test("under the sandbox: the private cache is written, a global cache and a private cache's config are not", () => {
    const chains = catalogue(cache)
    const writable = [...chains.rust.writable, ...chains.javascript.writable]
    for (const dir of writable) mkdirSync(dir, { recursive: true })
    const root = join(top, "work")
    mkdirSync(root, { recursive: true })
    const tmp = join(top, "tmp")
    mkdirSync(tmp, { recursive: true })
    const profile = sandboxProfile(root, writable, null, { tmp, never: chains.rust.never })
    const touch = (path) => Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", profile, "/usr/bin/touch", path], { stderr: "pipe" }).exitCode
    expect(touch(join(cache, "bun", "ok"))).toBe(0)
    expect(touch(join(cache, "cargo", "registry-ok"))).toBe(0)
    expect(touch(join(cache, "cargo", "config.toml"))).not.toBe(0)
    expect(existsSync(join(cache, "cargo", "config.toml"))).toBe(false)
    for (const dir of GLOBAL.filter((d) => existsSync(d))) {
      const probe = join(dir, `askk-sandbox-probe-${process.pid}`)
      try {
        expect(touch(probe), dir).not.toBe(0)
        expect(existsSync(probe)).toBe(false)
      } finally {
        rmSync(probe, { force: true })
      }
    }
  })
})
