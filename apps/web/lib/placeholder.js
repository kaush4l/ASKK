/**
 * NOTHING IN THIS FILE IS TRUE. It is the stand-in for `response.data` until
 * increment 3 wires `handle(request)` in, and it exists as ONE module rather
 * than as literals sprinkled through the components so that the wiring is a
 * deletion: when every region takes its projection from the seam, this file has
 * no importers and goes.
 *
 * Every value here is a shape, never an assertion. A status the page does not
 * have yet is not rendered (DESIGN.md §11, R6-BOOT) — so the strip's facts read
 * `—` rather than a plausible-looking number that a reader would believe.
 */

/** Stamped as `data-placeholder` wherever this file reaches the DOM, so a probe can find it. */
export const NOT_REAL_YET = 'true'

/**
 * What each destination's region will hold, named by the seam views it composes
 * (docs/SEAM.md). The `note` is the region's own voice while it is empty — an
 * empty state that says what will be here beats a blank box (DESIGN.md §8).
 * @type {Record<string, {heading: string, note: string}>}
 */
export const REGIONS = {
  '': {
    heading: 'The run, and the whole of it',
    // ONE LINE, because this one stands between a person and the transcript.
    // The predecessor's lede was 170 words and moved the fold down 93 pixels.
    note: 'Every agent, reply and number below is invented — nothing on this screen has been read from the log yet.',
  },
  agents: {
    heading: 'What agents exist, and the surface for writing another',
    note: 'Every agent, the file it was read from, the model it calls, and what failed to load. You edit what an agent IS here, and Work shows you the effect.',
  },
  setup: {
    heading: 'Where turns are sent, and what this browser holds',
    note: 'The endpoint catalogue and what each entry resolves to, the one-line health of this build, and the appearance of the page.',
  },
  'design-system': {
    heading: 'Every component, every variant, every state',
    note: 'The internal gallery, over the real ground. It is reached by address and is deliberately not linked from the product. Every number, agent and endpoint below is invented; nothing here was read from the log.',
  },
}

/**
 * The header's strip of facts, in priority order (`shell/statusbar.rs`). The
 * VALUES are absent; the LABELS are the contract — increment 3 fills each from
 * the projection that owns it, and the labels are what say which one that is.
 * @type {Array<{id: string, label: string, value: string}>}
 */
export const STRIP = [
  { id: 'agent', label: 'Agent', value: '—' },
  { id: 'endpoint', label: 'The next turn calls', value: '—' },
  { id: 'running', label: 'Running', value: '—' },
  { id: 'spend', label: 'Spent on this page', value: '—' },
]

/**
 * The `problem` projection an unknown address will earn from the seam once it
 * is wired — the ONE failure shape (docs/SEAM.md). The interface renders these
 * strings and never writes one, so the component that shows it needs no change
 * when the real projection arrives.
 * @type {import('@/components/views/problem').ProblemData}
 */
export const MISROUTE = {
  id: 'misroute',
  kind: 'no_such_destination',
  // TRUE ON BOTH DOCUMENTS. The 404 page renders this before the correction
  // runs, and Work renders it after; a past tense would be a lie on the first
  // and a present tense a lie on the second (I16).
  message: 'That address names no destination. Work is where the application opens, and that is where this goes.',
  detail: 'Work, Agents and Setup are every destination there is. The design system is reachable by address and is not one of them.',
  repair: 'Follow one of the three above, or edit the address.',
}

/** What the rail holds on Work, and it is named for its CONTENTS (DESIGN.md §11, R8-7). */
export const RAIL = {
  noun: 'folder',
  note: 'The folder this agent’s commands ran in, what is still running in it, and what the turn left behind.',
}
