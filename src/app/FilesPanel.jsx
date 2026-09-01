'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { highlight, LANGUAGES, languageOf } from '../client/highlight.js'

/**
 * How many coloured spans this view will put in the document.
 *
 * A cap on the DOM and not on the file, because measurement says the file is
 * not the expensive half. `highlight` over 64 KiB — the largest file this store
 * will hold, `core/tools/FilesPort.js` — takes 0.29 ms and yields 2,078 tokens
 * on real source, so every ordinary file colours whole. The number that can run
 * away is the token COUNT: 64 KiB of `1 1 1 1 …` is 65,536 tokens in 3.3 ms, so
 * the scan is still nothing and the render is 65,536 elements React has to
 * reconcile. Measured 2026-09-01.
 *
 * Over the cap the same text is shown in one plain block and the reader is TOLD
 * it lost its colours. Nothing is truncated and nothing is streamed: the store's
 * own 64 KiB cap is below the size at which either would buy anything, which is
 * the argument `backend/services/FilesService.js` makes for reading a file
 * whole.
 */
const MAX_COLOURED_TOKENS = 4000

/**
 * Wall-clock, because "3 minutes ago" needs a timer to stay true and this does
 * not. The reader's own clock and not a format this file cut out of a longer
 * string by index: a 12-hour locale gets a 12-hour stamp.
 */
const clock = (millis) => new Date(millis).toLocaleTimeString()

/**
 * The agent's files, for the person who owns them.
 *
 * The store has existed for a wave and the page had no route to it — the
 * accountant's line was "the agent has a filesystem and its owner cannot see
 * it". This is the reader. It lists, opens, colours and hands over a copy, and
 * it writes nothing: `backend/services/FilesService.js` argues that decision
 * and names the compare-and-set a save would have to arrive with.
 *
 * ## A file the agent is mid-write on
 *
 * Cannot be seen half-written. A write is one whole-record `put` in one
 * transaction, so a read returns the version before it or the version after it.
 * What a reader CAN hold is a stale one, and the whole of this component's
 * answer to that is: every open is stamped with the moment it was read, there
 * is a re-read beside the stamp, and the listing refreshes when a turn ends —
 * which is `turnsDone`, below. It does not poll. A file view that redrew itself under
 * someone's eyes while they were reading would be worse than a stale one that
 * says when it was taken.
 *
 * @param {{client: import('../client/BackendClient.js').BackendClient, turnsDone: number}} props
 *   `turnsDone` is a trigger, not a value this reads — it changes when a turn
 *   finishes, which is the only moment the workspace can have changed.
 */
