/**
 * FOUR DESTINATIONS AND NO MORE (docs/SEAM.md, "A route is a PANE; a
 * destination is a SCREEN"). A pane is a projection the core can produce; a
 * destination is a place a person goes. Eleven panes, four screens.
 *
 * This file is the whole of the Rust `shell/views.rs` + `shell/route.rs` pair,
 * and it is smaller for a reason that is not JavaScript: the predecessor put
 * every view in the location HASH and had to bind, read and write it by hand.
 * A static export gets one real directory per destination, so the browser is
 * the router and this file only says which address means what.
 */

/**
 * @typedef {object} Destination
 * @property {string} slug     the directory, '' for the root
 * @property {string} path     the address, always with its trailing slash (I1: GitHub
 *                             Pages has no rewrites, so every route is a real directory)
 * @property {string} label    the nav entry, and the destination's own kicker
 * @property {string} heading  what the region is, above its content
 * @property {string} note     one line of the region's own voice. ONE line: the
 *                             editorial round measured the predecessor's lede at
 *                             170 words and 403 pixels between a person and the
 *                             product (DESIGN.md §1)
 * @property {string[]} panes  the seam views this screen composes, from docs/SEAM.md
 * @property {boolean} rail    whether the instruments column has anything to say here
 * @property {boolean} scoped  whether this screen is about ONE agent (?agent=)
 */

/** @type {Destination} */
export const WORK = {
  slug: '',
  path: '/',
  label: 'Work',
  heading: 'The run, and the whole of it',
  note: 'Which agent needs you, the transcript you type into, and the fleet under both.',
  panes: ['chat', 'board', 'files', 'terminal', 'trace', 'processes', 'space', 'debug'],
  rail: true,
  scoped: true,
}

/** @type {Destination} */
export const AGENTS = {
  slug: 'agents',
  path: '/agents/',
  label: 'Agents',
  heading: 'What agents exist, and the surface for writing another',
  note: 'Every agent, the file it was read from, the model it calls, and what failed to load. You edit what an agent IS here, and Work shows you the effect.',
  panes: ['agents', 'tools'],
  rail: false,
  scoped: false,
}

/** @type {Destination} */
export const SETUP = {
  slug: 'setup',
  path: '/setup/',
  label: 'Setup',
  heading: 'Where turns are sent, and what this browser holds',
  note: 'The endpoint catalogue and what each entry resolves to, the one-line health of this build, and the appearance of the page.',
  panes: ['settings', 'status'],
  rail: false,
  scoped: false,
}

/** @type {Destination[]} The nav list, in order. THREE. */
export const NAV = [WORK, AGENTS, SETUP]

/**
 * NOT in the nav and not linked from the product: an internal gallery reached
 * by URL, carrying a crumb back. It is in `ALL` because the address resolves.
 * @type {Destination}
 */
export const GALLERY = {
  slug: 'design-system',
  path: '/design-system/',
  label: 'Design system',
  heading: 'Every component, every variant, every state',
  note: 'The internal gallery, over the real ground. It is reached by address and is deliberately not linked from the product. Every number, agent and endpoint below is a fixture; nothing here was read from a log.',
  panes: [],
  rail: false,
  scoped: false,
}

/** @type {Destination[]} */
export const ALL = [...NAV, GALLERY]

/**
 * EVERY NAME THIS PRODUCT HAS EVER SHIPPED RESOLVES. The predecessor's seven
 * views folded into these four, and the slugs it shipped are links somebody
 * already has. They are listed by hand rather than folded into the fallback
 * because a REDIRECT and a MISROUTE are different events: `/trace/` is a link
 * that used to work and lands on the screen that absorbed it, while
 * `/wharrgarbl` named nothing and the page has to say so.
 * @type {Record<string, Destination>}
 */
const ABSORBED = {
  dashboard: WORK,
  chat: WORK,
  trace: WORK,
  debug: WORK,
  commands: WORK,
  workspace: WORK,
  tools: AGENTS,
  settings: SETUP,
}

/** The first path segment, with the base path and both slashes off. */
function slugOf(/** @type {string} */ pathname, /** @type {string} */ base) {
  const bare = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  return bare.replace(/^\/+/, '').replace(/\/.*$/, '')
}

/**
 * @typedef {{kind: 'here', to: Destination}
 *         | {kind: 'absorbed', to: Destination, was: string}
 *         | {kind: 'unknown', to: Destination, was: string}} Landing
 */

/**
 * WHERE AN ADDRESS LANDS, and what kind of arrival that is. `to` is always a
 * real destination — an address that names nothing still lands on Work, which
 * is where the application opens — and `kind` is what the page says about it.
 * @param {string} pathname  `location.pathname`, base path included
 * @param {string} [base]    the deploy's base path, '' when served from the root
 * @returns {Landing}
 */
export function land(pathname, base = '') {
  const slug = slugOf(pathname, base)
  const here = ALL.find((d) => d.slug === slug)
  if (here) return { kind: 'here', to: here }
  const absorbed = ABSORBED[slug]
  if (absorbed) return { kind: 'absorbed', to: absorbed, was: slug }
  return { kind: 'unknown', to: WORK, was: slug }
}

/**
 * The subject the masthead plate names (DESIGN.md §1: one display register, and
 * it names the screen's SUBJECT — never a view's own name). Work is about one
 * agent, Agents is about the product's whole roster, Setup is about this
 * browser. A LOOKUP, not a sentence: the interface never composes prose (I5).
 * @param {Destination} to
 * @param {string} agent
 */
export function subjectOf(to, agent) {
  if (to.scoped) return agent
  return SUBJECTS[to.slug] ?? to.label
}

/**
 * The gallery's subject is the PRODUCT, not the gallery: `Design system` over
 * `the design system` is a screen restating its own name in the one register
 * reserved for what the screen is about.
 * @type {Record<string, string>}
 */
const SUBJECTS = { agents: 'HARNESS', setup: 'this browser', 'design-system': 'HARNESS' }
