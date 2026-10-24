---
kind: tts
title: Qwen3-TTS 0.6B CustomVoice
engine: command
about: "Alibaba's Qwen3-TTS on MLX (8-bit) — named speakers that take a style instruction."
weights: mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit (~1 GB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
stdin: text
bin: mlx_audio.tts.generate
args: [--model, mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit, --voice, "{voice}", --speed, "{speed}", --output_path, "{dir}", --file_prefix, "{stem}", --audio_format, wav, --join_audio]
script: |
  Plain prose, read as written: no tags, no SSML, no markdown, no emoji. The delivery is steered by the instruct option
  — one short line in natural language for the whole audio ("a warm storyteller, slow and gentle", "an energetic
  teacher, clear and upbeat", "calm, documentary narration") — not by markup in the text. Punctuation sets the pauses.
  Spell out numbers and abbreviations as spoken. English or Chinese reads best.
options:
  voice: {type: choice, choices: [Vivian, Serena, Dylan, Eric, Ryan, Aiden], default: Vivian, about: "the speaker"}
  instruct: {type: text, default: "", flag: --instruct, about: "the style for the whole audio, one line (empty: neutral)"}
  speed: {type: number, default: 1, min: 0.5, max: 2, step: 0.05, about: "how fast it speaks"}
values: {}
---
# Qwen3-TTS 0.6B CustomVoice

Runs per call with mlx-audio's command line, the script on stdin — no server to start. A named speaker, and the
instruct option for the style. Try it from a terminal:

    echo "Hello there." | mlx_audio.tts.generate --model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit --voice Vivian --instruct "warm and slow" --output_path out --file_prefix hello --audio_format wav --join_audio
