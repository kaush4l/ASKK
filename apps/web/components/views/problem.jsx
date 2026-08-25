import s from './problem.module.css'

/**
 * @typedef {object} ProblemData The seam's ONE failure shape (docs/SEAM.md).
 * @property {string} id       WHICH OCCURRENCE this is, and never `kind`: two
 *   agents missing from the manifest fail the same way, so a list of failures
 *   keyed on anything a second one can equal reconciles two rows into one. The
 *   FACE lane has asked SPINE for this field on the projection (STATUS.md).
 * @property {string} kind     how it failed, for a probe and for the debug view
 * @property {string} message  one sentence a person can act on
 * @property {string} detail   for the person who opens the debug view
 * @property {string} repair   what to do about it, empty when there is nothing to do
 */

/**
 * EVERY FAILURE THE SEAM CAN RETURN, AND ONE COMPONENT FOR ALL OF THEM.
 *
 * The predecessor keyed control flow on CSS class names and recovered a
 * failure's parts by scanning a fragment for substrings; a single shape means
 * the interface cannot miss a case and cannot invent one. These four strings
 * are rendered and never written here: the interface chooses LAYOUT and never
 * composes PROSE (I5).
 *
 * `subject` is the address, the view name, the file — whatever the failure is
 * ABOUT. It is rendered as a VALUE beside the sentences and never spliced into
 * one, which is what keeps this component free of the concatenation the gate
 * bans while still naming the thing that went wrong.
 *
 * Two placements, one implementation. `banner` is a row over a screen that is
 * otherwise fine — a redirect note, a save that failed — and `region` is the
 * failure standing in for the content it replaced.
 *
 * The prop is `data` and not `problem` because EVERY view component in this
 * tree takes the projection its view carries under that one name, so wiring the
 * seam is one file and no component (`components/views/index.jsx`).
 *
 * @param {{data: ProblemData, subject?: string, placement?: 'banner' | 'region'}} props
 */
export function Problem({ data, subject = '', placement = 'region' }) {
  return (
    <div className={`${s.problem} ${s[placement]}`} role="status" data-kind={data.kind}>
      <p className={s.head}>{data.message}</p>
      {subject ? <p className={s.aside}><code className={s.subject}>{subject}</code></p> : null}
      <p className={s.aside}>{data.detail}</p>
      {data.repair ? <p className={s.aside}>{data.repair}</p> : null}
    </div>
  )
}

/**
 * WHAT THE REGISTRY RENDERS WHEN A NAME ARRIVES THAT THE ROUTE TABLE DOES NOT
 * LIST. It is interface copy and not a projection, because the core cannot
 * produce this: `docs/SEAM.md` names every view there is, so reaching this is a
 * bug in whatever spelled the name, and the page's job is to say so with the
 * name in hand rather than render nothing.
 * @type {ProblemData}
 */
export const UNKNOWN_VIEW = {
  id: 'unknown_view',
  kind: 'no_such_view',
  message: 'The core asked for a view this interface has no component for.',
  detail: 'docs/SEAM.md lists every view name the seam can return, and each one has exactly one component. A name outside that table is a defect in whichever side spelled it.',
  repair: 'Add the row to the route table and the component beside its siblings, or correct the name the projection was returned under.',
}
