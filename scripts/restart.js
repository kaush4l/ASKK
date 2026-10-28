// The restart supervisor (companion/capabilities/restart.js): started detached by the host's POST projects/restart, it
// outlives the server it restarts. It kickstarts the launchd job, waits for the server to come back healthy, and when it
// does not, restores the good checkpoint and kickstarts again — every step written to the restart record the desk reads
// back once it is up.
//
//   bun scripts/restart.js --record <memory/<desk>/restarts/r<n>.json> --repo <ASKK> --checkpoints <dir> --port 1111
//     [--label askk.desks] [--log custom/server.log]

import { readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { createCheckpoints } from "../companion/capabilities/checkpoints.js"
import { checkHealth, superviseRestart } from "../companion/capabilities/restart.js"

const { values: a } = parseArgs({ options: { record: { type: "string" }, repo: { type: "string" }, checkpoints: { type: "string" }, port: { type: "string" }, label: { type: "string", default: "askk.desks" }, log: { type: "string" } } })
const record = JSON.parse(readFileSync(a.record, "utf8"))
const uid = process.getuid()
const kickstart = async () => {
  const r = Bun.spawnSync(["launchctl", "kickstart", "-k", `gui/${uid}/${a.label}`], { stdout: "pipe", stderr: "pipe" })
  return r.exitCode === 0 ? { ok: true } : { ok: false, error: `${r.stderr}`.trim() || `exit ${r.exitCode}` }
}
const logTail = () => {
  if (!a.log) return ""
  try {
    return readFileSync(a.log, "utf8").split("\n").slice(-80).join("\n")
  } catch {
    return ""
  }
}
const checkpoints = createCheckpoints({ repo: a.repo, dir: a.checkpoints })
await superviseRestart(record, {
  kickstart,
  health: () => checkHealth({ port: Number(a.port), desk: record.desk }),
  rollback: (id) => checkpoints.restore(id, { why: `${record.id}: the server did not come back healthy`, by: "restart" }),
  save: (r) => (writeFileSync(a.record, JSON.stringify(r, null, 1)), r),
  logTail,
})
