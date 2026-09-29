import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const scope = 'original-process-group'
const execute = promisify(execFile)
async function groupStopped(pid) {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { timeout: 500, maxBuffer: 4 * 1024 * 1024 })
  const rows = stdout.trim().split('\n').filter(Boolean).map(row => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(row)
    if (!match) throw new Error('unrecognized process table')
    return { group: Number(match[2]), state: match[3] }
  })
  if (!rows.length) throw new Error('empty process table')
  // Zombies have exited; only their parent or the OS can reap them.
  return rows.filter(row => row.group === pid).every(row => row.state.startsWith('Z'))
}

/** POSIX original group only: descendants that leave the group are outside this receipt. */
export async function cleanupProcessGroup(pid, { signal = (pid, name) => process.kill(pid, name), inspectStopped = groupStopped, termGraceMs = 1500, killGraceMs = 1500, pollMs = 25, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const failed = error => ({ ok: false, scope, error: `Original process-group cleanup could not be confirmed: ${error}` })
  if (!Number.isSafeInteger(pid) || pid <= 1) return failed('invalid process-group identity')
  function exists() {
    try { signal(-pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
  }
  function send(name) {
    try { signal(-pid, name) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  async function goneWithin(ms) {
    const deadline = now() + ms
    while (exists()) {
      const remaining = deadline - now()
      if (remaining <= 0) return false
      await sleep(Math.min(pollMs, remaining))
    }
    return true
  }
  try {
    if (!exists()) return { ok: true, scope }
    send('SIGTERM')
    if (await goneWithin(termGraceMs)) return { ok: true, scope }
    send('SIGKILL')
    if (await goneWithin(killGraceMs)) return { ok: true, scope }
    if (await inspectStopped(pid)) return { ok: true, scope, verification: 'no-live-members' }
    return failed('the group still exists after SIGKILL')
  } catch (error) {
    // Darwin can report EPERM for a group containing only an unreaped zombie.
    if (error.code === 'EPERM') {
      try { if (await inspectStopped(pid)) return { ok: true, scope, verification: 'no-live-members' } } catch (inspectionError) { return failed(inspectionError.message || String(inspectionError)) }
    }
    return failed(error.message || String(error))
  }
}
