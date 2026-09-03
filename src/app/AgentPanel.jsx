'use client'

import { doingWord } from './phrasing.js'

/**
 * What a tool does, in the words this app already has for it.
 *
 * `phrasing.js` owns that vocabulary — the transcript's step lines and the one
 * line at the top of the screen both read from it — and this panel was the
 * screen that ignored it. It listed `shell`, `read_file`, `write_file`,
 * `search`, `fetch`, `researcher` and `check_task`: seven identifiers, on the
 * same screen whose heading asks what this agent can do, in an app that
 * elsewhere says "Ran a command on the Linux machine in this tab".
 *
 * `doingWord` takes a tool's NAME, which is exactly what an agent file's
 * `tools:` list holds, so nothing here parses anything or decides anything. A
 * second table in this file would agree with that one right up until an agent
 * gained a tool, and from then on this screen would be confidently wrong about
 * what it can do — which is the one thing it exists to be right about.
 *
 * The empty string is for a name `phrasing.js` has no words for. Its documented
 * answer there is the name handed back inside a frame — `using researcher` —
 * and printed beside the name itself that reads as a stutter. So an unknown
 * name is shown as itself, which is honest: it is another agent, or a tool a
 * connected program offers, and the name is the only true thing anyone knows
 * about it here.
 *
 * `verbFor` is the other door into the same words and it is the wrong one for
 * this list: it reads a CALL, because it labels a step that ran. Nothing on
 * this screen has run. These chips are what could be asked for, so the reading
 * that takes a bare name is the one that fits.
 */
function phraseFor(tool) {
  const said = doingWord([tool])
  return said === `using ${tool}` ? '' : said
}

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
  // invented ones, because a field this component guessed at would send an
  // agent that declared three terms down the branch below for an agent that
  // declared none.
  const budget = agent.budget ?? {}
  const declared = Boolean(budget.steps || budget.tokens || budget.seconds)

  // The file these terms are written in, named as the catalogue named it when
  // it read the agent — `agents/<name>/agent.md`. Taken off the record rather
  // than assembled here, with the catalogue's own convention as the fallback
  // for a record that carries no source, because the one useful thing to tell
  // somebody who wants a different ceiling is which file to open.
  const source = agent.source || `agents/${agent.name}/agent.md`

  // Said only about the currencies this agent actually names. A sentence
  // explaining seconds, under a budget that declares none, is this screen
  // teaching somebody the vocabulary of a limit that is not in force.
  const meaning = [
    budget.steps
      ? 'A step is one turn of its loop — think, use a tool, read what came back — and the last one it is allowed is told to answer with what it has rather than being cut off mid-sentence.'
      : '',
    budget.tokens
      ? 'Tokens count everything sent and everything said back, which is the instructions and the whole conversation and not only your question.'
      : '',
    budget.seconds ? 'Seconds are wall clock, from the moment the question starts.' : '',
    // Only where something actually is unnamed. Under an agent that states all
    // three, this sentence describes nothing, and a line of true prose about a
    // case that does not arise is how a paragraph stops being read at all.
    budget.steps && budget.tokens && budget.seconds
      ? ''
      : "Anything not named here takes the loop's standing default.",
  ]
    .filter(Boolean)
    .join(' ')

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
            {tools.map((tool) => {
              const does = phraseFor(tool)
              // The real name stays, dimmer and second, and the separator is the
              // one the servers below already use. It is the spelling that
              // `agents/…/agent.md` carries under `tools:`, and somebody adding
              // or removing one has to type it exactly — a screen that had
              // translated it away would leave them guessing at the name of the
              // thing they are editing.
              return (
                <li key={tool} data-testid={`agent-tool-${tool}`}>
                  {does ? (
                    <>
                      {does}
                      <span className="dim"> · {tool}</span>
                    </>
                  ) : (
                    tool
                  )}
                </li>
              )
            })}
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
        {declared ? (
          <>
            {/* The numbers, and then what they are numbers OF. Three figures in
                a row with no sentence under them was a readout for whoever
                already knew: "8" and "600s" say nothing about which of them
                stops a run that is looping, and a person reading this screen is
                usually reading it because something took longer than they
                expected. The unit words are spelled out for the same reason —
                `s` is a keystroke saved from the reader's understanding. */}
            <p className="figures">
              {budget.steps ? (
                <span>
                  <b>{budget.steps}</b> {budget.steps === 1 ? 'step' : 'steps'}
                </span>
              ) : null}
              {budget.tokens ? (
                <span>
                  <b>{budget.tokens.toLocaleString('en-US')}</b>{' '}
                  {budget.tokens === 1 ? 'token' : 'tokens'}
                </span>
              ) : null}
              {budget.seconds ? (
                <span>
                  <b>{budget.seconds}</b> {budget.seconds === 1 ? 'second' : 'seconds'}
                </span>
              ) : null}
            </p>
            <p className="hint" style={{ margin: '0.35rem 0 0' }}>
              {meaning}
            </p>
          </>
        ) : (
          /* "no ceiling declared" was true and useless: it named no unit, and
             it left a reader with nothing to do about it. The standing numbers
             themselves are not printed here, and that is a decision rather than
             an omission — they live in `src/core/engine/Budget.js`, this layer
             reaches the backend through one client and imports nothing from the
             core (measured: no file under `src/app/` does), and three numbers
             copied across would be wrong the first time somebody tuned them.
             What this screen can say truthfully is where the terms are written,
             and the record it was handed carries that. */
          <p className="hint" style={{ margin: 0 }}>
            Nothing declared, so all three fall to the standing defaults this loop was built with.
            The terms belong to the agent rather than to this screen: add a <code>budget:</code>{' '}
            block — <code>steps</code>, <code>tokens</code> or <code>seconds</code>, any one of them
            on its own — to <code>{source}</code>.
          </p>
        )}
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
