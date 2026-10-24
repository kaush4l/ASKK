---
kind: tts
title: Kokoro 82M
engine: command
seed: true
about: "Kokoro on MLX — 82M parameters, natural and fast; 41 voices in 7 languages."
weights: mlx-community/Kokoro-82M-bf16 (~330 MB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
stdin: text
lang_from_voice: true
bin: mlx_audio.tts.generate
args: [--model, mlx-community/Kokoro-82M-bf16, --voice, "{voice}", --lang_code, "{lang}", --speed, "{speed}", --output_path, "{dir}", --file_prefix, "{stem}", --audio_format, wav, --join_audio]
script: |
  Plain prose, read exactly as written: no tags, no SSML, no stage directions, no emoji, no markdown (headings and
  bullets are read out). Punctuation is the only control — a comma is a short pause, a full stop a longer one, "…" a
  trailing pause, a blank line between paragraphs a breath; a question mark lifts the end. Emotion comes from the words
  and the sentence rhythm, never from markup: short sentences for tension, longer flowing ones for calm. Spell out what
  must be said as spoken: numbers ("twenty twenty-six", "three point five"), units, symbols, abbreviations ("for
  example", not "e.g."). Keep sentences under about 30 words. Write in the voice's language (its first letter: a
  American, b British English, e Spanish, f French, h Hindi, i Italian, p Portuguese). Speed 0.9 suits a story or a
  class, 1.0 a talk.
options:
  voice: {type: choice, choices: [af_heart, af_alloy, af_aoede, af_bella, af_jessica, af_kore, af_nicole, af_nova, af_river, af_sarah, af_sky, am_adam, am_echo, am_eric, am_fenrir, am_liam, am_michael, am_onyx, am_puck, am_santa, bf_alice, bf_emma, bf_isabella, bf_lily, bm_daniel, bm_fable, bm_george, bm_lewis, ef_dora, em_alex, em_santa, ff_siwis, hf_alpha, hf_beta, hm_omega, hm_psi, if_sara, im_nicola, pf_dora, pm_alex, pm_santa], default: af_heart, about: "the speaker — its first letter is the language: a American, b British, e Spanish, f French, h Hindi, i Italian, p Portuguese; then f female, m male"}
  speed: {type: number, default: 1, min: 0.5, max: 2, step: 0.05, about: "how fast it speaks"}
values: {}
---
# Kokoro 82M

Runs per call with mlx-audio's command line (`mlx_audio.tts.generate`), the script on stdin — no server to start;
about two seconds with the model load for a short line. The voice's first letter is sent as its language (lang_code),
so a British voice pronounces as British English. Japanese and Chinese voices need misaki's ja/zh extras and are left
out. Try it from a terminal:

    echo "Hello there." | mlx_audio.tts.generate --model mlx-community/Kokoro-82M-bf16 --voice bf_emma --lang_code b --output_path out --file_prefix hello --audio_format wav --join_audio
