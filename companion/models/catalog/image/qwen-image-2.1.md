---
kind: image
title: Qwen Image 2.1
engine: command
default: true
about: Alibaba's Qwen-Image 2.1 on MLX (mflux) — strong prompt following and text in images; generates, refines from an image, edits with reference images, a mask or an object named to repaint.
weights: Qwen/Qwen-Image-2.1 (~30 GB, downloaded by mflux into ~/.cache/huggingface on first use; research / non-commercial license)
install: uv tool install --force --python 3.13 mflux==0.23.0 --with pillow==12.3.0
progress: '(\d+)/(\d+)'
modes:
  generate:
    bin: mflux-generate-qwen-2.1
    args: [--model, qwen-image-2.1]
    inputs:
      prompt: --prompt
      negative: --negative-prompt
      width: --width
      height: --height
      steps: --steps
      seed: --seed
      guidance: --guidance
      init: --image-path
      strength: --image-strength
      out: --output
  edit:
    bin: mflux-generate-qwen-2.1-edit
    args: []
    inputs:
      prompt: --prompt
      negative: --negative-prompt
      references: --image-paths
      mask: --mask-image
      auto_mask: --auto-mask
      strength: --strength
      steps: --steps
      seed: --seed
      guidance: --guidance
      out: --output
options:
  width: {type: number, default: 1024, min: 256, max: 2048, step: 16, about: "pixels wide"}
  height: {type: number, default: 1024, min: 256, max: 2048, step: 16, about: "pixels high"}
  steps: {type: number, default: 20, min: 4, max: 80, step: 1, about: "denoising steps — more is slower and finer"}
  guidance: {type: number, default: 4, min: 1, max: 12, step: 0.5, about: "how literally it follows the prompt"}
  quantize: {type: choice, choices: [none, 8, 6, 4], default: none, flag: --quantize, about: "smaller weights in memory — faster, a little less detail"}
  low_ram: {type: bool, default: false, flag: --low-ram, about: "trade speed for less memory"}
values: {}
---
# Qwen Image 2.1

Two modes, chosen per call by what it carries:

- **generate** — a prompt, or a refine: `init` (an earlier image) with `strength` (0..1, how far to move from it).
- **edit** — `references` (one or more images; the first is the one edited), a `mask` (white = repaint, black =
  keep, over the first reference) or `auto_mask` (name the object to repaint, e.g. "the red scarf"), `strength`.

An edit prompt is an instruction ("Add a small red bird standing on the snow", "Replace the moon with a crescent"): a
description alone leaves a masked area as it was.

On the M4 Max: 768² at 20 steps ≈ 51 s, 1024² ≈ 90 s, peak ≈ 25 GB.
