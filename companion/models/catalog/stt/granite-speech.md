---
kind: stt
title: IBM Granite Speech 4.0 1B
engine: openai
about: IBM's Granite speech model — en, fr, de, es, pt, ja; careful punctuation.
weights: ibm-granite/granite-4.0-1b-speech (~2 GB, downloaded by mlx-audio into ~/.cache/huggingface on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts,server]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
url: http://127.0.0.1:8321/v1
model: ibm-granite/granite-4.0-1b-speech
serve:
  bin: mlx_audio.server
  args: [--host, 127.0.0.1, --port, "8321"]
options:
  language: {type: text, default: en, about: "the language code spoken (en, fr, de …)"}
values: {}
---
# IBM Granite Speech 4.0 1B

Served by mlx-audio's OpenAI-compatible server (`mlx_audio.server`, port 8321): the helper starts it on the first
utterance and keeps it running, so the model stays loaded; one server holds every mlx-audio model here. The first
utterance downloads the weights. Try it from a terminal:

    mlx_audio.stt.generate --model ibm-granite/granite-4.0-1b-speech --audio clip.wav --output-path - --format txt
