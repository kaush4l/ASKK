import { Badge } from './badge'
import s from './ui.module.css'

/**
 * @typedef {object} CallData one tool call, as the transcript carries it.
 * @property {string} id           stable across polls, so the VDOM can key it
 * @property {'call'} row          which arm of the transcript's union this is:
 *   a call is not something anybody SAID, and the tag is what stops the two
 *   from being rendered by one component that then has to guess
 * @property {string} name         the tool, as the model spelled it
 * @property {string} status       pending · calling · ok · failed, and the
 *   middle two are the kernel's own words (`STATUSES`)
 * @property {string} statusLabel  the same fact in words, and the primary channel
 * @property {string} argsLabel    what it was called with, already one line
 * @property {string} resultLabel  what came back, '' while nothing has
 */

/** The two states with nothing to open yet. Layout, not a fact: the core says
 *  which state this is, and this decides how much room it takes. */
const IN_FLIGHT = ['pending', 'calling']

/**
 * THE WORK BETWEEN THE TURNS, IN FOUR STATES — pending, running, complete,
 * failed — AND ONE LINE OF IT WHILE IT RUNS.
 *
 * A transcript is unreadable when a running call takes eight lines to say it
 * has no answer yet, and it is unreadable the other way when a finished call
 * hides the output the person is reading the transcript FOR. The predecessor
 * had one shape for both and chose collapsed, so every result needed a press;
 * this stays one line until there is something to read and then opens itself.
 *
 * `<details>` and not a state hook: the browser owns disclosure, a press works
 * before any script has run, and the static export renders the open state into
 * the HTML. `open` is decided from `status` — which is presentation, chosen
 * here, from a fact the core sent (I5).
 *
 * @param {{data: CallData}} props
 */
export function Inspector({ data }) {
  const summary = (
    <>
      <code className={s.callName}>{data.name}</code>
      <span className={s.callArgs}>{data.argsLabel}</span>
      <Badge status={data.status} label={data.statusLabel} />
    </>
  )
  const flying = IN_FLIGHT.includes(data.status)
  if (!data.resultLabel) {
    return (
      <div className={`${s.call} ${s.callHead}`} data-row={data.row} data-status={data.status} data-flying={String(flying)}>
        {summary}
      </div>
    )
  }
  return (
    <details className={s.call} data-row={data.row} data-status={data.status} data-flying={String(flying)} open={!flying}>
      <summary className={s.callHead}>{summary}</summary>
      <pre className={s.callResult}>{data.resultLabel}</pre>
    </details>
  )
}
