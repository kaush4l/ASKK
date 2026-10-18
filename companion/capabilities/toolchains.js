// Toolchains a desk's terminal sessions may use (capability `term`, companion/capabilities/terminal.js), detected on
// this machine the first time a session starts. 2026-10-17: moved from a desk's own tools to the host.
// A desk names toolchains (its main.js `terminal: { toolchains: ["python", "rust", …] }`);
// each one found adds its programs, bin folders (PATH), cache folders the sandbox
// may write, and environment. A toolchain that is not installed is left out (and
// listed as missing), so the same desk runs on any machine with whatever it has.
//
// 2026-10-17: package caches are the desk's own (`cache`: ~/.askk/caches/<desk>/, outside every workspace and the
// repo), never the user's: a sandboxed program that wrote ~/.bun/install/cache, ~/.npm/_cacache, ~/.cache/uv or
// ~/.cargo/registry would plant code that an unsandboxed install trusts later. Each toolchain points its caches there
// by environment (BUN_INSTALL_CACHE_DIR, npm_config_cache, UV_CACHE_DIR, UV_PYTHON_INSTALL_DIR, CARGO_HOME, …); those
// folders are the only writable ones, the user's caches stay readable (pythons uv installed there run from PATH) and
// are never written. A config file inside a private cache that the toolchain reads at its start (CARGO_HOME's
// config.toml, GRADLE_USER_HOME's init.d) is never written either (`never`).
//
//   detectToolchains(["python", "java"], { cache }) → { programs, path, writable, never, env, cache, found: [{ id, version, programs }], missing: [id] }
//   catalogue(cache) → { id: { programs, wrappers?, bins, writable, never?, env, version } }

import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, join } from "node:path"

const HOME = homedir()
const h = (...parts) => join(HOME, ...parts)
export const CACHES = h(".askk", "caches") // <CACHES>/<desk>: a desk's own package caches

// Programs every toolchain may use (files, git, fetching a starter).
const BASE = ["git", "ls", "cat", "head", "tail", "wc", "grep", "find", "mkdir", "echo", "which", "tree", "curl", "unzip", "tar", "diff"]
const SYSTEM_BINS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]

function nvmBins() {
  const dir = h(".nvm/versions/node")
  try {
    return readdirSync(dir).sort().reverse().map((v) => join(dir, v, "bin"))
  } catch {
    return []
  }
}

// The JDK: JAVA_HOME, else macOS java_home, else the java on PATH.
function javaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  if (platform() === "darwin" && existsSync("/usr/libexec/java_home")) {
    const out = Bun.spawnSync(["/usr/libexec/java_home"], { stderr: "ignore" })
    const home = out.exitCode === 0 ? out.stdout.toString().trim() : ""
    if (home) return home
  }
  const java = Bun.which("java")
  return java ? dirname(dirname(java)) : null
}

