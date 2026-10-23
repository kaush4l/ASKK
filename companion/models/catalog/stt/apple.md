---
kind: stt
title: Apple on-device speech
engine: apple
default: true
about: Apple's SpeechAnalyzer on this Mac (macOS 26+) — built in, private, nothing to download.
install: xcode-select --install
options:
  locale: {type: text, default: en-US, about: "the language spoken (en-US, en-GB, hi-IN …)"}
values: {}
---
# Apple on-device speech

The default recognizer: the `askk-speech` helper (compiled from `companion/hardware/speech/asr.swift` on first use) runs
SpeechAnalyzer and stays loaded. Fast for short commands; no punctuation model to choose.
