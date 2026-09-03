'use client'

/**
 * Who you are actually talking to.
 *
 * `agents.get` has existed since `AgentService` was written and had zero
 * callers: an agent's instructions, its tools, its budget and the servers it
 * declares were invisible in the running app, and the only surface any of it
 * ever reached was a note in a list at the bottom of the screen. A reviewer's
 * summary of that was that the app "hints at capabilities it does not deliver"
 * — the empty screen promised a Linux machine and the notes said something
 * about a server not running, and nothing anywhere said what this agent can
 * actually do.
 *
 * Nothing here is new capability. It is one existing route, called.
 *
 * @param {{agent: object|null, notes: string[]}} props
 */
export function AgentPanel({ agent, notes = [] }) {
  if (!agent) {
    return (
      <p className="hint">
        Who you are talking to, what it is allowed to do, and how much it may spend on one question.
      </p>
    )
  }

  const tools = agent.tools ?? []
  const servers = agent.mcp ?? []
  // `AgentSpec` spells its ceilings `steps`, `tokens` and `seconds` — the
  // currencies a run actually spends. Read by those names rather than by
  // invented ones, because a field this component guessed at renders as "no
  // ceiling declared" for an agent that declared three.
  const budget = agent.budget ?? {}

  return (
    <div className="agentview" data-testid="agent-view">
      <div>
        <h3>who</h3>
        <p className="hint" style={{ margin: 0 }}>
          <strong>{agent.name}</strong>
          {agent.description ? ` — ${agent.description}` : ''}
        </p>
      </div>

      <div>
        <h3>what it can do</h3>
        {tools.length ? (
          <ul className="taglist" data-testid="agent-tools">
            {tools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            Nothing but answer. This agent has no tools.
          </p>
        )}
      </div>

      {/* The only place any of this has ever been visible. A server that is
          declared and has not started yet is a fact about this agent, and it
          belongs here rather than pinned under every reply a person reads. */}
      {servers.length ? (
        <div>
          <h3>connected programs</h3>
          <ul className="taglist" data-testid="agent-servers">
            {servers.map((server) => (
              <li key={server.name} data-state={server.remote ? 'on' : 'off'}>
                {server.name}
                {server.remote ? ' · elsewhere' : ' · in this tab'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3>what one question may cost</h3>
        <p className="figures">
          {budget.steps ? (
            <span>
              <b>{budget.steps}</b> steps
            </span>
          ) : null}
          {budget.tokens ? (
            <span>
              <b>{budget.tokens.toLocaleString('en-US')}</b> tokens
            </span>
          ) : null}
          {budget.seconds ? (
            <span>
              <b>{budget.seconds}</b>s
            </span>
          ) : null}
          {budget.steps || budget.tokens || budget.seconds ? null : (
            <span className="dim">no ceiling declared</span>
          )}
        </p>
      </div>

      {notes.length ? (
        <div>
          <h3>from the last question</h3>
          <ul className="notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3>its instructions</h3>
        <pre className="instructions" data-testid="agent-instructions">
          {agent.system ?? ''}
        </pre>
      </div>
    </div>
  )
}
