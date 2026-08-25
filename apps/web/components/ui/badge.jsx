import { Glyph } from './glyph'
import s from './ui.module.css'

/**
 * DOT AND LABEL, NEVER DOT ALONE (DESIGN.md §8, Badge / StatusDot).
 *
 * The predecessor's board painted a `--tone` edge and said the status in prose
 * beside it, which is the same rule reached by two routes; this is the one
 * implementation. The LABEL is the primary channel and it is the core's word
 * (I5) — this component never turns `thinking` into "Working", because the
 * moment it does, the board and the roster word one status differently.
 *
 * THE MARK IS A SHAPE AND NOT A DOT (`glyph.jsx`). One 8px dot in six colours
 * left colour as the only channel separating six states, which survives neither
 * a greyscale screenshot nor a colourblind reader — and this is the component
 * every list in the product states a status through.
 *
 * @param {{status: string, label: string}} props `status` is the machine field
 *   and drives only paint; `label` is the already-worded one and is what a
 *   person reads.
 */
export function Badge({ status, label }) {
  return (
    <span className={`${s.badge} ${s.toned}`} data-status={status}>
      <Glyph status={status} />
      {label}
    </span>
  )
}
