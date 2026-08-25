/**
 * THE ONE THING THAT MUST RUN BEFORE THE FIRST PAINT.
 *
 * The predecessor could not do this at all: it was a Wasm bundle, so the choice
 * arrived after the first frame and a reload painted the wrong room until the
 * bundle landed. Four lines in the `<head>` were its fix, and they are these —
 * a static export can run them, so it does.
 *
 * It stamps ONLY an explicit choice. Absent, unreadable, storage denied, and a
 * value no stylesheet answers to all mean the same thing: the device's own
 * `prefers-color-scheme`, which `app/globals.css` already answers without any
 * script at all. Writing `data-theme=""` would leave the DOM asserting a theme
 * the page does not have, which is the kind of half-truth I16 is about.
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

/**
 * Inline, minified by hand, and synchronous on purpose: an async or deferred
 * script paints first and corrects afterwards, which is the flash this exists
 * to remove.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(THEMES)}.indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}`
