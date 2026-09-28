/** A checkpointed workspace has exactly one live guest owner per browser origin. */
export function acquireWorkspace(locks, projectId) {
  if (!locks?.request) return Promise.reject(Object.assign(new Error('This browser does not provide the workspace locking API'), { code: 'LOCKS_REQUIRED' }))
  return new Promise((resolve, reject) => {
    locks.request(`askk-browser-linux:${projectId}`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) { reject(Object.assign(new Error('This browser workspace is already open in another tab'), { code: 'WORKSPACE_BUSY' })); return }
      return new Promise((release) => { resolve(release) })
    }).catch(reject)
  })
}
