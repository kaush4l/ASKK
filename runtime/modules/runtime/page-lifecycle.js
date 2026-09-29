/** A cached document cannot reuse workers terminated when it left the page. */
export function watchPageLifecycle({ page = globalThis, stop, checkpoint, notify = () => {}, timeoutMs = 5000 }) {
  if (!page.addEventListener || typeof page.location?.reload !== 'function') return { dispose() {} }
  let hidden = false; let disposed = false; let restoring = false; let timer
  const hide = () => {
    if (disposed || hidden) return
    hidden = true
    stop()
  }
  const show = event => {
    if (disposed || !hidden || !event.persisted || restoring) return
    restoring = true
    notify({ status: 'restoring' })
    let timeout
    const deadline = new Promise((_, reject) => { timeout = reject; timer = setTimeout(() => reject(new Error('The restored page could not confirm its saves within 5 seconds.')), timeoutMs) })
    // Re-run the draft hook after restoration: pagehide cannot wait for storage,
    // and a failed save must never be followed by an automatic destructive reload.
    const preserveDrafts = () => {
      const before = new Event('askk:before-page-reload', { cancelable: true })
      if (!page.dispatchEvent(before)) throw new Error('Draft recovery could not be saved.')
    }
    Promise.race([Promise.resolve().then(async () => {
      if (disposed) return
      preserveDrafts()
      await checkpoint()
    }), deadline]).then(() => {
      if (!disposed) { preserveDrafts(); page.location.reload() }
    }).catch(error => {
      if (!disposed) notify({ status: 'blocked', error: `${error.message} Keep this page open to save or copy your work, then reload. No task was restarted.` })
    }).finally(() => { clearTimeout(timer) })
    // Explicit teardown while a save is pending suppresses all later effects.
    cancel = () => timeout(new Error('Page recovery was disposed.'))
  }
  let cancel = () => {}
  page.addEventListener('pagehide', hide)
  page.addEventListener('pageshow', show)
  return { dispose() { disposed = true; clearTimeout(timer); cancel(); page.removeEventListener('pagehide', hide); page.removeEventListener('pageshow', show) } }
}
