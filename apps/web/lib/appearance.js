/**
 * WHAT THIS DEVICE LOOKS LIKE, AS TWO SIGNALS.
 *
 * A ROOM is the light: `light` or `dark`, one palette re-pointed. A DIRECTION
 * is a different answer to "what does an assistant that works look like" — it
 * moves type, space, corners and the whole palette at once, and the four of
 * them are the ones the owner chose between. Keeping the two apart is the
 * point: a room is a switch, a direction is a decision.
 *
 * They are SIGNALS and not React state because two components far apart read
 * them — the shell stamps the document, Setup draws the picker — and the only
 * other way to share them is a provider wrapping a tree that has no other
 * reason to be wrapped. Nothing subscribes to a signal it does not read
 * (`packages/kernel/src/signal.js`), so the picker re-renders on a change and
 * the rest of the screen does not.
 *
 * A PREFERENCE ABOUT THIS SCREEN IS NOT APP DATA (I2). It lives in
 * `localStorage` beside the device's other bits, never in the log, and never
 * leaves the machine.
 *
 * NOTHING HERE WRITES STORAGE ON ITS OWN. The stamp is what the document needs;
 * the write is what a PERSON did, and `choose*` is the only thing that does it.
 * Seeding storage from a resolved default would record a choice nobody made and
 * then outrank the device forever after.
 */

import { effect, signal } from '@harness/kernel'

/** The device's own key namespace. Two keys, two independent choices. */
export const ROOM_KEY = 'harness.theme'
export const DIRECTION_KEY = 'harness.direction'

/** @type {readonly string[]} The rooms `globals.css` actually answers to. */
export const ROOMS = ['light', 'dark']

/** The query whose answer IS the room, for a person who never chose. */
export const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * The slug, the name, and the one sentence saying what the direction is FOR —
 * because a picker offering four words is a quiz, and a person chooses on feel.
 *
 * THE EMPTY SLUG IS THE SHIPPED PAGE, it is first, and it is the default. A
 * round that offers four directions has to leave the fifth — what already
 * exists — on the list, or it is not offering a choice, it is announcing one.
 * It is also the only entry the room switch means anything under: the other
 * four state their own `color-scheme` and are the whole answer.
 */
export const DIRECTIONS = [
  { slug: '', name: 'As it ships', what: 'Violet ground, serif masthead, ruled panels. The room switch applies to this one.' },
  { slug: 'halo', name: 'Halo', what: 'One light, one field, centred. Voice first, air everywhere, no corners.' },
  { slug: 'console', name: 'Console', what: 'Monospace and dense. No light, no blur, square. Rows over room.' },
  { slug: 'gallery', name: 'Gallery', what: 'Light paper, big rounded cards, thumb-sized targets. Made for a phone.' },
  { slug: 'atelier', name: 'Atelier', what: 'Warm ink and paper. Serif prose, two rules, the workshop reading.' },
]

/** What is stored under `key`, or `''` where storage is absent or refused. */
function stored(/** @type {string} */ key) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

/** Put a choice where a reload can find it; remove it where the choice is the
 *  default, so "nobody chose" and "chose the default" stay distinguishable. */
function keep(/** @type {string} */ key, /** @type {string} */ value) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // A browser that refuses storage still gets the stamp; what it loses is the
    // memory of it, which is exactly what a private window is for.
  }
}

/** The device's own answer, for a person who never chose. */
function deviceRoom() {
  try {
    return matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

/**
 * Which room is on screen. Stamped ALWAYS, resolving the device's own query
 * when nothing readable was stored — the attribute says which room is showing,
 * not who picked it, which is what lets `globals.css` hold the light palette
 * once instead of once under a media query and once under an attribute.
 * @type {import('@harness/kernel').Signal<string>}
 */
export const room = signal(ROOMS.includes(stored(ROOM_KEY)) ? stored(ROOM_KEY) : deviceRoom())

/**
 * Which direction is on screen, `''` for the page as it ships.
 * @type {import('@harness/kernel').Signal<string>}
 */
export const direction = signal(
  DIRECTIONS.some((d) => d.slug && d.slug === stored(DIRECTION_KEY)) ? stored(DIRECTION_KEY) : '',
)

/** @param {string} next */
export function chooseRoom(next) {
  if (!ROOMS.includes(next)) return
  keep(ROOM_KEY, next)
  room.set(next)
}

/** @param {string} next `''` puts the shipped page back, in one press. */
export function chooseDirection(next) {
  if (!DIRECTIONS.some((d) => d.slug === next)) return
  keep(DIRECTION_KEY, next)
  direction.set(next)
}

/**
 * Put both choices where CSS can see them, and keep doing it.
 *
 * The empty direction REMOVES the attribute rather than writing
 * `data-direction=""`: an empty attribute matches no stylesheet and would leave
 * the DOM asserting a direction the page does not have (I16).
 *
 * The device listener is the whole of what a `prefers-color-scheme` media block
 * would have bought, and it defers to a stored choice — the boot script resolves
 * the query once at load, and this is the only thing that notices the device
 * flipping afterwards.
 * @returns {() => void} stop
 */
export function followAppearance() {
  const stamp = effect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', room.get())
    const chosen = direction.get()
    if (chosen) root.setAttribute('data-direction', chosen)
    else root.removeAttribute('data-direction')
  })
  const query = matchMedia(DARK_QUERY)
  const follow = () => {
    if (!ROOMS.includes(stored(ROOM_KEY))) room.set(query.matches ? 'dark' : 'light')
  }
  query.addEventListener('change', follow)
  return () => {
    stamp()
    query.removeEventListener('change', follow)
  }
}
