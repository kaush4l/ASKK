// Toolchains a desk's terminal may use, detected on this machine at start.
// A desk names toolchains (desk.js `terminal: { toolchains: ["python", "rust", …] }`);
// each one found adds its programs, bin folders (PATH), cache folders the sandbox
// may write, and environment. A toolchain that is not installed is left out (and
// listed as missing), so the same desk runs on any machine with whatever it has.
//
//   detectToolchains(["python", "java"]) → { programs, path, writable, env, found: [{ id, version, programs }], missing: [id] }

import { existsSync, readdirSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, join } from "node:path"

const HOME = homedir()
const h = (...parts) => join(HOME, ...parts)

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

// id → { programs (first = the probe), wrappers (project scripts run as ./name), bins, writable, env, version }
function catalogue() {
  const jdk = javaHome()
  return {
    python: {
      programs: ["uv", "uvx", "python3", "python", "ruff", "pytest"],
      bins: [h(".local/bin"), h(".cargo/bin")],
      writable: [h(".cache"), h(".local/share/uv"), h(".local/bin")],
      env: { PYTHONUNBUFFERED: "1", UV_NO_PROGRESS: "1" },
      version: ["uv", "--version"],
    },
    javascript: {
      programs: ["node", "npm", "npx", "bun", "bunx", "pnpm", "deno"],
      bins: [h(".bun/bin"), h(".local/bin"), h("Library/pnpm/bin"), h(".deno/bin"), ...nvmBins()],
      writable: [h(".npm"), h(".bun"), h(".cache"), h("Library/pnpm"), h("Library/Caches/ms-playwright"), h(".deno")],
      env: { CI: "1", NEXT_TELEMETRY_DISABLED: "1", NO_UPDATE_NOTIFIER: "1" },
      version: ["node", "--version"],
    },
    java: {
      programs: ["java", "javac", "jar", "jshell", "mvn", "gradle", "node", "npm", "npx"],
      wrappers: ["./mvnw", "./gradlew"],
      bins: [...(jdk ? [join(jdk, "bin")] : []), "/opt/homebrew/opt/maven/bin", "/opt/homebrew/opt/gradle/bin", h(".sdkman/candidates/maven/current/bin"), h(".sdkman/candidates/gradle/current/bin")],
      writable: [h(".m2"), h(".gradle"), h(".npm"), h(".cache")],
      env: jdk ? { JAVA_HOME: jdk } : {},
      version: ["java", "--version"],
    },
    rust: {
      programs: ["cargo", "rustc", "rustfmt", "cargo-clippy"],
      bins: [h(".cargo/bin")],
      writable: [h(".cargo/registry"), h(".cargo/git"), h(".cache")],
      env: { CARGO_TERM_COLOR: "never" },
      version: ["cargo", "--version"],
    },
  }
}

export const TOOLCHAIN_IDS = ["python", "javascript", "java", "rust"]

export function detectToolchains(ids = []) {
  const chains = catalogue()
  const wanted = ids.filter((id) => chains[id])
  const path = [...new Set([...wanted.flatMap((id) => chains[id].bins), ...(process.env.PATH ?? "").split(":"), ...SYSTEM_BINS])].filter((dir) => dir && existsSync(dir))
  const PATH = path.join(":")
  const programs = new Set(BASE.filter((p) => Bun.which(p, { PATH })))
  const writable = new Set()
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
    Object.assign(env, chain.env)
    const out = Bun.spawnSync(chain.version, { env: { PATH, HOME }, stderr: "pipe" })
    const version = `${out.stdout}${out.stderr}`.trim().split("\n")[0] || null
    found.push({ id, version, programs: have })
  }
  return { programs: [...programs], path, writable: [...writable], env, found, missing }
}
