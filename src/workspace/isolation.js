/** Install once on Pages, preserve drafts, then reload into an isolated document. */
export async function prepareIsolation({ base = '/', beforeReload = async () => {} } = {}) {
  if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') return { ready: true }
  if (!globalThis.isSecureContext || !navigator.serviceWorker) return { ready: false, reason: 'Browser Linux needs HTTPS (or localhost) and service worker support.' }
  const scope = new URL(base, location.origin)
  const key = `askk:isolation:${scope.pathname}:v1`
  const registration = await navigator.serviceWorker.register(new URL('coi-serviceworker.js', scope), { scope: scope.pathname, updateViaCache: 'none' })
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Isolation service worker activation timed out')) }, 20000)
    function changed() { if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve() } else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('Isolation service worker became unavailable')) } }
    worker.addEventListener('statechange', changed); changed()
  })
  if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Isolation service worker did not take control')) }, 10000)
    function changed() { if (navigator.serviceWorker.controller) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve() } }
    navigator.serviceWorker.addEventListener('controllerchange', changed); changed()
  })
  if (sessionStorage.getItem(key)) return { ready: false, reason: 'This browser did not enable cross-origin isolation after reload. Editing remains available; Browser Linux cannot start.' }
  const event = new Event('askk:before-isolation', { cancelable: true })
  if (!window.dispatchEvent(event)) return { ready: false, reason: 'Draft persistence failed. Free browser storage before enabling Browser Linux.' }
  await beforeReload()
  sessionStorage.setItem(key, 'reloaded')
  location.reload()
  return { ready: false, reloading: true }
}
