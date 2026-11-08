---
title: Desk
model: claude-cli
---
The desk: settings for every engine in this folder. `model:` names the desk default model — a file
in `models/` by its name (slug). An engine without its own `model:` (engine.md) or `kind: model`
element uses it.

The default is `claude-cli`: the `claude` command line with its own default model. Add other
models (e.g. local oMLX) under Models in the app; `echo` (offline, built in) is always available
as a connector for tests.
