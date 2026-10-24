---
kind: stt
title: Whisper large-v3 turbo
engine: command
about: "OpenAI's Whisper large-v3 turbo on MLX — 99 languages, robust to noise."
weights: mlx-community/whisper-large-v3-turbo-asr-fp16 (~1.6 GB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
bin: mlx_audio.stt.generate
args: [--model, mlx-community/whisper-large-v3-turbo-asr-fp16, --audio, "{audio}", --output-path, "{dir}/{stem}", --format, txt]
output: file:{dir}/{stem}.txt
options:
  language: {type: text, default: en, flag: --language, about: "the language code spoken (en, fr, de, hi, ja …; 99 languages)"}
values: {}
---
# Whisper large-v3 turbo

Runs per call with mlx-audio's command line (`mlx_audio.stt.generate`) — no server to start; the model loads for each
call (a second or two once the weights are down). The first call downloads the weights into ~/.cache/huggingface.
Try it from a terminal:

    mlx_audio.stt.generate --model mlx-community/whisper-large-v3-turbo-asr-fp16 --audio clip.wav --output-path out --format txt
