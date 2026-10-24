---
kind: stt
title: Qwen3-ASR 1.7B
engine: command
about: "Alibaba's Qwen3-ASR on MLX (8-bit) — 30 languages and Chinese dialects, accurate."
weights: mlx-community/Qwen3-ASR-1.7B-8bit (~2 GB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
bin: mlx_audio.stt.generate
args: [--model, mlx-community/Qwen3-ASR-1.7B-8bit, --audio, "{audio}", --output-path, "{dir}/{stem}", --format, txt]
output: file:{dir}/{stem}.txt
options:
  language: {type: text, default: en, flag: --language, about: "the language code spoken (en, zh, yue, ja, ko, fr, de …)"}
values: {}
---
# Qwen3-ASR 1.7B

Runs per call with mlx-audio's command line (`mlx_audio.stt.generate`) — no server to start; the model loads for each
call (a second or two once the weights are down). The first call downloads the weights into ~/.cache/huggingface.
Try it from a terminal:

    mlx_audio.stt.generate --model mlx-community/Qwen3-ASR-1.7B-8bit --audio clip.wav --output-path out --format txt
