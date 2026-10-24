---
kind: stt
title: NVIDIA Parakeet TDT 0.6B v3
engine: command
seed: true
about: "NVIDIA's Parakeet on MLX — very fast, strong English and 24 European languages, punctuated."
weights: mlx-community/parakeet-tdt-0.6b-v3 (~2.5 GB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
bin: mlx_audio.stt.generate
args: [--model, mlx-community/parakeet-tdt-0.6b-v3, --audio, "{audio}", --output-path, "{dir}/{stem}", --format, txt]
output: file:{dir}/{stem}.txt
options:
  language: {type: choice, flag: --language, choices: [en, bg, cs, da, de, el, es, et, fi, fr, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, ru, sk, sl, sv, uk], default: en, about: "the language spoken (Parakeet v3: English and 24 European languages)"}
values: {}
---
# NVIDIA Parakeet TDT 0.6B v3

Runs per call with mlx-audio's command line (`mlx_audio.stt.generate`) — no server to start; the model loads for each
call (a second or two once the weights are down). The first call downloads the weights into ~/.cache/huggingface.
Try it from a terminal:

    mlx_audio.stt.generate --model mlx-community/parakeet-tdt-0.6b-v3 --audio clip.wav --output-path out --format txt
