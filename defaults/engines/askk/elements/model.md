---
title: Model
kind: model
order: 1
description: "The offline echo model: deterministic, no key, for trying the loop."
config: { connector: echo, id: echo, context: 12000 }
---
To use Claude through its CLI instead, set the frontmatter to:

<!-- config: { connector: claude-cli, id: sonnet, context: 400000 } -->

Or an OpenAI-compatible server (the key read from the env var named by key_env, never stored here):

<!-- config: { connector: openai, id: gpt-4o-mini, base_url: "https://api.openai.com/v1", key_env: OPENAI_API_KEY, context: 400000 } -->
