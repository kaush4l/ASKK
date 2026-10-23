---
kind: tts
title: Qwen3-TTS 0.6B CustomVoice
engine: openai
about: Alibaba's Qwen3-TTS on MLX (8-bit) — expressive named speakers.
weights: mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit (~1 GB, downloaded by mlx-audio on first use)
install: uv tool install --force --python 3.13 "mlx-audio[stt,tts,server]" --with misaki --with "spacy>=3.8,<4" --with num2words --with phonemizer-fork --with espeakng-loader --with "en_core_web_sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" --prerelease=allow
url: http://127.0.0.1:8321/v1
model: mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
serve:
  bin: mlx_audio.server
  args: [--host, 127.0.0.1, --port, "8321"]
options:
  voice: {type: choice, choices: [Vivian, Serena, Dylan, Eric, Ryan, Aiden], default: Vivian, about: "the speaker"}
  speed: {type: number, default: 1, min: 0.5, max: 2, step: 0.1, about: "how fast it speaks"}
values: {}
---
# Qwen3-TTS 0.6B CustomVoice

Served by mlx-audio's OpenAI-compatible server (port 8321, started by the helper and kept running). Try it from a
terminal:

    mlx_audio.tts.generate --model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit --text "Hello there" --voice Vivian --output_path out --audio_format wav --join_audio
