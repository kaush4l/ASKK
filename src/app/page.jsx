'use client'

import { useEffect, useRef, useState } from 'react'
import { BackendClient } from '../client/BackendClient.js'
import { Dictation, Voice } from '../client/Speech.js'
import { EventName } from '../protocol/Envelope.js'

export default function Page() {
  const clientRef = useRef(null)
  const scrollRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // The id of the turn in flight, which is also the only handle there is on it
  // — see `CANCEL` in the envelope. Null between turns, and the stop button
  // exists exactly while it is not.
  const [running, setRunning] = useState(null)
  const [problem, setProblem] = useState(null)
  const [notes, setNotes] = useState([])
  const [settings, setSettings] = useState(null)
  const [agents, setAgents] = useState([])
  const [threads, setThreads] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  // What the current turn is doing, as it does it. `raw` is the text arriving
  // from the model before it has been parsed, `reasoning` is the scratchpad a
  // thinking model emits alongside it, and `steps` are the passes that have
  // already resolved. All are cleared when the turn ends, because from then on
  // the transcript is the record.
  const [live, setLive] = useState({ raw: '', reasoning: '', steps: [] })
  // Every prompt this turn sent, in order. A ReAct run is several calls, so one
  // slot would show the last one and quietly hide the rest.
  const [prompts, setPrompts] = useState([])
  // What the provider said the last call actually cost. The only token number
  // here that is measured rather than estimated, so it is kept beside the
  // estimates rather than replacing them.
  const [usage, setUsage] = useState(null)
  // Closed at first render, on purpose. The panel is a second pane on a desktop
  // and a full-screen sheet on a phone, so opening it by default would greet a
  // phone with an empty readout and the conversation hidden behind it. The
  // desktop opens it below, after mount, where the viewport is knowable.
  const [showPrompt, setShowPrompt] = useState(false)
  const [promptAt, setPromptAt] = useState(0)
  // Dictation, as three separate facts because they are separately interesting:
  // whether the microphone is open, what has been heard so far, and how much of
  // a model is still to arrive. The first run of a local engine spends minutes
  // on the third with nothing to show for the other two, and a spinner that
  // cannot tell those apart is a spinner nobody believes.
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [download, setDownload] = useState(null)
  const [speaking, setSpeaking] = useState('')
  const dictationRef = useRef(null)
  const voiceRef = useRef(null)

  useEffect(() => {
    // Spawned in an effect, not at module scope: this component is executed in
    // Node during the static prerender, where Worker does not exist.
    const client = BackendClient.spawn()
    clientRef.current = client

    client.ready().then(async (boot) => {
      if (!boot.ok) {
        setProblem({ message: 'The backend did not start.', hint: 'Reload the page.' })
        return
      }
      const collected = [...boot.notes]
      if (!boot.persistent)
        collected.push('Storage is unavailable — this conversation ends with the tab.')

      const [existing, loaded, roster] = await Promise.all([
        client.call('conversations.list'),
        client.call('settings.get'),
        client.call('agents.list'),
      ])
      collected.push(...existing.notes, ...loaded.notes, ...roster.notes)
      if (loaded.ok) setSettings(loaded.value)
      if (roster.ok) setAgents(roster.value)

      let conversation = existing.ok ? existing.value[0] : null
      if (!conversation) {
        const made = await client.call('conversations.create', { title: 'Chat' })
        collected.push(...made.notes)
        conversation = made.ok ? made.value : null
      }
      if (conversation) {
        setConversationId(conversation.id)
        setMessages(conversation.messages ?? [])
      }
      setNotes(collected)
      setReady(true)
    })

    return () => client.terminate()
  }, [])

  // Open beside the conversation where there is room for it. Decided after
  // mount rather than during render: the page is prerendered to static HTML by
  // a build that has no viewport, and a component that guessed one would
  // hydrate into a layout the markup does not match.
  useEffect(() => {
    if (window.matchMedia?.('(min-width: 60rem)').matches) setShowPrompt(true)
  }, [])

  // Follow the conversation as it grows, including while a reply is pending.
  // They are the trigger, not values the body reads: dropping them would scroll
  // once, on mount, and never again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-on-change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function send(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy || !conversationId) return

    setProblem(null)
    setBusy(true)
    setDraft('')
    setLive({ raw: '', reasoning: '', steps: [] })
    setPrompts([])
    setPromptAt(0)
    setUsage(null)
    // Shown immediately rather than after the round trip. The backend has
    // already been told to persist it first, so this is not an optimistic lie.
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'user', text }])

    const turn = clientRef.current.begin(
      'chat.send',
      { id: conversationId, text },
      (name, data) => {
        if (name === EventName.PROMPT) {
          setPrompts((current) => [...current, data])
          // Follow the run: a panel pinned to step 1 while step 4 is being sent
          // is showing history, not what is happening. Steps are numbered from
          // one and arrive in order, so the index is the step minus one.
          setPromptAt(data.step - 1)
          return
        }
        if (name === EventName.DELTA) {
          // Two channels, kept apart. A thinking model can emit pages of
          // scratchpad before its first word of answer; merging them would put
          // the reply at the bottom of its own working-out.
          const field = data.kind === 'reasoning' ? 'reasoning' : 'raw'
          setLive((current) => ({ ...current, [field]: current[field] + data.chunk }))
          return
        }
        if (name === EventName.USAGE) {
          setUsage(data)
          return
        }
        if (name === EventName.STEP) {
          // The raw text is dropped here on purpose. It has just been parsed,
          // and showing both the contract and the answer it contains is how a
          // reader ends up reading the scaffolding.
          setLive((current) => ({ raw: '', reasoning: '', steps: [...current.steps, data] }))
        }
      },
    )
    setRunning(turn.id)
    const result = await turn.done
    setNotes(result.notes)
    // Which sub-agent threads exist is a fact the backend holds and nothing
    // else can see. Read it after every turn so delegation is visible.
    const spawned = await clientRef.current.call('agents.threads')
    if (spawned.ok) setThreads(spawned.value)
    if (result.ok) {
      // `.filter(Boolean)` is not tidiness here. A stopped run answers ok with
      // no assistant message at all — there was nothing it was willing to write
      // down as a reply — and this is what keeps the transcript exactly as it
      // was rather than growing an empty turn.
      setMessages((current) => [...current, result.value.assistant].filter(Boolean))
      // Not awaited. Reading a reply aloud takes as long as the reply is long,
      // and the turn is over — blocking on it would leave the composer disabled
      // for the length of a paragraph being spoken.
      if (settings?.speakReplies && result.value.assistant?.text) say(result.value.assistant.text)
    } else {
      // The turn failed, but the user's message was saved before the model was
      // called — so the transcript is left alone and only the reply is missing.
      setProblem({ message: result.error.message, hint: result.error.hint })
    }
    // The turn is over: whatever it produced is now in the transcript, and a
    // leftover live view would be a second, stale copy of it.
    setLive({ raw: '', reasoning: '', steps: [] })
    // Cleared WITH `busy` and not before it. Cleared early — as it was — the
    // button went on reading "stop" for the length of the `agents.threads`
    // round trip above while calling `stop(null)`, which does nothing. Nothing
    // was lost, the turn was already over; the control simply lied.
    setRunning(null)
    setBusy(false)
  }

  /**
   * Start or end a dictation.
   *
   * The partial goes straight into the composer rather than into a preview of
   * its own: the point of dictating is to send the words, and text that has to
   * be moved somewhere before it can be sent is a transcript, not an input. It
   * is still shown separately while listening, because the partial is *revised*
   * — words already typed change as more audio arrives — and that is worth
   * seeing happen rather than discovering in the box you were about to send.
   */
  async function dictate() {
    if (listening) {
      setListening(false)
      const done = await dictationRef.current?.stop()
      dictationRef.current = null
      setDownload(null)
      setHeard('')
      if (done?.text) setDraft(done.text)
      if (done && !done.ok) setProblem({ message: done.error.message, hint: done.error.hint })
      if (done?.notes?.length) setNotes(done.notes)
      return
    }

    const dictation = new Dictation(settings ?? {})
    dictation.onPartial = (text) => {
      // A partial is proof the model is up, so it is also what retires the
      // download bar. Waiting for the loader to say it has finished would leave
      // the last byte-count on screen if the final progress event never came,
      // which is exactly what a cached model does — it reports a start and then
      // nothing at all.
      setDownload(null)
      setHeard(text)
      setDraft(text)
    }
    dictation.onProgress = (progress) => setDownload(progress)
    // A model that fails to build does so minutes into its own download, and
    // an interface still saying "listening" at that point is lying about where
    // the words are going.
    dictation.onEnded = (result) => {
      setListening(false)
      setDownload(null)
      setHeard('')
      dictationRef.current = null
      if (!result.ok) setProblem({ message: result.error.message, hint: result.error.hint })
    }
    dictationRef.current = dictation

    setProblem(null)
    setHeard('')
    setListening(true)
    const started = await dictation.start()
    if (started.notes?.length) setNotes(started.notes)
    if (!started.ok) {
      setListening(false)
      dictationRef.current = null
      setProblem({ message: started.error.message, hint: started.error.hint })
      return
    }
    // Only cleared once the model is up: a download bar left on screen after the
    // weights arrived would say the wait is still happening.
    setDownload(null)
  }

  /**
   * Read a reply aloud.
   *
   * One voice object for the tab, not one per message. Rebuilding it per reply
   * would reload the weights per reply, which is the same mistake this tree
   * already names for inference.
   */
  async function say(text) {
    if (!voiceRef.current) voiceRef.current = new Voice(settings ?? {})
    voiceRef.current.settings = settings ?? {}
    voiceRef.current.onProgress = (progress) => setDownload(progress)
    setSpeaking(text)
    const spoken = await voiceRef.current.say(text)
    setSpeaking('')
    setDownload(null)
    if (spoken.notes?.length) setNotes(spoken.notes)
    if (!spoken.ok) setProblem({ message: spoken.error.message, hint: spoken.error.hint })
  }

  async function saveSettings(event) {
    event.preventDefault()
    setProblem(null)
    const result = await clientRef.current.call('settings.save', settings)
    setNotes(result.notes)
    if (result.ok) {
      // Whatever came back is authoritative — the backend may have corrected a
      // field, and the form must show what was actually kept, not what was typed.
      setSettings(result.value)
      setShowSettings(false)
    } else {
      setProblem({ message: result.error.message, hint: result.error.hint })
    }
  }

  async function newChat() {
    const result = await clientRef.current.call('conversations.create', { title: 'Chat' })
    setNotes(result.notes)
    if (!result.ok) {
      setProblem({ message: result.error.message, hint: result.error.hint })
      return
    }
    setConversationId(result.value.id)
    setMessages([])
    setProblem(null)
  }

  const field = (key) => ({
    value: settings?.[key] ?? '',
    onChange: (e) => setSettings((s) => ({ ...s, [key]: e.target.value })),
  })

  const shown = prompts[promptAt] ?? null

  // The status rail reports the facts the running system holds and nothing
  // else can see. Each is a value, not a label — an empty one is left out
  // rather than shown as "none", because a readout of nothing is noise.
  const status = [
    ready ? null : { text: 'starting', live: true },
    settings?.agent ? { text: settings.agent } : null,
    settings?.model ? { text: settings.model } : null,
    ...threads.map((t) => ({ text: `${t.confirmedName ?? t.name}·${t.calls}`, live: true })),
    listening ? { text: 'listening', live: true } : null,
    busy ? { text: 'working', live: true } : null,
  ].filter(Boolean)

  return (
    <div className="shell">
      <header className="rail">
        <h1 className="wordmark" data-live={String(ready)}>
          <span className="pulse" />
          ASKK
        </h1>

        <div className="status" data-testid="status">
          {status.map((item) => (
            <b key={item.text} className={item.live ? 'live' : ''}>
              {item.text}
            </b>
          ))}
          {threads.length ? <span data-testid="threads" hidden /> : null}
        </div>

        <div className="actions">
          <button type="button" onClick={newChat} disabled={!ready}>
            new
          </button>
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            disabled={!ready}
            aria-pressed={showSettings}
          >
            settings
          </button>
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            aria-pressed={showPrompt}
            data-testid="prompt-toggle"
          >
            prompt
          </button>
        </div>
      </header>

      {showSettings && settings ? (
        <form className="settings" onSubmit={saveSettings}>
          <div className="sheet">
            <h2>
              settings
              <button type="button" onClick={() => setShowSettings(false)}>
                close
              </button>
            </h2>

            <label>
              model provider
              <select {...field('kind')}>
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="transformers">transformers.js (in-browser)</option>
              </select>
            </label>
            <label>
              model
              <input {...field('model')} />
            </label>
            <label>
              base url
              <input {...field('baseUrl')} disabled={settings.kind === 'transformers'} />
            </label>
            <label>
              api key
              <input
                type="password"
                {...field('apiKey')}
                placeholder="stored on this device only"
              />
            </label>
            <label>
              agent
              <select {...field('agent')}>
                {agents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name}
                    {agent.description ? ` — ${agent.description}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="group" />
            <label>
              hearing
              <select {...field('sttKind')}>
                <option value="native">browser recogniser (nothing to download)</option>
                <option value="whisper">whisper (transformers.js, accurate)</option>
                <option value="moonshine">moonshine (transformers.js, fast)</option>
              </select>
            </label>
            <label>
              speech model
              <input
                {...field('sttModel')}
                disabled={settings.sttKind === 'native'}
                placeholder="any automatic-speech-recognition model id"
              />
            </label>
            <label>
              voice engine
              <select {...field('ttsKind')}>
                <option value="native">browser voice (nothing to download)</option>
                <option value="supertonic">supertonic (transformers.js, style vector)</option>
                <option value="vits">mms-vits (transformers.js, one file)</option>
              </select>
            </label>
            <label>
              voice model
              <input
                {...field('ttsModel')}
                disabled={settings.ttsKind === 'native'}
                placeholder="any text-to-speech model id"
              />
            </label>
            <label>
              voice
              <input
                {...field('ttsVoice')}
                placeholder={
                  settings.ttsKind === 'supertonic'
                    ? 'URL of a voices/*.bin style vector'
                    : 'name of an installed voice'
                }
              />
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={Boolean(settings.speakReplies)}
                onChange={(e) => setSettings((s) => ({ ...s, speakReplies: e.target.checked }))}
              />
              read replies aloud
            </label>

            <button type="submit">save</button>
          </div>
        </form>
      ) : null}

      <div className={`panes${showPrompt ? ' with-panel' : ''}`}>
        <main className="stage">
          <div className="transcript" ref={scrollRef} data-testid="transcript">
            {messages.length === 0 && ready ? (
              <p className="empty">
                <strong>ready</strong>
                Ask a question. The agent can run commands in a private Linux sandbox when the
                answer is something to find out rather than recall.
              </p>
            ) : null}

            {messages.map((message) => (
              <article key={message.id} className={`turn ${message.role}`}>
                <span className="who">{message.role}</span>
                <div className="body">
                  <div className="text">{message.text}</div>
                  {message.role === 'assistant' && message.text ? (
                    <button
                      type="button"
                      className="say"
                      onClick={() => say(message.text)}
                      data-testid={`say-${message.id}`}
                    >
                      {speaking === message.text ? 'speaking…' : 'read aloud'}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}

            {busy ? (
              <article className="turn assistant" data-testid="pending">
                <span className="who">assistant</span>
                <div className="body">
                  {/* A ReAct run reaches the answer through tool calls. Each
                      finished pass stays visible so the route to the answer is
                      legible, and the final one is the reply that will land in
                      the transcript. */}
                  {live.steps.map((taken) => (
                    <div
                      key={taken.step}
                      className={`text step${taken.isAnswer ? ' answered' : ''}`}
                      data-testid={`step-${taken.step}`}
                    >
                      {taken.isAnswer ? null : <span className="badge">step {taken.step}</span>}
                      {taken.answer}
                    </div>
                  ))}
                  {live.reasoning ? (
                    <div className="text thinking" data-testid="reasoning">
                      {live.reasoning}
                    </div>
                  ) : null}
                  {/* Raw, unparsed, exactly as it arrives. Replaced the moment
                      the pass is parsed — this is the wait made visible, not a
                      second rendering of the answer. */}
                  {live.raw ? (
                    <div className="text raw" data-testid="stream">
                      {live.raw}
                    </div>
                  ) : null}
                  {live.raw || live.reasoning || live.steps.length ? null : (
                    <div className="text raw" />
                  )}
                </div>
              </article>
            ) : null}
          </div>

          <div className="tray">
            {/* Bound to the state it describes rather than to its own lifetime:
                a progress report that outlives the dictation it belonged to is
                a loading bar for nothing, and the loader has no event that
                reliably says "done". */}
            {download && (listening || speaking) ? (
              <p className="loading" data-testid="download">
                <span className="who">{download.file || 'model'}</span>
                {/* Driven by a width, not an animation. A first load is minutes
                    of a file arriving, and an indeterminate spinner cannot tell
                    "downloading" from "hung". */}
                <span className="bar">
                  <span style={{ width: `${download.percent}%` }} />
                </span>
                {download.percent}%
              </p>
            ) : null}

            {listening ? (
              <p className="hearing" data-testid="hearing">
                <span className="who">hearing</span>
                {heard || '…'}
              </p>
            ) : null}

            {problem ? (
              <p className="problem" data-testid="error">
                {problem.message}
                {problem.hint ? <span className="hint-line">{problem.hint}</span> : null}
              </p>
            ) : null}

            {notes.length ? (
              <ul className="notes" data-testid="notes">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="dock">
            <form className="composer" onSubmit={send}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={ready ? 'Ask anything' : 'starting the engine…'}
                disabled={!ready || busy}
                data-testid="input"
              />
              {/* Not disabled while a turn is in flight. Dictating the next
                message while the model answers the last one is the normal way
                to use this, and the two run on different threads so it can. */}
              <button
                type="button"
                className={listening ? 'mic on' : 'mic'}
                onClick={dictate}
                disabled={!ready}
                aria-pressed={listening}
                data-testid="mic"
              >
                {listening ? 'stop' : 'speak'}
              </button>
              {/* One control, two turns of a run: while a turn is in flight
                  there is nothing to send and the only useful thing to press is
                  stop, so the button becomes it rather than sitting greyed out
                  beside a second one that only ever appears here. */}
              {busy ? (
                <button
                  type="button"
                  className="stop"
                  onClick={() => clientRef.current?.stop(running)}
                  data-testid="stop"
                >
                  stop
                </button>
              ) : (
                <button type="submit" disabled={!ready || !draft.trim()}>
                  send
                </button>
              )}
            </form>
          </div>
        </main>

        {showPrompt ? (
          <aside className="panel" data-testid="prompt-panel">
            <header>
              <h2>prompt</h2>
              <div className="steps">
                {prompts.length > 1
                  ? prompts.map((entry, index) => (
                      <button
                        key={entry.step}
                        type="button"
                        className={index === promptAt ? 'on' : ''}
                        onClick={() => setPromptAt(index)}
                      >
                        {entry.step}
                      </button>
                    ))
                  : null}
                <button type="button" className="close" onClick={() => setShowPrompt(false)}>
                  close
                </button>
              </div>
            </header>

            {shown ? (
              <div className="readout">
                {/* The signature: the prompt as a proportional band. Each block
                    is as wide as its share of the tokens, the reusable prefix
                    filled and everything after it hatched. The list below says
                    what each block costs; this says what the costs are FOR —
                    how much has to be read again, and which block is the
                    reason. */}
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

                {/* Tokens, not characters: every limit that matters — the
                    context window, the cache minimum, the bill — is counted in
                    tokens, and the same characters cost wildly different
                    numbers of them depending on what they are. */}
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
                      {usage.latency?.generationRate
                        ? `, ${usage.latency.generationRate} tok/s`
                        : ''}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}

            {shown ? (
              <ol className="layout" data-testid="prompt-layout">
                {shown.parts.map((part) => (
                  <li key={part.id} className={part.cached ? 'cached' : ''}>
                    <span className="id">{part.id}</span>
                    <span className={`vol ${part.volatility}`}>{part.volatility}</span>
                    <span className="tok">{part.tokens.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            {shown ? (
              <pre data-testid="prompt-text">{shown.text}</pre>
            ) : (
              <p className="hint">
                The complete prompt appears here as it is sent, block by block, with what each one
                costs and where the reusable prefix ends.
              </p>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
