---
kind: image
title: Z-Image Turbo
engine: command
about: Tongyi's Z-Image Turbo (6B) on MLX — photoreal drafts in 8 steps; generates and refines from an image, no edit mode.
weights: Tongyi-MAI/Z-Image-Turbo (~12 GB, downloaded by mflux on first use)
install: uv tool install --force --python 3.13 mflux==0.23.0 --with pillow==12.3.0
progress: '(\d+)/(\d+)'
modes:
  generate:
    bin: mflux-generate-z-image-turbo
    args: []
    inputs:
      prompt: --prompt
      negative: --negative-prompt
      width: --width
      height: --height
      steps: --steps
      seed: --seed
      init: --image-path
      strength: --image-strength
      out: --output
options:
  width: {type: number, default: 1024, min: 256, max: 2048, step: 16, about: "pixels wide"}
  height: {type: number, default: 1024, min: 256, max: 2048, step: 16, about: "pixels high"}
  steps: {type: number, default: 8, min: 4, max: 30, step: 1, about: "denoising steps (turbo: 8 is enough)"}
  quantize: {type: choice, choices: [none, 8, 4], default: none, flag: --quantize, about: "smaller weights in memory"}
values: {}
---
# Z-Image Turbo

Fast drafts: explore compositions here, then refine the pick with Qwen Image 2.1.
