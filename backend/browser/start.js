// The browser desk's one instance in this tab (2026-10-20: the hosted version): built when the owner has named a model
// (backend/browser/settings.js), served to the live UI through backend/live/stream.js (setLocalTeam), stopped or rebuilt
// when the setting changes. A desk server on this origin always wins (backend/live/host.js detects it first).
//
//   startBrowserDesk({store?}) → Promise<team | null>   (null: no model named yet)
//   restartBrowserDesk()       → the same, after the old one stopped (a new model)
//   stopBrowserDesk()

import { buildBrowserDesk } from "./desk.js"
import { readConnection } from "./settings.js"
import { browserStore } from "./storage.js"
import { createBrowserTeam } from "./team.js"
import { setLocalTeam } from "../live/stream.js"

let running = null
let generation = 0 // a start that a stop (or a restart) overtook ends its own team and never becomes the tab's

export function startBrowserDesk({ store = browserStore() } = {}) {
  if (running) return running
  const mine = ++generation
  running = (async () => {
    const connection = readConnection(store)
    if (!connection) return null
    // the kernel's lines (context.log) reach this tab's desk log once the team is up (2026-10-23 audit: they vanished)
    let teamLog = null
    const { desk } = buildBrowserDesk({ store, connection, log: (line) => (teamLog ? teamLog(line) : console.warn(line)) })
    const team = await createBrowserTeam({ desk, store, title: `This browser · ${connection.model}` })
    teamLog = team.log
    if (mine !== generation) {
      team.terminate()
      return null
    }
    setLocalTeam(team)
    // a tab hidden or closed writes what waits on a debounce (2026-10-23 audit)
    globalThis.addEventListener?.("pagehide", () => team.flush?.())
    return team
  })().catch((error) => {
    if (mine === generation) running = null
    throw error
  })
  return running
}

export function stopBrowserDesk() {
  const was = running
  running = null
  generation++
  setLocalTeam(null)
  return (was ?? Promise.resolve(null)).then((team) => team?.terminate()).catch(() => {})
}

// The old team ends before the new one is built (both would respawn kept helpers into the same store).
export async function restartBrowserDesk(options) {
  await stopBrowserDesk()
  return startBrowserDesk(options)
}
