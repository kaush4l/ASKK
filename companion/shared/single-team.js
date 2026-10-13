// One server per workspace: a second one would run a second team on the
// same memory and files. Exits when the workspace's team already runs.

import { findTeamServer } from "../team/team.js"

export function refuseSecondTeam(root) {
  const running = findTeamServer(root)
  if (running) {
    console.error(`ASKK already runs this workspace's team: http://localhost:${running.port}/ (pid ${running.pid}). Open that, or stop it first.`)
    process.exit(1)
  }
}
