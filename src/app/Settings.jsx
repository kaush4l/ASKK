'use client'

import { useEffect, useState } from 'react'
import { installedVoices } from '../client/Speech.js'

/**
 * The one screen a person has to get right before this app can answer anything.
 *
 * A usability review found the previous version unusable at every viewport
 * width, and the cause was one string: the agent `<select>` carried each
 * agent's whole description inside its `<option>`, and the longest was 258
 * characters. An option's text sizes its select, a select sizes its grid
 * column, and the grid dragged the heading, every field and the close button
 * with it — measured at 1,813px of content on a 390px phone, where the sheet
 * began at x=651 and the screen was simply black. There was no scrollbar to
 * say so and no way out: escape did nothing, the backdrop did nothing, and the
 * toolbar button that opened it was underneath the form.
 *
 * So: options are LABELS, descriptions are help text, every column is
 * constrained, and three separate things dismiss this.
 *
 * The second change is order. A first visit has exactly one problem — there is
 * no model — and the old form put five voice fields, a temperature and a token
 * ceiling in front of a person before they could solve it. Twelve fields read
 * as twelve things that must be filled in. Everything that is not the model is
 * folded.
 */
export function Settings({ settings, agents, onChange, onSave, onClose, testing, onTest, health }) {
  const [voices, setVoices] = useState([])
  const [everyVoice, setEveryVoice] = useState(false)

  /**
   * The voices this device actually has.
   *
   * The old form asked a person to TYPE the name of an installed voice, with
   * 183 valid answers on the reviewer's machine and no list anywhere — recall
   * where recognition was free, and a name one character out falls back to the
   * default in silence. Asked once, when the sheet opens, because Chrome
   * answers with an empty list until it has loaded them.
   */
  useEffect(() => {
    let stopped = false
    installedVoices().then((found) => {
      if (!stopped) setVoices(found)
    })
    return () => {
      stopped = true
    }
  }, [])

  /**
   * Dismissal, from anywhere.
   *
   * Escape is the one every modal owes a person, and this one had none: the
   * reviewer's only remaining exit was to reload the page.
   */
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * One field, changed against the LATEST settings rather than the ones this
   * render closed over.
   *
   * Measured: a driver that set two fields in the same tick lost the first,
   * because each handler spread the `settings` of the render that created it
   * and React had not re-rendered in between. A person typing does not hit
   * this and a script always does — and "a script" includes the gate, so the
   * form would have been checked in a state it never reaches by hand.
   */
  const change = (key, value) => onChange((current) => ({ ...current, [key]: value }))
  const field = (key) => ({
    value: settings[key] ?? '',
    onChange: (event) => change(key, event.target.value),
  })
  const local = settings.kind === 'transformers'

  return (
    <div className="settings" data-testid="settings">
      {/* A real button rather than a click handler on the backdrop. Both
          dismiss; only one of them is reachable without a mouse, and the
          reviewer's phone had no exit from this sheet at all. */}
      <button
        type="button"
        className="scrim"
        aria-label="Close settings"
        onClick={onClose}
        data-testid="settings-scrim"
      />
      <form className="sheet" onSubmit={onSave} aria-label="Settings">
        <h2>
          Settings
          <button type="button" onClick={onClose} data-testid="settings-close">
            Close
          </button>
        </h2>

        <p className="aside">
          This app brings no model. Point it at one below: a server on your own machine, a hosted
          one with a key, or a small model that downloads into this tab. Nothing leaves your browser
          except the request to whichever you choose.
        </p>

        <label>
          Where the model runs
          <select {...field('kind')} data-testid="kind">
            <option value="openai">A server that speaks the OpenAI protocol</option>
            <option value="anthropic">Anthropic</option>
            <option value="transformers">In this tab</option>
          </select>
        </label>

        {local ? (
          /* The people who choose this have no server, which makes them the
             people least able to type a Hugging Face model id from memory. The
             old form left the previous server's model name in the box and
             offered no list at all. */
          <label>
            Which model
            <select {...field('model')} data-testid="local-model">
              <option value="">Choose one…</option>
              {LOCAL_MODELS.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label} — {one.size}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Model name
              <input
                {...field('model')}
                placeholder="exactly what that server calls the model"
                data-testid="model"
              />
            </label>
            <label>
              Address
              <input
                {...field('baseUrl')}
                placeholder="http://127.0.0.1:1234/v1"
                data-testid="base-url"
              />
            </label>
            <p className="aside">
              The address of the server's API, ending in <code>/v1</code>. LM Studio uses port 1234,
              vLLM 8000, Ollama 11434.
            </p>
            <label>
              Key
              <input
                type="password"
                {...field('apiKey')}
                placeholder="blank for a server on your own machine"
                data-testid="api-key"
              />
            </label>

            {/* The gap between a wrong value and its consequence used to span a
                panel close, a typed message and a network timeout — long enough
                that a person no longer associated the error with the field. */}
            <div className="pair">
              <button
                type="button"
                className="iconbutton"
                onClick={onTest}
                disabled={testing}
                data-testid="test-connection"
              >
                <span className="word">{testing ? 'Checking…' : 'Check the connection'}</span>
              </button>
              {health ? (
                <p className="aside" data-testid="test-result">
                  {health.reachable ? '✓ answered' : health.detail}
                </p>
              ) : null}
            </div>
          </>
        )}

        <label>
          Who you are talking to
          <select {...field('agent')} data-testid="agent">
            {agents.map((agent) => (
              // The NAME only. The description used to live inside this option
              // and it is what broke the form at every width.
              <option key={agent.name} value={agent.name}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <p className="aside">
          {agents.find((one) => one.name === settings.agent)?.description ??
            'Each agent brings its own instructions and its own set of tools.'}
        </p>

        <details data-testid="voice-settings">
          <summary>Voice</summary>
          <div className="folded">
            <p className="aside">
              None of this is needed to ask a question. The two “nothing to download” choices are
              what the browser already has.
            </p>
            <label>
              Hearing
              <select {...field('sttKind')} data-testid="stt-kind">
                <option value="native">The browser's own recogniser</option>
                <option value="whisper">Whisper — accurate, downloads</option>
                <option value="moonshine">Moonshine — fast, downloads</option>
              </select>
            </label>
            <label>
              Voice engine
              <select {...field('ttsKind')} data-testid="tts-kind">
                <option value="native">The browser's own voice</option>
                <option value="supertonic">Supertonic — downloads</option>
                <option value="vits">MMS-VITS — downloads</option>
              </select>
            </label>
            {settings.ttsKind === 'native' ? (
              <label>
                Voice
                <select {...field('ttsVoice')} data-testid="tts-voice">
                  <option value="">Whatever this device prefers</option>
                  {offered(voices, everyVoice).map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Voice
                <input
                  {...field('ttsVoice')}
                  placeholder={
                    settings.ttsKind === 'supertonic'
                      ? 'URL of a voices/*.bin style vector'
                      : 'leave blank for the default'
                  }
                />
              </label>
            )}
            {settings.ttsKind === 'native' && voices.length > offered(voices, false).length ? (
              <label className="switch">
                <input
                  type="checkbox"
                  checked={everyVoice}
                  onChange={(event) => setEveryVoice(event.target.checked)}
                  data-testid="every-voice"
                />
                Show every voice this device has ({voices.length})
              </label>
            ) : null}

            <div className="pair">
              <label>
                Speed {Number(settings.ttsRate ?? 1).toFixed(1)}×
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.ttsRate ?? 1}
                  onChange={(event) => change('ttsRate', Number(event.target.value))}
                  data-testid="tts-rate"
                />
              </label>
              <label>
                Pitch {Number(settings.ttsPitch ?? 1).toFixed(1)}
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.ttsPitch ?? 1}
                  onChange={(event) => change('ttsPitch', Number(event.target.value))}
                />
              </label>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={Boolean(settings.speakReplies)}
                onChange={(event) => change('speakReplies', event.target.checked)}
                data-testid="speak-replies"
              />
              Read replies aloud
            </label>
          </div>
        </details>

        <details data-testid="advanced-settings">
          <summary>How the model answers</summary>
          <div className="folded">
            <div className="pair">
              <label>
                Temperature {Number(settings.temperature ?? 0.7).toFixed(2)}
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={settings.temperature ?? 0.7}
                  onChange={(event) => change('temperature', Number(event.target.value))}
                  data-testid="temperature"
                />
              </label>
              <label>
                Longest reply
                {/* `step` is 1 and not 256. With a step of 256 from a min of 1
                    the only valid values are 1, 257, 513… — so the default of
                    2,048 was INVALID, constraint validation refused the submit,
                    and the whole form silently would not save. Nothing on
                    screen said why: no error, no close, no note. */}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={settings.maxTokens ?? 2048}
                  onChange={(event) => change('maxTokens', Number(event.target.value))}
                  data-testid="max-tokens"
                />
              </label>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.thinking !== false}
                onChange={(event) => change('thinking', event.target.checked)}
                data-testid="thinking"
              />
              Let the model think before it answers
            </label>
            {settings.sttKind !== 'native' ? (
              <div className="pair">
                <label>
                  Speech runs on
                  <select {...field('sttDevice')} data-testid="stt-device">
                    <option value="wasm">This machine's processor</option>
                    <option value="webgpu">Its graphics card</option>
                  </select>
                </label>
                <label>
                  Speech precision
                  <select {...field('sttDtype')}>
                    <option value="fp32">Full — most accurate</option>
                    <option value="fp16">Half</option>
                    <option value="q8">8-bit — smallest download</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </details>

        <button type="submit" data-testid="settings-save">
          Save
        </button>
      </form>
    </div>
  )
}

/**
 * Which of this device's voices to offer, and why not all of them.
 *
 * macOS ships around 180, and a reviewer's list opened with "Bad News",
 * "Boing", "Bubbles", "Jester", "Trinoids", "Wobble" and "Zarvox" — an
 * unfiltered platform array presented as a product choice. What is offered is
 * the voices that speak the language the browser is set to, which is the only
 * property of a voice a person can act on without hearing it; everything else
 * is behind a switch that says how many there are.
 *
 * A device whose voices do not name a language, or name none this browser
 * matches, gets the whole list rather than an empty picker — a filter that can
 * return nothing must not be the only path.
 */
function offered(voices, everyone) {
  if (everyone) return voices
  const want = String(globalThis.navigator?.language ?? 'en')
    .slice(0, 2)
    .toLowerCase()
  const mine = voices.filter(
    (voice) =>
      String(voice.lang ?? '')
        .slice(0, 2)
        .toLowerCase() === want,
  )
  return mine.length ? mine : voices
}

/**
 * Models small enough to run in a tab, with what they cost to fetch.
 *
 * A list rather than a text field, and the sizes are the point: "downloads a
 * small model" concealed a several-hundred-megabyte fetch, and the people who
 * choose this option are the ones with no server and therefore the least able
 * to judge which id is small.
 */
const LOCAL_MODELS = [
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Qwen2.5 0.5B', size: '~400 MB' },
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', label: 'SmolLM2 360M', size: '~290 MB' },
  { id: 'onnx-community/Llama-3.2-1B-Instruct', label: 'Llama 3.2 1B', size: '~900 MB' },
]
