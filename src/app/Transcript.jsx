'use client'

import { duration, verbFor, visibleStream } from './phrasing.js'

/**
 * What was said, and what the agent did between two things being said.
 *
 * Two registers in one scroller, and the boundary between them is the argument
 * of `docs/INTERFACE.md`: a message is CONVERSATION and is set generously; a
 * step is WORK and is set as one line that opens. The page this replaces put
 * work in conversation's clothing — a raw `shell({"command": "uname -a"})`
 * inside the transcript — and then deleted it when the turn ended, so a reply
 * saying "the step above shows where it came from" pointed at nothing.
 *
 * Steps are kept. They belong to the turn they were part of, not to the spinner
 * that happened to be up while they resolved.
 */
export function Transcript({
  scrollRef,
  messages,
  busy,
  run,
  onSay,
  onCopy,
  speaking,
  copied,
  observations,
}) {
  const live = visibleStream(run.raw)

  return (
    <div
      className="transcript"
      ref={scrollRef}
      data-testid="transcript"
      // The primary content of this application, and it had no landmark and no
      // heading at all: a screen reader had no way to reach the conversation.
      // `log` with a polite live region is what an arriving reply is.
      aria-label="Conversation"
      aria-live="polite"
      role="log"
    >
      {messages.map((message) => (
        <Turn
          key={message.id}
          message={message}
          onSay={onSay}
          onCopy={onCopy}
          speaking={speaking}
          copied={copied}
        />
      ))}

      {busy ? (
        <article className="turn assistant" data-testid="pending">
          <span className="who">assistant</span>
          <div className="body">
            <Steps steps={run.steps} observations={observations} thinking={live.thinking} />

            {/* The model's own scratchpad, while it is being written. Folded,
                because it is working and not an answer. */}
            {run.reasoning ? (
              <details className="thinking">
                <summary>thinking</summary>
                <div className="text" data-testid="reasoning">
                  {run.reasoning}
                </div>
              </details>
            ) : null}

            {/* The answer as it arrives, with the contract it is written in
                REMOVED — see `phrasing.visibleStream`. Someone who asked what
                17 times 4 is used to watch `think:`, `plan:` and `act: answer`
                stream past for the whole time they were paying most attention,
                and then watched all three vanish. */}
            {live.answer ? (
              <div className="text raw" data-testid="stream">
                {live.answer}
              </div>
            ) : null}

            {live.answer ? null : (
              <p className="hint" data-testid="waiting">
                {run.steps.length ? 'reading what came back…' : 'thinking…'}
              </p>
            )}
          </div>
        </article>
      ) : null}
    </div>
  )
}

function Turn({ message, onSay, onCopy, speaking, copied }) {
  const attachments = message.attachments ?? []
  const isAssistant = message.role === 'assistant'

  return (
    <article className={`turn ${message.role}`}>
      <span className="who">{message.role}</span>
      <div className="body">
        {attachments.length ? (
          <div className="attachments" data-testid={`attachments-${message.id}`}>
            {attachments.map((url) =>
              url.startsWith('data:image/') ? (
                // A data URL already in memory, never fetched, in a build that
                // exports statically with the image optimiser off.
                // biome-ignore lint/performance/noImgElement: nothing to optimise
                <img key={url} src={url} alt="attached" />
              ) : (
                <span className="other" key={url}>
                  {url.slice(5).split(';', 1)[0] || 'a file'}
                </span>
              ),
            )}
          </div>
        ) : null}

        {/* Written down by `ChatService` since the schema had one owner, round
            tripped through storage, and rendered NOWHERE — `docs/LEDGER.md`
            row S21. It is the model's working and not its answer, so it opens
            rather than sitting above the reply. */}
        {message.thinking ? (
          <details className="thinking">
            <summary data-testid={`thinking-${message.id}`}>how it got there</summary>
            <div className="text">{message.thinking}</div>
          </details>
        ) : null}

        <div className="text">{message.text}</div>

        {message.text ? (
          <div className="msg-actions">
            {/* The reviewer measured the old one at 74×17px and `opacity: 0`
                until hover — which on a touch screen is never, so the only
                per-message control in the product was invisible on the device
                where reading aloud matters most. It is a real control now, and
                the stylesheet keeps it visible wherever a pointer cannot
                hover. */}
            <button
              type="button"
              onClick={() => onCopy(message.text)}
              data-testid={`copy-${message.id}`}
            >
              {copied === message.text ? 'copied' : 'copy'}
            </button>
            {isAssistant ? (
              <button
                type="button"
                onClick={() => onSay(message.text)}
                aria-pressed={speaking === message.text}
                data-testid={`say-${message.id}`}
              >
                {speaking === message.text ? 'stop reading' : 'read aloud'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

/**
 * The passes of a run, each as a sentence that opens.
 *
 * The verb comes from `phrasing.verbFor`, which reads the tool's NAME and
 * nothing else. The call itself is rendered verbatim inside, exactly as
 * `RunPanel` renders it and for the same reason: `Toolbox.parse` is the one
 * thing in this application that decides what a call is, and a prettier
 * rendering here would be a second parser that agrees with it until the day it
 * does not.
 *
 * The last step is open while it is the one running, because the single thing a
 * person wants while waiting is evidence that something is happening. The
 * others are closed, because the answer is what was asked for.
 */
function Steps({ steps, observations = {}, thinking = '' }) {
  if (!steps.length) return thinking ? <p className="hint">{thinking}</p> : null

  return (
    <div className="steps" data-testid="steps">
      {steps.map((taken, index) => {
        if (taken.isAnswer) return null
        const result = observations[taken.step]
        const last = index === steps.length - 1
        return (
          <details
            className="step"
            key={taken.step}
            open={last && !result}
            data-state={result ? 'done' : 'running'}
            data-testid={`step-${taken.step}`}
          >
            <summary>
              <span className="dot" aria-hidden="true" />
              <span className="verb">{verbFor(taken.answer)}</span>
              <span className="step-time">{result?.ms ? duration(result.ms) : ''}</span>
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </summary>
            <div className="step-body">
              <pre className="call">{taken.answer}</pre>
              {result ? (
                <pre className="result" data-testid={`result-${taken.step}`}>
                  {result.observation}
                </pre>
              ) : (
                <p className="waiting">waiting for it to come back…</p>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
