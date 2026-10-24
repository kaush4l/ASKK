---
deadline_minutes: 60
retries: 1
board: false
vars:
  form: auto
  minutes: 3
  audience: a curious adult listener
---
# Narrate

A request becomes an expressive audio file in the owner's Telegram chat (2026-10-24 owner: "a default workflow where the
transcribe can be curated, fact checked, corrected and then made an expressive audio. It can be a story, talk, class,
explanation or a narrative"). Five steps, each its own agent: draft writes the script and lists every factual claim in
it, factcheck checks each claim on the web, correct rewrites what was wrong, voice shapes the corrected script to the
text-to-speech model's own format (its SCRIPT FORMAT in the audio artifact) and picks the voice, produce makes the
file, transcribes it back to prove it says the script, and sends it. Change a step's wording here to change how it
works.

## draft — Write the script
kind: agent
tools: web.search, web.read
max_steps: 12

Write a {{form}} for {{audience}} on: {{request}}

The form, when it is "auto", is the one that fits the request best — a story (characters, a turn, an ending), a talk
(one idea argued with examples), a class (a concept taught step by step, with a check of understanding), an explanation
(how something works, cause to effect) or a narrative (events told in order, documentary-like). About {{minutes}}
minutes when spoken: roughly 150 words a minute. Write for the ear, not the page: short sentences, one idea each, the
key point said twice in different words, signposts ("first", "here is the turn"), no lists, no headings, no tables.
Read what you need first; keep every fact you use true and specific.

### Output
form: the form chosen (story | talk | class | explanation | narrative) and why, one line
title: a short title for the audio
script: the whole script, as it will be spoken
claims: every factual claim in the script, one line each — C1, C2 … (a story's invented events are not claims; real
places, dates, numbers, names and how things work are)

## factcheck — Check every claim
kind: agent
tools: web.search, web.read
max_steps: 20

Check each claim against sources you read (not only search): is it true as worded, for {{audience}}?

The claims:
{{draft.claims}}

The script they come from:
{{draft.script}}

### Output
verdicts: one line per claim — C1 · true | wrong | unsure · the correct wording when it is not true · the source URL
summary: how many true, wrong, unsure

## correct — Correct the script
kind: agent
max_steps: 4

Rewrite the script so every claim is true: fix each wrong one with the corrected wording, soften or cut each unsure one,
leave the rest as written. Keep the form, the length and the voice of the script.

The script:
{{draft.script}}

The verdicts:
{{factcheck.verdicts}}

### Output
script: the corrected script, whole
changes: one line per change — what was said, what it says now, why

## voice — Shape it for the voice
kind: agent
artifacts: audio
max_steps: 8

audio.models first: read the text-to-speech models on this Mac and each one's SCRIPT FORMAT. Choose the ready model and
voice that fit a {{draft.form}} for {{audience}} — an expressive model (one with an exaggeration or instruct option) for
a story or a dramatic narrative, a clear steady voice for a class or an explanation; when none is ready, the one in use.
Then rewrite the script in that model's SCRIPT FORMAT exactly — punctuation, paragraphing, numbers spelled as spoken,
its embedded commands only if its format has them — without changing a fact or the meaning. Set its options for this
form (the expressiveness, the style line, the speed).

The corrected script:
{{correct.script}}

### Output
model: the tts model's name
voice: the voice (empty for the model's default)
options: the options for this file, one "name: value" per line (empty for none)
script: the script in the model's format, whole

## produce — Make, check and send
kind: agent
artifacts: audio
max_steps: 14

Make the audio and prove it says the script before it goes to the owner:
1. audio.make {text: the script below, title: "{{draft.title}}", model: {{voice.model}}, voice: {{voice.voice}},
   options: the options below}; audio.wait.
2. audio.transcribe {id}: it reports how much of the script was heard. Below 90%: find what the model skipped or misread
   (numbers, names, symbols, a long sentence), rewrite only those spots as they should be spoken, and make it again — at
   most twice.
3. audio.send {id, caption: the title and one line on what it is} — the owner's personal Telegram chat.

The options:
{{voice.options}}

The script:
{{voice.script}}

### Output
audio: the audio id sent, its length in seconds and the model and voice
heard: the share of the script heard on the last check, and what was fixed between tries
sent: where it went
