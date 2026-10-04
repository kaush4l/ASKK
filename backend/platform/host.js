// The machine the app runs on, as far as the page can reach it.
//
//   await detectHost()   -> { mode, name?, version?, root?, capabilities, platform? }
//   (files: features/filesystem/workspace.js picks the companion or the browser)
//
// Modes (same app in each):
//   local  `bun run dev` (scripts/dev.js, the default) or the compiled
//          companion (companion/server.js) on this machine: same-origin host
//          API under /__askk/ (companion/host-api.js) adds host capabilities
//   demo   hosted static build: browser-only; host capabilities are shown
//          as missing (HOST_CAPABILITIES) and fall back where they can
// Main thread and workers alike; relative URLs resolve against the page.

import { withBase } from "@/backend/platform/base-path"

const API = withBase("/__askk/")
const DEMO = Object.freeze({ mode: "demo", capabilities: [] })

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

// Probe once; a static host answers 404 (or HTML), which means demo mode.
export function detectHost() {
  detected ??= call("whoami")
    .then((who) => (who?.name === "askk-companion" ? { mode: "local", ...who } : DEMO))
    .catch(() => DEMO)
  return detected
}

export const hasCapability = (host, name) => !!host?.capabilities?.includes(name)

// What this machine adds over the browser, for the mode indicator: per
// capability, what it does with the host and what happens without it
// (`fallback`, null = not available at all).
export const HOST_CAPABILITIES = [
  {
    id: "fs.read",
    label: "Read your project folder",
    fallback: "Agents and Files use a workspace stored in this browser instead.",
  },
  {
    id: "fs.write",
    label: "Change files in your project folder",
    fallback: "Changes go to the browser workspace instead.",
  },
  {
    id: "models",
    label: "Your model from .env",
    fallback: "Add your model on the Settings page.",
  },
  {
    id: "apple",
    label: "Your Mac: Shortcuts, Reminders, Spotlight, speech, clipboard",
    fallback: null,
  },
]
