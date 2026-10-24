---
kind: stt
title: NVIDIA Parakeet TDT 0.6B v3
engine: openai
seed: true
about: NVIDIA's Parakeet on MLX — very fast, strong English and 25 European languages, punctuated.
weights: mlx-community/parakeet-tdt-0.6b-v3 (~2.5 GB, downloaded by mlx-audio into ~/.cache/huggingface on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts,server]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
url: http://127.0.0.1:8321/v1
model: mlx-community/parakeet-tdt-0.6b-v3
serve:
  bin: mlx_audio.server
  args: [--host, 127.0.0.1, --port, "8321"]
options:
  language: {type: choice, choices: [en, bg, cs, da, de, el, es, et, fi, fr, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, ru, sk, sl, sv, uk], default: en, about: "the language spoken (Parakeet v3: English and 24 European languages)"}
values: {}
---
# NVIDIA Parakeet TDT 0.6B v3

Served by mlx-audio's OpenAI-compatible server (`mlx_audio.server`, port 8321): the helper starts it on the first
utterance and keeps it running, so the model stays loaded; one server holds every mlx-audio model here. The first
utterance downloads the weights. Try it from a terminal:

    mlx_audio.stt.generate --model mlx-community/parakeet-tdt-0.6b-v3 --audio clip.wav --output-path - --format txt
