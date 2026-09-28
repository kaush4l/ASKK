/** This function is embedded in exported HTML and must not depend on a bundle. */
export function installBootWatchdog({ document, window, setTimeout, clearTimeout }) {
  const root = document.documentElement
  if (root.dataset.askkBoot === 'ready') return
  root.dataset.askkBoot = 'pending'
  const ready = () => {
    root.dataset.askkBoot = 'ready'
    clearTimeout(deadline)
    window.removeEventListener('askk:hydrated', ready)
  }
  const deadline = setTimeout(() => {
    if (root.dataset.askkBoot !== 'ready') root.dataset.askkBoot = 'stalled'
    window.removeEventListener('askk:hydrated', ready)
  }, 8000)
  window.addEventListener('askk:hydrated', ready)
}

// Only application-owned constant code is embedded; no location or user text.
export const BOOT_WATCHDOG_SCRIPT = `(${installBootWatchdog.toString()})({document,window,setTimeout,clearTimeout});`
