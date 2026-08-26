/**
 * THE ONE THING THAT MUST RUN BEFORE THE FIRST PAINT.
 *
 * The predecessor could not do this at all: it was a Wasm bundle, so the choice
 * arrived after the first frame and a reload painted the wrong room until the
 * bundle landed. A few lines in the `<head>` were its fix, and they are these —
 * a static export can run them, so it does.
 *
 * It stamps BOTH attributes: `data-theme` always, resolving the device's own
 * `prefers-color-scheme` when nothing readable was stored, and `data-direction`
 * only where one was chosen. Stamping an always-present room is not a
 * half-truth about a choice nobody made — the attribute says which room is on
 * screen, not who picked it — and it is what lets `globals.css` hold the light
 * palette once rather than once under a media query and once under an
 * attribute, two bodies of fifteen declarations that nothing keeps equal.
 *
 * The names and the lists come from `lib/appearance.js` and are not spelled
 * again here, so a fifth direction is one entry in one array rather than an
 * array and a string literal that can disagree.
 */

import { DARK_QUERY, DIRECTIONS, DIRECTION_KEY, ROOMS, ROOM_KEY } from '@/lib/appearance'

/** @type {string[]} The slugs a stylesheet answers to; `''` is the shipped page. */
const SLUGS = DIRECTIONS.map((d) => d.slug).filter(Boolean)

/**
 * Inline, synchronous, and hand-minified on purpose: an async or deferred
 * script paints first and corrects afterwards, which is the flash this exists
 * to remove. One `try` around both reads, because a browser that refuses
 * storage refuses both and the device query is still the right answer.
 */
export const THEME_BOOT = `(function(){var t,d;try{t=localStorage.getItem(${JSON.stringify(ROOM_KEY)});d=localStorage.getItem(${JSON.stringify(DIRECTION_KEY)})}catch(e){}var r=document.documentElement;if(${JSON.stringify(ROOMS)}.indexOf(t)<0)t=matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";r.setAttribute("data-theme",t);if(${JSON.stringify(SLUGS)}.indexOf(d)>-1)r.setAttribute("data-direction",d)})()`
