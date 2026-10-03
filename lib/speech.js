// Live speech-to-text in the browser (Web Speech API).
//
//   await speechSupport(lang)   what this browser can do (see below)
//   const t = new LiveTranscriber({ lang, onChange, onEnd })
//   t.start()                   ask for the mic, then stream text
//   t.stop()                    finish (keeps the last words) · t.abort()
//
// Enabled in Safari only (WebKit: macOS Safari and every iOS browser), which
// uses Apple's dictation (Siri/Dictation must be enabled in System Settings,
// else "service-not-allowed") and asks for microphone and speech-recognition
// permission. Chrome's recognition sends audio to Google's service, so it is
// off for now; Firefox has none. Needs a secure context (https or
// localhost). A session that ends on its own (silence, time limit) is
// restarted until stop() is called. Results come without punctuation;
// dictation.js adds it.

const Recognition = () =>
  typeof window === "undefined" ? null : (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null)

function browserName() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return "safari" // every iOS browser is WebKit
  if (/Edg\//.test(ua)) return "edge"
  if (/Chrome\//.test(ua)) return "chrome"
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "safari"
  if (/Firefox\//.test(ua)) return "firefox"
  return "other"
}

// Microphone permission: "granted" | "denied" | "prompt" | "unknown".
async function microphonePermission() {
  try {
    return (await navigator.permissions.query({ name: "microphone" })).state
  } catch {
    return "unknown" // the Permissions API does not know "microphone" here
  }
}

// What this browser offers for live transcription. `reason` explains why
// `supported` is false.
export async function speechSupport(lang = defaultLanguage()) {
  const SR = Recognition()
  const secure = typeof window !== "undefined" && window.isSecureContext
  const microphone = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  const browser = browserName()
  const support = {
    supported: false,
    browser,
    lang,
    secure,
    microphone,
    permission: microphone ? await microphonePermission() : "unknown",
    reason: null,
  }
  if (!secure) support.reason = "Speech input needs a secure page (https or localhost)."
  else if (browser !== "safari")
    support.reason = "Dictation is available in Safari only for now (Apple's dictation)."
  else if (!SR) support.reason = "This version of Safari has no speech recognition."
  else if (!microphone) support.reason = "This browser gives no microphone access."
  else if (support.permission === "denied")
    support.reason = "Microphone access is blocked for this site. Allow it in the browser's site settings."
  else support.supported = true
  return support
}

export function defaultLanguage() {
  return (typeof navigator !== "undefined" && navigator.language) || "en-US"
}

// Readable messages for SpeechRecognition error codes.
function errorMessage(code, browser) {
  switch (code) {
    case "not-allowed":
      return "Microphone access was denied."
    case "service-not-allowed":
      return browser === "safari"
        ? "Speech recognition is off. Enable Siri or Dictation in System Settings, then allow it for this site."
        : "Speech recognition is not allowed here."
    case "audio-capture":
      return "No microphone was found."
    case "network":
      return "The speech service could not be reached. Check the internet connection."
    case "language-not-supported":
      return "This language is not supported for speech input."
    default:
      return `Speech input failed (${code}).`
  }
}

// Errors after which restarting would only fail again.
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "bad-grammar"])

export class LiveTranscriber {
  #recognition = null
  #committed = "" // final text from earlier sessions
  #final = "" // final text of the current session
  #interim = ""
  #wanted = false // keep listening (restart when a session ends)
  #error = null

  // onChange({ text, final, interim, listening })   on every result
  // onEnd({ text, error })                          once, when listening stops
  constructor({ lang = defaultLanguage(), onChange, onEnd } = {}) {
    this.lang = lang
    this.onChange = onChange
    this.onEnd = onEnd
    this.browser = browserName()
  }

  get text() {
    return join(this.#committed, this.#final, this.#interim)
  }

  get listening() {
    return this.#wanted
  }

  start() {
    const SR = Recognition()
    if (!SR) throw new Error("This browser has no speech recognition.")
    if (this.#wanted) return
    this.#wanted = true
    this.#error = null
    this.#session(SR)
  }

  // Stop listening; words still being recognized arrive before onEnd.
  stop() {
    this.#wanted = false
    this.#recognition?.stop()
  }

  // Stop now and drop words not yet final.
  abort() {
    this.#wanted = false
    this.#interim = ""
    this.#recognition?.abort()
  }

  #session(SR) {
    const recognition = new SR()
    recognition.lang = this.lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // Rebuild the session's text from every result: Safari re-sends earlier
    // results, so appending from `resultIndex` would duplicate words.
    recognition.onresult = (event) => {
      let final = ""
      let interim = ""
      for (const result of event.results) {
        const text = result[0]?.transcript ?? ""
        if (result.isFinal) final = join(final, text)
        else interim = join(interim, text)
      }
      this.#final = final
      this.#interim = interim
      this.#emit()
    }

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return
      if (FATAL.has(event.error)) {
        this.#error = errorMessage(event.error, this.browser)
        this.#wanted = false
      }
    }

    recognition.onend = () => {
      // Keep what this session recognized, including unfinished words.
      this.#committed = join(this.#committed, this.#final, this.#interim)
      this.#final = ""
      this.#interim = ""
      if (this.#wanted) {
        try {
          this.#session(SR)
          return
        } catch (error) {
          this.#error = error.message
          this.#wanted = false
        }
      }
      this.#recognition = null
      this.#emit()
      this.onEnd?.({ text: this.#committed, error: this.#error })
    }

    this.#recognition = recognition
    recognition.start()
  }

  #emit() {
    this.onChange?.({
      text: this.text,
      final: join(this.#committed, this.#final),
      interim: this.#interim,
      listening: this.#wanted,
    })
  }
}

// Join pieces of speech with single spaces.
function join(...parts) {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
}
