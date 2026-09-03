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
 * The OBSERVATION is here now. `ReActEngine.run` pushed `{action, observation}`
 * onto its own scratchpad and handed the observation to no callback for the
 * whole life of this file, so a reader could see what the agent TRIED and never
 * what came back — which is the half of a tool call a person actually reads.
 * `onObservation` and `EventName.OBSERVATION` closed that; this renders it,
 * verbatim, for the same reason the call is verbatim.
 *
 * @param {{run: {steps: object[], ms: number}, usage: object|null,
 *   observations: Record<number, {observation: string}>}} props
 */
export function RunPanel({ run, usage, observations = {} }) {
  if (!run.steps.length) {
    return (
      <p className="hint">
        Every pass of a run lands here as it resolves — the calls the agent wrote, word for word,
        what each one answered, and the reply it finished on. It stays until the next turn replaces
        it.
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
            {observations[taken.step] ? (
              <pre className="result" data-testid={`run-result-${taken.step}`}>
                {observations[taken.step].observation}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  )
}