// id → { programs (first = the probe), wrappers (project scripts run as ./name), bins, writable, never, env, version }
// writable: only the desk's own cache folders under `cache` — never a folder of binaries on PATH or config another
// program reads at its start (~/.cache holds the shell's instant-prompt script, ~/.bun/bin the bun launchd runs); the
// terminal denies every PATH folder on top (sandbox.js NEVER_WRITE).
export function catalogue(cache = join(CACHES, "default")) {
  const c = (...parts) => join(cache, ...parts)
  const jdk = javaHome()
  const npm = { npm_config_cache: c("npm") } // npm's _cacache, _logs and _npx
  return {
    python: {
      programs: ["uv", "uvx", "python3", "python", "ruff", "pytest"],
      bins: [h(".local/bin"), h(".cargo/bin")],
      writable: [c("uv"), c("uv-python"), c("pip")],
      env: { PYTHONUNBUFFERED: "1", UV_NO_PROGRESS: "1", UV_CACHE_DIR: c("uv"), UV_PYTHON_INSTALL_DIR: c("uv-python"), UV_PYTHON_BIN_DIR: c("uv-python", "bin"), PIP_CACHE_DIR: c("pip") },
      version: ["uv", "--version"],
    },
    javascript: {
      programs: ["node", "npm", "npx", "bun", "bunx", "pnpm", "deno"],
      bins: [h(".bun/bin"), h(".local/bin"), h("Library/pnpm/bin"), h(".deno/bin"), ...nvmBins()],
      writable: [c("npm"), c("bun"), c("pnpm-store"), c("ms-playwright"), c("node-gyp"), c("deno")],
      env: { CI: "1", NEXT_TELEMETRY_DISABLED: "1", NO_UPDATE_NOTIFIER: "1", ...npm, BUN_INSTALL_CACHE_DIR: c("bun"), npm_config_store_dir: c("pnpm-store"), PLAYWRIGHT_BROWSERS_PATH: c("ms-playwright"), npm_config_devdir: c("node-gyp"), DENO_DIR: c("deno") },
      version: ["node", "--version"],
    },
    java: {
      programs: ["java", "javac", "jar", "jshell", "mvn", "gradle", "node", "npm", "npx"],
      wrappers: ["./mvnw", "./gradlew"],
      bins: [...(jdk ? [join(jdk, "bin")] : []), "/opt/homebrew/opt/maven/bin", "/opt/homebrew/opt/gradle/bin", h(".sdkman/candidates/maven/current/bin"), h(".sdkman/candidates/gradle/current/bin")],
      writable: [c("m2"), c("gradle"), c("npm")],
      never: [c("m2", "settings.xml"), c("gradle", "init.d"), c("gradle", "init.gradle"), c("gradle", "init.gradle.kts"), c("gradle", "gradle.properties")],
      env: { ...(jdk ? { JAVA_HOME: jdk } : {}), ...npm, MAVEN_OPTS: `-Dmaven.repo.local=${c("m2", "repository")}`, MAVEN_USER_HOME: c("m2"), GRADLE_USER_HOME: c("gradle") },
      version: ["java", "--version"],
    },
    rust: {
      programs: ["cargo", "rustc", "rustfmt", "cargo-clippy"],
      bins: [h(".cargo/bin")],
      writable: [c("cargo")],
      never: [c("cargo", "bin"), c("cargo", "config"), c("cargo", "config.toml"), c("cargo", "credentials"), c("cargo", "credentials.toml")],
      env: { CARGO_TERM_COLOR: "never", CARGO_HOME: c("cargo") },
      version: ["cargo", "--version"],
    },
  }
}

export const TOOLCHAIN_IDS = ["python", "javascript", "java", "rust"]

// cache: the desk's own cache folder (terminal.js: <CACHES>/<desk>); the writable folders of the toolchains found are
// made there (the sandbox lets a program write inside them, not make them).
export function detectToolchains(ids = [], { cache = join(CACHES, "default") } = {}) {
  const chains = catalogue(cache)
  const wanted = ids.filter((id) => chains[id])
  const path = [...new Set([...wanted.flatMap((id) => chains[id].bins), ...(process.env.PATH ?? "").split(":"), ...SYSTEM_BINS])].filter((dir) => dir && existsSync(dir))
  const PATH = path.join(":")
  const programs = new Set(BASE.filter((p) => Bun.which(p, { PATH })))
  const writable = new Set()
  const never = new Set()
  const env = {}
  const found = []
  const missing = []
  for (const id of wanted) {
    const chain = chains[id]
    const have = chain.programs.filter((p) => Bun.which(p, { PATH }))
    if (!have.includes(chain.programs[0])) {
      missing.push(id)
      continue
    }
    for (const p of [...have, ...(chain.wrappers ?? [])]) programs.add(p)
    for (const dir of chain.writable) writable.add(dir)
    for (const p of chain.never ?? []) never.add(p)
    Object.assign(env, chain.env)
    const out = Bun.spawnSync(chain.version, { env: { PATH, HOME }, stderr: "pipe" })
    const version = `${out.stdout}${out.stderr}`.trim().split("\n")[0] || null
    found.push({ id, version, programs: have })
  }
  for (const dir of writable) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {}
  }
  return { programs: [...programs], path, writable: [...writable], never: [...never], env, cache, found, missing }
}
