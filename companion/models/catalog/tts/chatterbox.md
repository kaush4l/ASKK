---
kind: tts
title: Chatterbox multilingual
engine: command
seed: true
about: "Resemble's Chatterbox on MLX — expressive, with an exaggeration control; 23 languages."
weights: mlx-community/chatterbox-fp16 (~1.5 GB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
stdin: text
split: paragraphs
bin: mlx_audio.tts.generate
args: [--model, mlx-community/chatterbox-fp16, --speed, "{speed}", --output_path, "{dir}", --file_prefix, "{stem}", --audio_format, wav, --join_audio]
script: |
  Plain prose, read as written: no tags, no SSML, no markdown, no emoji. It is the expressive one — the delivery follows
  the wording and the punctuation, so write the feeling into the sentences: exclamations, questions, short broken
  sentences for urgency, "…" for hesitation, a dash for a sudden turn. Dialogue in quotes reads with life. Turn the
  exaggeration option up for drama (0.7–1.0: a story's climax, an excited talk) and down for calm (0.35–0.5: a class, an
  explanation); keep cfg_scale near 0.5, lower (0.3) with high exaggeration for a slower, deliberate pace. Spell out
  numbers and abbreviations as spoken. Paragraphs of two to five sentences; a blank line between them. Set language to
  the script's language.
options:
  language: {type: choice, choices: [en, es, fr, de, it, pt, nl, pl, ru, tr, ar, hi, ja, ko, zh, sv, da, no, fi, el, he, ms, sw], default: en, flag: --lang_code, about: "the language it speaks"}
  exaggeration: {type: number, default: 0.5, min: 0.25, max: 2, step: 0.05, flag: --exaggeration, about: "how expressive: 0.5 natural, 0.7–1.0 dramatic"}
  cfg_scale: {type: number, default: 0.5, min: 0, max: 1, step: 0.05, flag: --cfg_scale, about: "how closely it follows the voice; lower = slower, more deliberate"}
  speed: {type: number, default: 1, min: 0.5, max: 2, step: 0.05, about: "how fast it speaks"}
values: {}
---
# Chatterbox multilingual

Runs per call with mlx-audio's command line, the script on stdin — no server to start. Expressive: the exaggeration
option (and the wording) carries the emotion. Try it from a terminal:

    echo "Hello there!" | mlx_audio.tts.generate --model mlx-community/chatterbox-fp16 --lang_code en --exaggeration 0.7 --output_path out --file_prefix hello --audio_format wav --join_audio
