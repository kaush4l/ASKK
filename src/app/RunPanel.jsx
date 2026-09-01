'use client'

/**
 * WHAT THE AGENT DID, and it stays after the turn ends.
 *
 * Every entry is one STEP event — the same event the transcript draws while the
 * spinner is up and the same one `scripts/dryrun.js` reads. Nothing here is a
 * second channel: inventing one is the defect this tree shipped when two
 * writers disagreed about a schema and silently erased a field.
 *
 * The call is rendered VERBATIM, exactly as the model wrote it, and that is a
 * decision rather than laziness. `Toolbox.parse` is the one thing in this
 * application that decides what a call is; a pretty rendering here would be a
 * second parser, in another realm, that agrees with it until the day it does
 * not — and the day it does not, the page shows a call that never ran.
 *
 * What is NOT here: the OBSERVATION. `ReActEngine.run` pushes
 * `{action, observation}` onto its scratchpad and hands the observation to no
 * callback, so nothing outside the engine can see what a tool answered.
 * Surfacing it is a change in `src/core/`, which this slice does not own; it is
 * reported and not fixed.
 *
 * @param {{run: {steps: object[], ms: number}, usage: object|null}} props
 */
export function RunPanel({ run, usage }) {
  if (!run.steps.length) {
    return (
      <p className="hint">
        Every pass of a run lands here as it resolves — the calls the agent wrote, word for word,
        and the reply it finished on. It stays until the next turn replaces it.
      </p>
    )
  }

  return (
    <>
      <div className="readout">
        <p className="figures" data-testid="run-meta">
          <span>
            <b>{run.steps.length.toLocaleString()}</b> {run.steps.length === 1 ? 'step' : 'steps'}
          </span>
          {run.ms ? (
            <span>{(run.ms / 1000).toFixed(1)}s</span>
          ) : (
            <span className="measured">running</span>
          )}
          {usage ? <span className="measured">{usage.prompt.toLocaleString()} counted</span> : null}
        </p>
      </div>
      <ol className="runlog" data-testid="run-log">
        {run.steps.map((taken) => (
          <li
            key={taken.step}
            className={taken.isAnswer ? 'answered' : 'called'}
            data-testid={`run-step-${taken.step}`}
          >
            <span className="id">{taken.isAnswer ? 'answered' : `step ${taken.step}`}</span>
            {taken.thinking ? <p className="thought">{taken.thinking}</p> : null}
            <pre className="call">{taken.answer}</pre>
          </li>
        ))}
      </ol>
    </>
  )
}
