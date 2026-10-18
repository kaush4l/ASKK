// The desk server this page talks to, as far as the page can reach it.
//
//   await detectHost()   -> { mode, name?, version?, desk?, root?, runtime?, capabilities, platform? }
//
//   local     `bun run dev` (scripts/dev.js) or the compiled companion (companion/server/server.js) on this
//             machine: the same-origin host API under /__askk/ (companion/server/host-api.js) and the desk's team
//   offline   no desk server answers (a static copy of the UI): the pages say how to start one

import { withBase } from "@/backend/live/base-path"

const API = withBase("/__askk/")
const OFFLINE = Object.freeze({ mode: "offline", capabilities: [] })

async function call(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString()
  let response
  try {
    response = await fetch(`${API}${endpoint}${query ? `?${query}` : ""}`, { cache: "no-store" })
  } catch {
    throw new Error("The ASKK companion is not reachable.")
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(body?.error ?? `Companion request failed (${response.status}).`)
  return body
}

let detected = null

// Probe once; a static host answers 404 (or HTML): no desk server.
export function detectHost() {
  detected ??= call("whoami")
    .then((who) => (who?.name === "askk-companion" ? { mode: "local", ...who } : OFFLINE))
    .catch(() => OFFLINE)
  return detected
}

export const hasCapability = (host, name) => !!host?.capabilities?.includes(name)

// What the desk server gives the desk and this page, for the header's host menu and the home page: per capability,
// what it does; `localOff` says why it can be missing on a running server.
export const HOST_CAPABILITIES = [
  { id: "team", label: "The desk runs on this computer; every tab follows its agents live" },
  { id: "fs.read", label: "Read the desk's workspace (its data/ folder) and watch it change (fs/watch)" },
  { id: "fs.write", label: "Change files in the workspace", localOff: "Turned off (--read-only)." },
  // 2026-10-17: the developer view's terminal and preview (companion/capabilities/terminal.js, browser.js).
  { id: "term", label: "Terminal sessions: the desk's programs, sandboxed, kept running (term/*)", localOff: "Turned off (--read-only)." },
  { id: "browser", label: "Preview pages of apps running on this computer, with screenshots (browser/*)", localOff: "Turned off (--read-only)." },
  { id: "web", label: "Search the web and read pages (web/search, web/read)" },
  { id: "mcp", label: "Tool servers: the desk's MCP servers and integrations", localOff: "No MCP server or integration configured." },
  { id: "models.local", label: "Models this Mac runs: the claude, codex and gemini CLIs, Apple on-device" },
  { id: "wakes", label: "The wake book (state/wakes.jsonl): runs booked for later" },
  { id: "apple", label: "Your Mac: Shortcuts, Reminders, Spotlight, speech, clipboard", localOff: "macOS only." },
  { id: "speech", label: "Speech on this Mac: on-device recognition (any browser) and Mac voices", localOff: "macOS 26+ only (ASKK_SPEECH=off turns it off)." },
]