export function FilesPanel({ client, turnsDone }) {
  // `null` until the first listing answers, so an empty workspace and an
  // unanswered one are different things on screen. They were the same thing for
  // one draft of this and it read as "you have no files" while the call was
  // still in flight.
  const [files, setFiles] = useState(null)
  const [open, setOpen] = useState(null)
  const [problem, setProblem] = useState('')
  const [reading, setReading] = useState('')
  // The path whose reply this view still wants. Two clicks in quick succession
  // are two calls in flight and the backend answers whichever finishes first,
  // so without this the first reply's `setReading('')` cleared the second's
  // badge and the slower file won the pane. A ref and not state: it is read
  // inside a reply that already knows nothing rendered since it was set.
  const wanted = useRef('')

  const list = useCallback(async () => {
    const result = await client.call('files.list')
    if (!result.ok) {
      setProblem(result.error.message)
      return
    }
    setProblem('')
    setFiles(result.value)
  }, [client])

  const read = useCallback(
    async (path) => {
      wanted.current = path
      setReading(path)
      const result = await client.call('files.read', { path })
      // A reply nobody is waiting for any more. Dropped whole rather than
      // applied and overwritten: applying it would clear the badge on the read
      // that IS still running and flash the wrong file into the pane.
      if (wanted.current !== path) return
      setReading('')
      if (!result.ok) {
        setProblem(result.error.message)
        return
      }
      setProblem('')
      // A `null` value is a file that is no longer there. No tool deletes —
      // `core/tools/FilesPort.js` says so — so through this app's own agent
      // this cannot happen, and the ways left are a second tab and the
      // browser's own storage controls. It is still an ordinary answer from the
      // store rather than a failure, so it is shown as what it is. The listing
      // that offered the name is now known to be stale, which is why the whole
      // of it is asked for again: a pane saying a file is gone above a list
      // still offering it is worse than either.
      if (!result.value) {
        setOpen({ path, text: null, bytes: 0, readAt: Date.now() })
        list()
        return
      }
      setOpen({ ...result.value, readAt: Date.now() })
    },
    [client, list],
  )

  // Re-listed when a turn ends, because that is when the workspace changes.
  // `list` is stable, `turnsDone` is the trigger; dropping it would list once,
  // on mount, and then quietly show yesterday's names for the rest of the
  // session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `turnsDone` is a trigger, not a value read here
  useEffect(() => {
    list()
  }, [list, turnsDone])

  // The open file, re-read when a turn ends, so the pane a person left open
  // does not go on showing text the agent has replaced. Deliberately separate
  // from the listing effect: they refresh together and they fail apart, and one
  // effect doing both would leave a stale body behind a fresh listing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `turnsDone` is the trigger; re-reading on `open` would loop
  useEffect(() => {
    if (turnsDone && open?.path) read(open.path)
  }, [turnsDone])

  // Memoised on the open file, because this component's parent re-renders once
  // per streamed chunk — `OpenAICompatible.stream` calls `onDelta` per SSE
  // frame, which is one `setRun` each — so a file left open during a turn was
  // re-scanned hundreds of times for a body that had not changed.
  const tokens = useMemo(() => (open?.text ? highlight(open.text, open.path) : []), [open])
  const coloured = tokens.length > 0 && tokens.length <= MAX_COLOURED_TOKENS
  // The token's position in the file is its identity — stable across a re-read
  // that changed nothing, and meaningful, which an array index is neither.
  //
  // Built only when they will be DRAWN. Over the cap these were 65,536 objects
  // allocated and thrown away: on the pathological 64 KiB the map alone is
  // 2.84 ms against the scan's 2.10 ms, so the discarded half cost MORE than
  // the scan the cap above was written about. Measured 2026-09-01, this
  // machine, ten runs each after a warm-up.
  const spans = useMemo(() => {
    if (!coloured) return []
    let offset = 0
    return tokens.map((token) => {
      const key = offset
      offset += token.text.length
      return { key, ...token }
    })
  }, [tokens, coloured])

  return (
    <>
      <div className="readout files" data-testid="files-readout">
        <p className="figures">
          <span>
            <b>{files ? files.length.toLocaleString() : '—'}</b> files
          </span>
          {open ? <span>read at {clock(open.readAt)}</span> : null}
          {open?.text != null ? (
            <span>
              <b>{open.bytes.toLocaleString()}</b> bytes
            </span>
          ) : null}
          {/* Said out loud rather than implied by the absence of a save button.
              A person who can see their files and cannot change them is owed the
              reason, not left to discover it by trying. */}
          <span className="measured">read-only</span>
        </p>
      </div>

      {problem ? (
        <p className="hint" data-testid="files-problem">
          {problem}
        </p>
      ) : null}

      <div className="files-body">
        <ol className="filelist" data-testid="file-list">
          {files?.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className={open?.path === file.path ? 'on' : ''}
                onClick={() => read(file.path)}
                data-testid={`file-${file.path}`}
              >
                {file.path}
                {reading === file.path ? <span className="badge">reading…</span> : null}
              </button>
            </li>
          ))}
          {files?.length === 0 ? (
            <li className="none" data-testid="files-empty">
              The agent has not written anything yet.
            </li>
          ) : null}
        </ol>

        {open ? (
          <div className="fileview">
            <header>
              <span className="id" data-testid="file-open">
                {open.path}
              </span>
              <div className="steps">
                <button type="button" onClick={() => read(open.path)}>
                  re-read
                </button>
                {open.text != null ? (
                  <button type="button" onClick={() => save(open)} data-testid="file-download">
                    download
                  </button>
                ) : null}
              </div>
            </header>

            {open.text == null ? (
              <p className="hint" data-testid="file-gone">
                {open.path} is not in the workspace any more.
              </p>
            ) : null}

            {open.text === '' ? (
              <p className="hint" data-testid="file-empty">
                {open.path} is there and has nothing in it.
              </p>
            ) : null}

            {tokens.length > MAX_COLOURED_TOKENS ? (
              <p className="hint" data-testid="file-plain">
                {tokens.length.toLocaleString()} coloured runs is more than this view will draw, so{' '}
                {open.path} is shown plain. All {open.bytes.toLocaleString()} bytes of it are here.
              </p>
            ) : null}

            {/* Asked and answered where the question comes up. A reader who
                opens `main.rs`, sees no colour and is told nothing has to guess
                whether the highlighter is broken or the language is simply not
                one of them; this is the list saying which. It is the module's
                own `LANGUAGES`, so a language added there says so here without
                a second list to keep in step. */}
            {open.text && !languageOf(open.path) ? (
              <p className="hint" data-testid="file-unknown-language">
                Nothing here knows what {open.path} is written in, so it is shown plain. This view
                colours {LANGUAGES.join(', ')}.
              </p>
            ) : null}

            {open.text ? (
              <pre className="code" data-language={languageOf(open.path)} data-testid="file-text">
                {coloured
                  ? spans.map((token) =>
                      token.kind === 'plain' ? (
                        token.text
                      ) : (
                        <span key={token.key} className={`tok ${token.kind}`}>
                          {token.text}
                        </span>
                      ),
                    )
                  : open.text}
              </pre>
            ) : null}
          </div>
        ) : (
          <p className="hint" data-testid="files-hint">
            The agent's own files live in this browser. Open one to read it; it is the same
            workspace `read_file` and the sandbox see.
          </p>
        )}
      </div>
    </>
  )
}

/**
 * Hand the reader a copy.
 *
 * An object URL and an anchor, because a static page has no server to ask for a
 * file it already holds. The URL is revoked on the next tick rather than on the
 * line below `click()`: the download is started synchronously by the click and
 * revoking in the same task is what the spec allows, but a task boundary costs
 * nothing and removes the only way this can hand somebody an empty file.
 *
 * The slashes go to dashes because a browser's download directory is flat and
 * `src/deep.txt` would otherwise arrive as `deep.txt`, losing which one it was.
 */
function save(file) {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.path.replaceAll('/', '-')
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
