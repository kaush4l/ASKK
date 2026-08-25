import s from './ui.module.css'

/**
 * DOT AND LABEL, NEVER DOT ALONE (DESIGN.md §8, Badge / StatusDot).
 *
 * The predecessor's board painted a `--tone` edge and said the status in prose
 * beside it, which is the same rule reached by two routes; this is the one
 * implementation. The LABEL is the primary channel and it is the core's word
 * (I5) — this component never turns `working` into "Working", because the
 * moment it does, the board and the roster word one status differently.
 *
 * @param {{status: string, label: string}} props `status` is the machine field
 *   and drives only paint; `label` is the already-worded one and is what a
 *   person reads.
 */
export function Badge({ status, label }) {
  return (
    <span className={`${s.badge} ${s.toned}`} data-status={status}>
      <span className={s.dot} aria-hidden="true" />
      {label}
    </span>
  )
}
