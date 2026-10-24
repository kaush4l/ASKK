---
kind: tts
title: macOS voices (say)
engine: say
default: true
about: The Mac's own voices through `say` — Siri and premium voices included, nothing to download.
options:
  voice: {type: text, default: "", choices_from: say-voices, about: "a voice installed on this Mac (empty = the system voice); more in System Settings › Accessibility › Spoken Content"}
  rate: {type: number, default: 190, min: 90, max: 360, step: 10, about: "words per minute"}
values: {}
---
# macOS voices

Add voices in System Settings → Accessibility → Spoken Content → System voice → Manage voices.
