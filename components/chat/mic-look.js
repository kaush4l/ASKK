// The composer mic (components/chat/composer.jsx MicButton), what it shows, pure. 2026-10-27 speak-polish (l29): an
// off mic stays tappable, and a tap shows its reason as a line under the composer, because a phone has no hover for a tooltip.
//   support: useSpeechInput's {supported, reason} (null: not known yet) · listening · disabled: the composer's own
// → { icon: on | off, off, disabled, label }; micTapNote(support) → the line a tap on an off mic shows, or null
export function micLook({ support = null, listening = false, disabled = false } = {}) {
  const off = !!support && !support.supported
  const label = off ? reasonOf(support) : listening ? "Stop dictation" : "Dictate (live transcription)"
  return { icon: off ? "off" : "on", off, disabled: !!disabled, label }
}

export function micTapNote(support) {
  return support && !support.supported ? reasonOf(support) : null
}

function reasonOf(support) {
  return String(support?.reason ?? "").trim() || "Dictation is not available here"
}
