'use client'

/**
 * What was SENT: the assembled prompt, block by block, and what it cost.
 *
 * A component and not four blocks inline in the page because they were four
 * blocks inline in the page, each opening with its own `panel === 'prompt'`
 * guard, and four guards spelling one condition are exclusive only for as long
 * as everybody remembers to write the fourth. Here the condition is spelled
 * once, by the page, and this file cannot render under another instrument.
 *
 * `shown` is one PROMPT event — the prompt of one pass of the run, which the
 * page lets a reader step through, because a ReAct turn sends several and a
 * single slot would show the last and hide the rest.
 *
 * @param {{shown: object|null, usage: object|null}} props
 */
export function PromptPanel({ shown, usage }) {
  if (!shown) {
    return (
      <p className="hint">
        The complete prompt appears here as it is sent, block by block, with what each one costs and
        where the reusable prefix ends.
      </p>
    )
  }

  return (
    <>
      <div className="readout">
        {/* The signature: the prompt as a proportional band. Each block is as
            wide as its share of the tokens, the reusable prefix filled and
            everything after it hatched. The list below says what each block
            costs; this says what the costs are FOR — how much has to be read
            again, and which block is the reason. */}
        <div className="meter" data-testid="prompt-meter" aria-hidden="true">
          {shown.parts.map((part) => (
            <i
              key={part.id}
              className={part.cached ? 'cached' : part.volatility}
              style={{ flexGrow: Math.max(part.tokens, 1) }}
              title={`${part.id}: ${part.tokens} tokens`}
            />
          ))}
        </div>

        {/* Tokens, not characters: every limit that matters — the context
            window, the cache minimum, the bill — is counted in tokens, and the
            same characters cost wildly different numbers of them depending on
            what they are. */}
        <p className="figures" data-testid="prompt-meta">
          <span>
            <b>{shown.total.toLocaleString()}</b> tokens
          </span>
          <span>
            <b>{shown.cacheable.toLocaleString()}</b> reusable
          </span>
          {shown.brokenBy ? <span>prefix ends at {shown.brokenBy}</span> : null}
          {usage ? (
            <span className="measured" data-testid="usage">
              {usage.prompt.toLocaleString()} counted
              {usage.cached ? `, ${usage.cached.toLocaleString()} cached` : ''}
              {/* The endpoint's own timing, and the only measured duration on
                  this page. It arrives in the usage frame — which is why
                  `stream_options: {include_usage: true}` is load-bearing — and
                  it was collected, carried across the protocol and rendered
                  nowhere until this line. Absent when the provider reports
                  none, rather than shown as a zero that would read as instant. */}
              {usage.latency?.generationRate ? `, ${usage.latency.generationRate} tok/s` : ''}
            </span>
          ) : null}
        </p>
      </div>

      <ol className="layout" data-testid="prompt-layout">
        {shown.parts.map((part) => (
          <li key={part.id} className={part.cached ? 'cached' : ''}>
            <span className="id">{part.id}</span>
            <span className={`vol ${part.volatility}`}>{part.volatility}</span>
            <span className="tok">{part.tokens.toLocaleString()}</span>
          </li>
        ))}
      </ol>

      <pre data-testid="prompt-text">{shown.text}</pre>
    </>
  )
}
