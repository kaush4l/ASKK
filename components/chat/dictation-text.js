// What the message box holds while dictating (composer.jsx, voice-in 2026-10-27): the transcript so far after whatever
// was typed before dictation started. Pure, so its test needs no DOM.
export const withDictation = (base, text) => (base ? `${base} ${text}`.trimEnd() : text)
