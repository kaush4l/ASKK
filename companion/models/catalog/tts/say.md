---
kind: tts
title: macOS voices (say)
engine: say
default: true
about: The Mac's own voices through `say` — Siri and premium voices included, nothing to download.
script: |
  Plain text read by the Mac's own voice: no markdown or emoji (they are read out). Punctuation sets the pauses; a blank
  line between paragraphs. It understands embedded commands for finer control, each in double brackets inside the
  text: [[slnc 500]] a 500 ms silence, [[emph +]]word[[emph -]] stress, [[rate 160]] words per minute from there,
  [[pbas +5]] a higher pitch. Use them sparingly — a silence before a reveal, a slower rate for a definition. Spell out
  numbers and abbreviations as spoken when the reading matters.
options:
  voice: {type: text, default: "", choices_from: say-voices, about: "a voice installed on this Mac (empty = the system voice); more in System Settings › Accessibility › Spoken Content"}
  rate: {type: number, default: 190, min: 90, max: 360, step: 10, about: "words per minute"}
values: {}
---
# macOS voices

Add voices in System Settings → Accessibility → Spoken Content → System voice → Manage voices.
