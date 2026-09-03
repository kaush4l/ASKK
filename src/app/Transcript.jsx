'use client'

import { duration, linked, verbFor, visibleStream } from './phrasing.js'

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
  onShare,
  speaking,
  copied,
  observations,
  failed,
  onRetry,
}) {
  const live = visibleStream(run.raw)
  /**
   * The last turn's work, attached to the reply that turn produced.
   *
   * It used to live only inside the `busy` branch, so every step vanished the
   * moment the answer arrived — and the answer, written by a model that had
   * just been shown its own scratchpad, says things like "the step above shows
   * where it came from". A reviewer read that sentence with nothing above it,
   * twice, in two separate reviews. The steps were kept in state and shown in
   * the drawer, which is a place nobody had been told to look.
   *
   * `run.message` NAMES the reply, and the sentence that used to be here said
   * an older reply could not be given the work of a newer one while the code
   * did exactly that: the steps went to the last assistant message in the list,
   * which is the right one only while every turn produces one. A turn that
   * failed and a turn that was stopped both append nothing at all, so their
   * steps landed on the answer above them — turn two's `shell(...)` drawn over
   * turn one's answer, in a transcript that said turn one had run it.
   */
  const finished = run.steps.filter((step) => !step.isAnswer)

  return (
    <div
      className="transcript"
      ref={scrollRef}
      data-testid="transcript"
      // The primary content of this application, and it had no landmark and no
      // heading at all: a screen reader had no way to reach the conversation.
      // `log` with a polite live region is what an arriving reply is.
      aria-label="Conversation"
      // `role="log"` already announces additions politely, so an explicit
      // `aria-live` on top of it was a second declaration of the same thing
      // over unbounded growing content. What is narrowed here is WHAT counts as
      // a change: text and new turns, not every attribute a re-render touches.
      aria-relevant="additions text"
      role="log"
    >
      {messages.map((message, at) => (
        <Turn
          key={message.id}
          message={message}
          onSay={onSay}
          onCopy={onCopy}
          onShare={onShare}
          speaking={speaking}
          copied={copied}
          steps={run.message && message.id === run.message ? finished : null}
          observations={observations}
          // The turn that did not complete, marked where it happened — and now
          // from the RECORD, which is `message.marker` and is read inside
          // `Turn`. This prop is what is left of the old way: the page held the
          // last failure in state, and state is cleared by the next question,
          // so a reviewer sent a second question and watched the first one stop
          // explaining itself — a transcript indistinguishable from one where
          // nothing had been sent.
          //
          // It stays as the FALLBACK, for the window between a turn failing and
          // the page appending the record `ChatService` hands back. Suppressed
          // the moment that record is there, because the two are one fact and
          // drawing it twice would put two retries under one question.
          //
          // On the message's IDENTITY, not on its words. Matching the text
          // marked every message that said the same thing: ask the same
          // question twice and let the second one fail, and the answered turn
          // above it wore "This one did not get an answer" as well.
          failed={message.id === failed?.id && messages[at + 1]?.marker !== 'failed'}
          // The question a marker belongs to, so the retry beside it knows what
          // to send. It cannot come from page state any more: the whole point
          // of the marker is that it is still there after a reload, and after a
          // reload the only thing that remembers the question is the transcript.
          question={askedBefore(messages, at)}
          onRetry={onRetry}
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

/**
 * The question a record at `at` belongs to.
 *
 * A turn that produced no reply leaves a wordless marker where the reply would
 * have been, and the retry drawn on it has to re-send something. Walking back
 * to the nearest `user` turn is what a reader does by eye, and it is the only
 * source that survives what the marker exists to survive: after a reload there
 * is no page state left holding the question, only the transcript.
 *
 * The marker itself may be the user's own message — a scheduled question is
 * marked on the question — so the walk starts AT `at` rather than before it.
 *
 * The literals are spelled out rather than imported from `core/Message.js`:
 * `app/` may not import `core/`, which `test/architecture/layers.test.js`
 * enforces, and `Turn` already reads `message.role === 'assistant'` this way.
 */
function askedBefore(messages, at) {
  for (let back = at; back >= 0; back -= 1) {
    if (messages[back].role === 'user') return messages[back]
  }
  return null
}

/**
 * Text, with the addresses in it as links.
 *
 * `rel="noreferrer"` and a new tab, because the text was written by a MODEL and
 * may quote a page it read: this app should not hand that page a referrer
 * naming where the person was, and should not take them away from a
 * conversation they are in the middle of. `phrasing.linked` decides what counts
 * as an address, and it only ever says yes to http and https.
 */
function Words({ said }) {
  const pieces = linked(said)
  if (pieces.length === 1 && !pieces[0].href) return pieces[0].text
  return pieces.map((piece, at) =>
    piece.href ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one string, in order, and the string is the identity
      <a key={at} href={piece.href} target="_blank" rel="noreferrer">
        {piece.text}
      </a>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: same
      <span key={at}>{piece.text}</span>
    ),
  )
}

function Turn({
  message,
  onSay,
  onCopy,
  onShare,
  speaking,
  copied,
  steps,
  observations,
  failed,
  question,
  onRetry,
}) {
  const attachments = message.attachments ?? []
  const isAssistant = message.role === 'assistant'

  return (
    <article className={`turn ${message.role}`}>
      <span className="who">{message.role}</span>
      <div className="body">
        {/* Who asked, above the words, because it changes how they are read.
            A schedule appends an ordinary `user` turn, so coming back to a tab
            after a few hours showed a history of questions attributed to
            somebody who never asked them — and the same question asked once by
            hand and once on a timer was two identical rows. */}
        {message.marker === 'scheduled' ? (
          <p className="hint" data-testid="scheduled">
            You did not ask this — a schedule you set did, at the time it was due.
          </p>
        ) : null}

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
        {/* What the agent DID on the way here, above the answer it produced,
            because that is the order it happened in. */}
        {steps?.length ? <Steps steps={steps} observations={observations} /> : null}

        {message.thinking ? (
          <details className="thinking">
            <summary data-testid={`thinking-${message.id}`}>what it was thinking</summary>
            <div className="text">{message.thinking}</div>
          </details>
        ) : null}

        <div className="text">
          <Words said={message.text} />
        </div>

        {/* What became of the turn, read off the record it was written on.
            Both of these used to be a toast: the failed one was cleared by the
            next question, and the stopped one did not survive a reload at all —
            two ways of showing a person something and then taking it away
            before they could act on it. The words are chosen here rather than
            stored, so rewording them is not a migration. */}
        {failed || message.marker === 'failed' ? (
          <p className="unfinished" data-testid="unfinished">
            This one did not get an answer.
            {/* The question comes from the transcript, so this still works on a
                page that has just been reloaded and has no memory of the turn. */}
            <button type="button" onClick={() => onRetry?.(question)} data-testid="retry-turn">
              try it again
            </button>
          </p>
        ) : null}

        {message.marker === 'stopped' ? (
          <p className="unfinished" data-testid="stopped">
            You stopped this one, so it ended where it was with no answer.
          </p>
        ) : null}

        {message.text ? (
          <div className="msg-actions">
            {/* Present and quiet rather than hidden behind a hover. The
                control this replaces was `opacity: 0` until the message was
                hovered — a reviewer reported never finding it — though the
                stylesheet did already reveal it under `@media (hover: none)`,
                so it was visible on a touch screen. What was true everywhere is
                that a control you have to discover by sweeping a pointer across
                the page is a control most people never find. */}
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
            {/* Offered only where there IS something to share with. `share` is
                on Safari and on Android and not on desktop Firefox, and a
                control that does nothing is worse than one that is not there. */}
            {isAssistant && typeof globalThis.navigator?.share === 'function' ? (
              <button
                type="button"
                onClick={() => onShare(message.text)}
                data-testid={`share-${message.id}`}
              >
                share
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
              <span className="verb">{verbFor(taken.answer, Boolean(result))}</span>
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
