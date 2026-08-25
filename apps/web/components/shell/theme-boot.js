/**
 * THE ONE THING THAT MUST RUN BEFORE THE FIRST PAINT.
 *
 * The predecessor could not do this at all: it was a Wasm bundle, so the choice
 * arrived after the first frame and a reload painted the wrong room until the
 * bundle landed. A few lines in the `<head>` were its fix, and they are these —
 * a static export can run them, so it does.
 *
 * It stamps `data-theme` ALWAYS, resolving the device's own
 * `prefers-color-scheme` when nothing readable was stored. That is not a
 * half-truth about a choice nobody made: the attribute says which room is on
 * screen, not who picked it. It is written this way because the alternative was
 * `globals.css` carrying the light palette twice — once under a media query for
 * the person who never chose and once under the attribute for the person who
 * did — two bodies of fifteen declarations that nothing stops from drifting
 * apart, in the file whose first sentence is that every value is declared once.
 *
 * A preference about this screen is not app data and never leaves the machine
 * (I2), so it lives in `localStorage` beside the device's other bits and never
 * in the log. The SWITCH and the write belong to Setup, which owns the storage;
 * this only reads what that wrote.
 */

/** The device's own key namespace. One spelling, shared with the switch. */
export const THEME_KEY = 'harness.theme'

/** @type {readonly string[]} The rooms `globals.css` actually answers to. */
export const THEMES = ['light', 'dark']

/** The query whose answer IS the room, for a person who never chose. */
export const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Inline, minified by hand, and synchronous on purpose: an async or deferred
 * script paints first and corrects afterwards, which is the flash this exists
 * to remove.
 */
export const THEME_BOOT = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(${JSON.stringify(THEMES)}.indexOf(t)<0)t=matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)})()`

/** The stored choice, or `''` when there is none this stylesheet answers to. */
function chosen() {
  try {
    const t = localStorage.getItem(THEME_KEY) ?? ''
    return THEMES.includes(t) ? t : ''
  } catch {
    return ''
  }
}

/**
 * A PERSON WHO NEVER CHOSE STILL FOLLOWS THEIR DEVICE. The boot script resolves
 * the query once, at load; this is the only thing that notices the device
 * flipping afterwards, and it is the whole of what the deleted media query was
 * buying. A stored choice outranks the device, so it defers to one.
 * @returns {() => void} stop following
 */
export function followDeviceTheme() {
  const q = window.matchMedia(DARK_QUERY)
  const restamp = () => {
    if (!chosen()) document.documentElement.setAttribute('data-theme', q.matches ? 'dark' : 'light')
  }
  q.addEventListener('change', restamp)
  return () => q.removeEventListener('change', restamp)
}
