/** Install once on Pages, preserve drafts, then reload into an isolated document. */
export async function prepareIsolation({ base = '/', beforeReload = async () => {} } = {}) {
  const isolated = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
  if (!globalThis.isSecureContext || !globalThis.navigator?.serviceWorker) return isolated ? { ready: true } : { ready: false, reason: 'Browser Linux needs HTTPS (or localhost) and service worker support.' }
  // Header-isolated hosts need no worker. Existing workers must still migrate:
  // an old cache-first worker can otherwise pin unhashed agent modules forever.
  if (isolated && !navigator.serviceWorker.controller) return { ready: true }
  const scope = new URL(base, location.origin)
  const workerURL = new URL('coi-serviceworker.js', scope)
  const key = `askk:isolation:${scope.pathname}:v1`
  const registration = await navigator.serviceWorker.register(workerURL, { scope: scope.pathname, updateViaCache: 'none' })
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Isolation service worker activation timed out')) }, 20000)
    function changed() { if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve() } else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('Isolation service worker became unavailable')) } }
    worker.addEventListener('statechange', changed); changed()
  })
  if (navigator.serviceWorker.controller?.scriptURL !== workerURL.href) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Isolation service worker did not take control')) }, 10000)
    function changed() { if (navigator.serviceWorker.controller?.scriptURL === workerURL.href) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve() } }
    navigator.serviceWorker.addEventListener('controllerchange', changed); changed()
  })
  if (isolated) return { ready: true }
  if (sessionStorage.getItem(key)) return { ready: false, reason: 'This browser did not enable cross-origin isolation after reload. Editing remains available; Browser Linux cannot start.' }
  const event = new Event('askk:before-isolation', { cancelable: true })
  if (!window.dispatchEvent(event)) return { ready: false, reason: 'Draft persistence failed. Free browser storage before enabling Browser Linux.' }
  await beforeReload()
  sessionStorage.setItem(key, 'reloaded')
  location.reload()
  return { ready: false, reloading: true }
}
