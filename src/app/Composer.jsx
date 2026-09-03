'use client'

import { useEffect, useRef } from 'react'

/**
 * Where a question is written, and everything that can be added to one.
 *
 * A component and not markup inside the page because it now has four controls
 * and two kinds of state of its own, and because the page had grown to 1,298
 * lines with every one of them inline.
 *
 * Three defects a usability review measured are answered here and each is named
 * where it is fixed: the field was a single-line `<input>` in an app whose own
 * prompt tells the model to write files; the microphone said "listening" with
 * nothing to show that it could hear; and there was no way to attach anything
 * to a question, in an app whose inference layer has taken attachments since it
 * was written.
 */
export function Composer({
  draft,
  onDraft,
  onSend,
  ready,
  busy,
  writer,
  listening,
  level = 0,
  onDictate,
  onStop,
  attachments = [],
  onAttach,
  onDrop,
}) {
  const field = useRef(null)
  const picker = useRef(null)

  /**
   * Grow with what is typed, up to the cap the stylesheet sets.
   *
   * Measured against the alternative of a fixed height: the composer is a
   * textarea now, and a textarea that does not grow is a single-line input with
   * a scrollbar — worse than what it replaced, because the text a person cannot
   * see is text they believe they deleted.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured on every change of the text
  useEffect(() => {
    const node = field.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [draft])

  const blocked = writer === false
  const canSend = ready && !busy && !blocked && (draft.trim() || attachments.length)

  function submit(event) {
    event.preventDefault()
    if (!canSend) return
    onSend()
  }

  /**
   * Enter sends and Shift+Enter breaks the line.
   *
   * The convention every messaging application uses, and it has to be said out
   * loud in the placeholder because it is invisible: the reviewer's list of
   * things a first-time user could not discover has "that Enter sends" on it.
   *
   * `isComposing` is checked because an IME's own Enter — the one that accepts
   * a candidate — arrives here as a keydown, and sending on it would submit a
   * half-typed word in every language that uses one.
   */
  function onKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    if (canSend) onSend()
  }

  return (
    <div className="dock">
      {/* Said where the person is about to type, and said as the reason rather
          than as an error: another tab of theirs is holding this conversation,
          which is not a fault and is fixed by closing it. A composer that is
          simply dead reads as a bug in the app. */}
      {blocked ? (
        <p className="readeronly" data-testid="reader-only">
          Another tab has this conversation open and is the one that can write to it. Close it, or
          switch this tab to a different conversation, and this composer comes back.
        </p>
      ) : null}

      <div className="composerbox">
        {attachments.length ? (
          <div className="attachrow" data-testid="attachments">
            {attachments.map((one, index) => (
              <span className="chip" key={one.url}>
                {/* A data URL the person just chose, held in memory and never
                    fetched, in a build that exports statically with the image
                    optimiser off. */}
                {one.url.startsWith('data:image/') ? (
                  // biome-ignore lint/performance/noImgElement: nothing to optimise
                  <img src={one.url} alt="" />
                ) : null}
                {one.name}
                <button
                  type="button"
                  onClick={() => onAttach(attachments.filter((_, at) => at !== index))}
                  aria-label={`Remove ${one.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <form className="composer" onSubmit={submit}>
          {/* The one control here that is new capability rather than repaired
              capability. `Multimodality`, both providers and `Engine.step` have
              taken attachments since they were written and no caller ever
              passed one. */}
          <button
            type="button"
            className="act"
            onClick={() => picker.current?.click()}
            disabled={!ready || blocked}
            aria-label="Attach a file"
            title="Attach a file"
            data-testid="attach"
          >
            <span aria-hidden="true">＋</span>
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*,audio/*,video/*"
            multiple
            hidden
            data-testid="attach-picker"
            onChange={(event) => {
              onDrop?.([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />

          <textarea
            ref={field}
            rows={1}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              onDrop?.([...(event.dataTransfer?.files ?? [])])
            }}
            onPaste={(event) => {
              // An image on the clipboard, which is how a screenshot actually
              // reaches an application. Only intercepted when there IS one:
              // pasted text must go on behaving like pasted text.
              const files = [...(event.clipboardData?.files ?? [])]
              if (!files.length) return
              event.preventDefault()
              onDrop?.(files)
            }}
            placeholder={
              blocked
                ? 'another tab is writing this conversation'
                : ready
                  ? 'Ask anything — Enter to send, Shift+Enter for a new line'
                  : 'starting…'
            }
            disabled={!ready || blocked}
            aria-label="Your message"
            data-testid="input"
          />

          {/* Not disabled while a turn is in flight. Dictating the next message
              while the model answers the last one is the normal way to use
              this, and the two run on different threads so it can. */}
          <button
            type="button"
            className="act mic"
            onClick={onDictate}
            disabled={!ready}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictating' : 'Dictate'}
            title={listening ? 'Stop dictating' : 'Dictate'}
            data-testid="mic"
          >
            <span aria-hidden="true">◉</span>
            {/* A level meter, and it exists because "listening" is a claim. An
                interface that says it is listening while the microphone is
                muted, or while the browser handed back a dead track, is
                indistinguishable from a slow model. */}
            {listening ? (
              <span className="level" aria-hidden="true" data-testid="level">
                <span style={{ width: `${Math.min(100, Math.round(level * 100))}%` }} />
              </span>
            ) : null}
          </button>

          {/* One control, two halves of a run: while a turn is in flight there
              is nothing to send and the only useful thing to press is stop, so
              the button becomes it rather than sitting greyed out beside a
              second one that only ever appears here. */}
          {busy ? (
            <button
              type="button"
              className="act stop"
              onClick={onStop}
              aria-label="Stop"
              data-testid="stop"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="act send"
              disabled={!canSend}
              aria-label="Send"
              data-testid="send"
            >
              <span aria-hidden="true">↑</span>
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
