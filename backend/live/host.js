// The desk server this page talks to, as far as the page can reach it.
//
//   await detectHost()   -> { mode, name?, version?, desk?, root?, runtime?, capabilities, platform? }
//
//   local     `bun run dev` (scripts/dev.js) or the compiled companion (companion/server/server.js) on this
//             machine: the same-origin host API under /__askk/ (companion/server/host-api.js) and the desk's team
//   browser   the owner runs an agent in this tab (2026-10-20: the hosted version — backend/browser/): a model named for
//             this browser and switched on — with no desk server here, or chosen over the one that answers (`server`: its
//             whoami, so the header offers the way back); capability `team` (the in-tab desk) only
//   offline   no desk server answers and no model is named: the pages say how to start one, or run one in this tab

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

// The browser desk when no server answers: a model named for this browser (backend/browser/settings.js).
const BROWSER = Object.freeze({ mode: "browser", name: "askk-browser", capabilities: ["team"] }) // "browser" is the host's app previews: not here
const wanted = async () => {
  try {
    const [{ browserStore }, { wantsBrowserAgent }] = await Promise.all([import("@/backend/browser/storage"), import("@/backend/browser/settings")])
    return wantsBrowserAgent(browserStore())
  } catch {
    return false
  }
}

// Probe once; a static host answers 404 (or HTML): no desk server. The agent in this browser when the owner switched it
// on — over a desk server too (the live server shows the hosted mode without another server).
export function detectHost() {
  detected ??= call("whoami")
    .then(async (who) => {
      const server = who?.name === "askk-companion" ? { mode: "local", ...who } : null
      if (await wanted()) return server ? { ...BROWSER, server } : BROWSER
      return server ?? OFFLINE
    })
    .catch(async () => ((await wanted()) ? BROWSER : OFFLINE))
  return detected
}

// Probe again (the owner named a model for this browser, or cleared it).
export function resetHost() {
  detected = null
}

export const hasCapability = (host, name) => !!host?.capabilities?.includes(name)

// What the desk server gives the desk and this page, for the header's host menu and the home page: per capability,
// what it does (`short`: the header menu's word for it, the label its hover); `localOff` says why it can be missing on a running server.
export const HOST_CAPABILITIES = [
  { id: "team", short: "Live team", label: "The desk runs on this computer; every tab follows its agents live" },
  { id: "fs.read", short: "Read workspace", label: "Read the desk's workspace (its data/ folder) and watch it change (fs/watch)" },
  { id: "fs.write", short: "Write workspace", label: "Change files in the workspace", localOff: "Turned off (--read-only)." },
  // 2026-10-17 owner: projects outside ASKK, each projects/<name>/ in the workspace (companion/capabilities/projects.js).
  { id: "projects", short: "Projects", label: "Projects of yours outside ASKK, loaded into the desk's workspace (projects/<name>/)", localOff: "This desk loads no projects (its main.js has no `projects`)." },
  // 2026-10-17: the developer view's terminal and preview (companion/capabilities/terminal.js, browser.js).
  { id: "term", short: "Terminal", label: "Terminal sessions: the desk's programs, sandboxed, kept running (term/*)", localOff: "Turned off (--read-only)." },
  { id: "browser", short: "Page previews", label: "Preview pages of apps running on this computer, with screenshots (browser/*)", localOff: "Turned off (--read-only)." },
  { id: "web", short: "Web search", label: "Search the web and read pages (web/search, web/read)" },
  { id: "mcp", short: "Tool servers (MCP)", label: "Tool servers: the desk's MCP servers and integrations", localOff: "No MCP server or integration configured." },
  { id: "models.local", short: "Local models", label: "Models this Mac runs: the claude, codex and gemini CLIs, Apple on-device" },
  { id: "wakes", short: "Wake book", label: "The wake book (state/wakes.jsonl): runs booked for later" },
  { id: "apple", short: "Mac actions", label: "Your Mac: Shortcuts, Reminders, Spotlight, speech, clipboard", localOff: "macOS only." },
  // 2026-10-23: open image models on this Mac (mflux), the studio artifact's generator (companion/capabilities/imagegen.js).
  { id: "images", short: "Image models", label: "Generate images on this Mac with open models (mflux: Qwen Image 2.1)", localOff: "No image model installed (uv tool install mflux), or --read-only." },
  { id: "speech", short: "Speech", label: "Speech on this Mac: on-device recognition (any browser) and Mac voices", localOff: "macOS 26+ only (ASKK_SPEECH=off turns it off)." },
]
