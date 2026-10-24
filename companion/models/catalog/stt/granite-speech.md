---
kind: stt
title: IBM Granite Speech 4.0 1B
engine: command
about: "IBM's Granite speech model — en, fr, de, es, pt, ja; careful punctuation."
weights: ibm-granite/granite-4.0-1b-speech (~2 GB, downloaded on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
bin: mlx_audio.stt.generate
args: [--model, ibm-granite/granite-4.0-1b-speech, --audio, "{audio}", --output-path, "{dir}/{stem}", --format, txt]
output: file:{dir}/{stem}.txt
options:
  language: {type: choice, choices: [en, fr, de, es, pt, ja], default: en, flag: --language, about: "the language spoken"}
values: {}
---
# IBM Granite Speech 4.0 1B

Runs per call with mlx-audio's command line (`mlx_audio.stt.generate`) — no server to start; the model loads for each
call (a second or two once the weights are down). The first call downloads the weights into ~/.cache/huggingface.
Try it from a terminal:

    mlx_audio.stt.generate --model ibm-granite/granite-4.0-1b-speech --audio clip.wav --output-path out --format txt
