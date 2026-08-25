import s from './ui.module.css'

/**
 * SHAPE CARRIES LIVENESS; COLOUR CARRIES STATE.
 *
 * The six states an agent can be in (DESIGN.md §8, Badge / StatusDot) drew ONE
 * shape between them — a 8px dot — and everything separating a failed agent
 * from an idle one was `--tone`. That survives neither a colourblind reader nor
 * the greyscale screenshot this project's own critics paste into a review, and
 * the roster is the one screen whose whole job is answered at a glance.
 *
 * So each state gets its own outline. A SOLID disc is running, an open arc is
 * starting, a hollow ring is resting, a triangle is asking you something, a
 * diamond is a failure and a bar is closed — legible with every colour in the
 * palette turned to grey, which is the test.
 *
 * `aria-hidden`, always: the Badge's label beside it is the primary channel and
 * it is the core's word. A mark a screen reader reads out is a second voice for
 * one fact (I5).
 *
 * @type {Readonly<Record<string, {d: string, filled: boolean}>>}
 */
const SHAPES = Object.freeze({
  working: { d: 'M8 3a5 5 0 1 0 0 10a5 5 0 1 0 0-10', filled: true },
  starting: { d: 'M8 3a5 5 0 1 1-4.3 7.5', filled: false },
  idle: { d: 'M8 3a5 5 0 1 0 0 10a5 5 0 1 0 0-10', filled: false },
  waiting: { d: 'M8 2.6l5.4 9.8H2.6z', filled: true },
  failed: { d: 'M8 2.4l5.6 5.6L8 13.6 2.4 8z', filled: true },
  closed: { d: 'M3 7.2h10v1.6H3z', filled: true },
  /* AND TWO MORE, because a tool call is not an agent. DESIGN.md §8 lists the
     six above — it predates the four-state inspector — and a call that has not
     started and one that finished are the two states that list has no word for.
     Drawing them as the same dot in two colours is exactly the failure the
     other six were given shapes to fix. */
  pending: { d: 'M4 4h8v8H4z', filled: false },
  ok: { d: 'M3.6 8.4l3 3 5.8-6.8', filled: false },
})

/** The states this product draws a shape for. `test/glyph.test.js` asserts no
 *  two of them are the same outline, and that every status any projection
 *  carries is one of them. */
export const GLYPH_STATES = Object.freeze(Object.keys(SHAPES))

/**
 * @param {{status: string}} props the machine field, never the worded one. A
 *   status with no shape draws nothing rather than a wrong shape — the label
 *   beside it still says what happened, and inventing a mark for a state this
 *   file has never heard of is the interface asserting something it does not
 *   know.
 */
export function Glyph({ status }) {
  const shape = SHAPES[status]
  if (!shape) return null
  return (
    <svg className={s.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={shape.d}
        fill={shape.filled ? 'currentColor' : 'none'}
        stroke={shape.filled ? 'none' : 'currentColor'}
        strokeWidth="1.6"
      />
    </svg>
  )
}
