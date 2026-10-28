# Portable workflows — running trade-card on any model API

2026-10-25 owner: "the current trade card is using workflows. The problem with workflows is that it is not universal. We
might not be able to use the same workflows with other API like openai API. Research for a solution."

## What is not universal today

The workflow *engine* is already portable: `backend/kernel/builtin/workflow.js` reads the md files, orders the steps,
renders prompts, checks each ```data block and runs the code steps in plain JS. The part that only works with one
provider is the step kind every trade-card stage uses: `kind: research` (the default in `custom/trade-card/lib/stages.js`).

A research step is one `POST llm/research` call (`companion/capabilities/research.js`). That call runs
`claude -p --tools WebSearch,WebFetch --mcp-config …`. The Claude CLI is the agent loop, and both web tools are
Anthropic's. Robinhood and OpenAlice reach it as stdio MCP servers (`market-bridge.js`). Swap in an OpenAI or a local
model and all of this goes:

| Piece | Where it lives now | Tied to |
|---|---|---|
| The agent loop inside a stage (turns, tool calls) | Claude CLI | Claude Code binary |
| Web search / page read | CLI's `WebSearch` / `WebFetch` | Anthropic server tools |
| Market data (quotes, bars, option chains, index) | `market-bridge.js` over stdio MCP | CLI's `--mcp-config` |
| OpenAlice data | bridge `--data` | CLI's `--mcp-config` |
| Order tools | bridge `--orders` | CLI's `--mcp-config` |
| Turn / time limits, cost | `--max-turns`, CLI result event | CLI flags |

## Options looked at

1. **One research backend per provider.** Keep `kind: research` and add an OpenAI one, for example the Responses API
   with its `web_search` tool and its `mcp` tool for remote servers. This fails for this desk. A hosted MCP tool is
   called from OpenAI's servers, so it cannot reach this Mac's broker bridge on localhost. Robinhood and OpenAlice would
   have to be function calls run here anyway. Each provider would also need its own backend (Gemini grounding, Ollama
   with no search at all), so N backends would drift apart.
2. **A framework.** mcp-use, LiteLLM and the OpenAI Agents SDK each give one loop over many providers. That means a new
   dependency that does what the kernel already does. Their own docs also warn that a model with no native tool calling
   cannot use MCP tools at all.
3. **The kernel's own loop (recommended).** `kind: agent` with no `agent:` is already a step kind in both the kernel and
   trade-card's `stages.js` (`own: true`). The workflow spawns a step agent (`callStepAgent`) on ASKK's ReAct loop.
   - Its model is `complete()` in `model/llm.js`, over any OpenAI-compatible `/chat/completions` (OpenAI, OpenRouter,
     Ollama, LM Studio, vLLM, llama.cpp, oMLX), any Anthropic `/messages`, or the local CLIs.
   - Its tool calls are the text protocol in `agent/reply.js` (`call:` lines), so they need no provider's
     function-calling format and work on any model that follows instructions.
   - Its tools run here, so the broker token and the desk's order guard stay on this machine.
   - Its ```data contract is the `StepContract` gate, the same check that `kind: research` gets.

## Recommendation: make every stage a kernel step agent

Changing `kind: research` to `kind: agent` in a stage's frontmatter (and `tools: [...]` to kernel tool names) is the whole
switch. Only the model is provider-specific, and it is one `model:` line (or the desk default). Four gaps stand in the way
of parity.

1. **Market tools as kernel tools.** Today a step agent has only `market.look` (snapshots). Turn the bridge's six read
   tools into kernel `Tool`s (`market.quotes`, `market.bars`, `market.option_chain`, `market.option_instruments`,
   `market.option_quotes`, `market.index_quote`). Build them from the same `BRIDGE_TOOLS` table and the same pure
   argument check, and call them through `ctx.host` → `mcp/call`. Then one definition has two transports (MCP for the
   CLI, a kernel tool for any model), and the desk guard still decides. Do the same for the order tools later, behind
   the same guard, only for the stage that has them today.
2. **Search quality.** The kernel's `web.search` is the host's `web/search`: SearXNG when `ASKK_SEARXNG_URL` is set,
   else DuckDuckGo's HTML page, else the Wikipedia/arXiv/HN fallback. That is weaker than Claude's WebSearch. Fix it in
   this order, keeping one `web.search` interface:
   - (a) run SearXNG locally (free, keyless, already supported);
   - (b) add an optional keyed engine (Brave or Tavily) to `companion/capabilities/web.js`;
   - (c) optional, later: when the step's model has a native search (OpenAI `web_search`, Anthropic `web_search`,
     Gemini grounding), `web.search` may route there. This is an engine choice, never a separate stage kind.
3. **Turns and cost.** The CLI's turns are cheap because it keeps its own context. The kernel re-renders the prompt every
   step: about 10–40K chars per stage, up to `max_steps`.
   - Keep `cacheAt` prompt caching on, so the stable top of the prompt is cached.
   - Put several calls in one step (the loop already runs a step's calls together).
   - Map `max_turns` to `max_steps` (16 → about 8 steps of 2–3 calls).
   - Compaction at 90% already covers a long stage.
4. **Small models.** A 7–14B local model may skip the `call:` format or write a weak ```data block. The contract gate
   refuses and re-asks (`gateRetries`), and a stage that still fails falls to PASS through `critical`. That is safe, but
   it can mean no card. If a provider's own function calling proves more reliable than the text protocol, add it as an
   optional adapter in `llm.js` that maps `tools` to `tools: [{type: function}]` and back into the same call rows. The
   prompt format stays the fallback.

### Rollout (one stage at a time, A/B on the same day)

Status 2026-10-25: step 1 done (`companion/capabilities/market-tools.js`, registered by trade-card). Step 2 is set up:
05-pattern runs as a step agent (A, read downstream) with a research `shadow:` (B), compared on the pipeline row and saved
as `NN-pattern.shadow.*` in each run folder. First A/B: the next 08:45 ET slot.

1. Build the market kernel tools (gap 1) and test them against `fake-host`.
2. Switch one low-stakes stage, `05-pattern` or `12-ledger`, to `kind: agent` on the default model. Compare its
   ```data and gate results with the research run on the same day.
3. Run the same stage on an OpenAI model (`model: <openai entry>` in main.js `models`) and on a local one (oMLX). That
   is the portability proof.
4. Move `04-evidence` (the heaviest web stage) once search quality (gap 2) is settled.
5. Keep `kind: research` as an optional fast path for Claude only. The md stays the same; only `kind:` and `tools:`
   differ.

## Sources

- OpenAI Responses API tools (`web_search`, remote `mcp`, function calling):
  https://developers.openai.com/docs/guides/tools, https://openai.com/index/new-tools-and-features-in-the-responses-api
- Remote MCP in the Responses API: https://community.openai.com/t/introducing-support-for-remote-mcp-servers-image-generation-code-interpreter-and-more-in-the-responses-api/1266973
- Provider-agnostic MCP agents and their limits (text-only models cannot use MCP tools): https://docs.mcp-use.com/v2/typescript/agent/llm-providers
