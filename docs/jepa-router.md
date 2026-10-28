# JEPA-style router for desk steps (research, 2026-10-27)

Owner's ask (voice, paraphrased): make desks faster and cheaper. Split the typed responses the agents already
write and learn from them. Use a JEPA-style loop to decide *when an action is needed*. Common paths run as a
script; new or niche paths go to a very small local model whose only quest is to write the tool call or fill its
parameters.

"JEV / JVI" read as **JEPA** (Joint-Embedding Predictive Architecture: predict the *embedding* of what comes
next, never the tokens). Correct this if another method was meant.

## 1. Idea in one picture

```
prompt state ──embed──► z_t ──predictor──► ẑ_{t+1}  (embedding of the next action)
                                   │
                    nearest action prototype + distance
                 ┌─────────────────┼──────────────────────┐
           close & confident    close, args unknown     far / novel
           SCRIPT (no model)    SMALL LOCAL MODEL       BIG MODEL (today's step)
           replay known call    fill params only        full ReAct step
```

Today every step (`backend/kernel/agent/agent.js:698` `#infer` → `parseReply`) is one big-model call that both
*decides* (which tool, or answer) and *writes* (the arguments, the prose). JEPA splits these: deciding happens in
embedding space (milliseconds, no generation); writing goes to the cheapest model that can write it.

## 2. Why JEPA fits, not a plain classifier

- JEPA predicts a latent target, so it learns "what kind of step comes next" without reproducing the text of
  the step — the noisy, costly part. That is exactly the decide/write split.
- The prediction error ‖ẑ − z_actual‖ is a free **novelty signal**: low error = a path seen many times; high
  error = niche → escalate. No separate out-of-distribution detector.
- Lineage: I-JEPA / V-JEPA (Meta, predictive latent learning); V-JEPA 2 (world model that plans actions by
  scoring candidate action embeddings); LLM-JEPA (2025, a JEPA term added to LLM fine-tuning). The router uses
  the V-JEPA 2 pattern: score candidate actions in latent space, act on the best, re-plan each step.
- Cost-routing kin: RouteLLM / FrugalGPT (route strong vs weak model by predicted difficulty); small
  function-calling models (xLAM-1B, Hammer, Qwen3 0.6–1.7B, FunctionGemma 270M) write a tool call from a schema
  well but decide poorly — so let them only write.

## 3. The data we already have ("split the typed responses")

Every run is in `<agent folder>/history.md` (request, steps, each call `{tool, input, ok, ms}`) and
`state/kernel-team.jsonl`. Each step splits into training pairs:

| from a step | becomes |
|---|---|
| prompt sections (REQUEST, artifacts, WORK DONE) | context x_t |
| `calls[].tool` (or `answer`) | action label a_t |
| `calls[].input` | argument target (small model) |
| `result.ok`, gate refusals, `format` events | quality label (drop bad steps) |
| next step's context | x_{t+1} (JEPA target) |

`scripts/steps.js` (to write) exports `steps.jsonl` per desk. Only `ok` steps not followed by a gate refusal are
positives.

## 4. The model (small, local, trains on this Mac)

1. **Encoder** E: frozen sentence embedder (bge-small / nomic-embed) over a *slim* state: request + last 2
   steps' tool names and result heads + open checklist items. 384–768 dims, ~5 ms on MLX.
2. **Predictor** P: 2-layer MLP (or tiny transformer over the last k step embeddings): z_t → ẑ_{t+1}. Loss
   ‖P(z_t) − sg(E_ema(x_{t+1}))‖², EMA target encoder against collapse.
3. **Action head** H: ẑ → logits over the desk's actions (tool names + `answer`), cross-entropy on a_t, joint.
4. **Prototypes**: mean ẑ per action and per *argument template* (same tool, literals masked:
   `web.search {q: <TEXT>}`, `files.read {path: data/<DATE>.md}`).

< 2 M trainable params; minutes to train on a few thousand steps; retrain nightly from history.

## 5. Routing rule per step

```
z = E(state); ẑ = P(z); p = softmax(H(ẑ)); a* = argmax p; err = dist(ẑ, proto[a*])

if p[a*] ≥ τ_hi and err ≤ ε_lo and template(a*) has fixed args   → SCRIPT  (code fills the call)
elif p[a*] ≥ τ_mid and err ≤ ε_mid                                → LOCAL   (tiny model writes args only)
else                                                              → BIG     (today's step, unchanged)
```

- **SCRIPT**: args fully determined (same check command, `plan.tick` of the item just done, `dispatch.wait`,
  re-read of a fixed path). Zero tokens.
- **LOCAL**: router picked the tool; small model gets ~300 tokens: the tool's `spec()` input schema, request,
  last result head — "write only the JSON input". Schema-constrained decoding (llama.cpp grammar / MLX outlines)
  so only a valid call can come out.
- **BIG**: every `answer` (prose to the owner), every novel step, and every call that `readsOutside` or acts on
  the world (orders, sends, `desk.create`) — never routed down.

τ/ε set per desk on a held-out week so routed steps agree with the big model ≥ 97%.

## 6. Rails

- Router only proposes; lanes, tool input checks, gates and the desk guard still run.
- A LOCAL call failing schema or `ok: false` → same step re-runs BIG with the failure in WORK DONE. Two misses
  for one template in a day → template demoted to BIG.
- Allowlist: read tools and the desk's own artifact bookkeeping first. Orders, `talk.*`, `desk.*`, kept spawns:
  BIG forever.
- Shadow first: run beside the big model, record agreement only (like the workflow `shadow` A/B), one week.

## 7. Kernel seam (one place)

```js
// before #infer at agent.js:698
const routed = await this.router?.decide({request, steps, tools: this.tools}) // {mode, call?, tool?, p, err}
if (routed?.mode === "script") reply = {calls: [routed.call]}
else if (routed?.mode === "local") reply = {calls: [await this.router.fill(routed.tool, state)]}
else reply = parseReply(await this.#infer(prompt, signal, images))
```

UI twin (no unseen work): `step` event gains `route {mode, tool, p, err, model, ms}`; thread and Live feed show a
chip "script · 2 ms" / "local qwen3-0.6b · 180 ms" / "big"; stats add tokens saved. A `router` artifact view per
desk: hit rate by mode, shadow agreement, demoted templates, Retrain now, off switch.

Local model wire exists: `models.local` (`llm/<provider>/v1`, Apple on-device) and any OpenAI-compatible server
(llama.cpp, LM Studio, mlx-lm) through `model/llm.js`.

## 8. Expected gain (to measure, not assumed)

Many desk steps are bookkeeping or repeats (tick, wait, same file, same check). If ~40% route to SCRIPT/LOCAL,
those steps go from 5–30 s (CLI model) to < 0.3 s and from full tokens to ~0 (script) or ~5% (local). Step 1
measures the real repeat share before any build.

## 9. Plan

1. `scripts/steps.js`: steps.jsonl from history.md; per desk report action entropy and share of steps whose
   (tool, masked-args) template repeats ≥ 5×. **Go/no-go on this number.**
2. Train E+P+H in MLX (custom/lab); eval top-1 action accuracy vs coverage.
3. Arg filler bake-off: Qwen3-0.6B/1.7B, FunctionGemma, Apple FM, schema-constrained, on held-out LOCAL steps
   (valid-and-ok rate).
4. Kernel seam + twin, shadow mode, one desk, one week.
5. Enable SCRIPT, then LOCAL, per template, with demotion.

## 10. Step 1 measured (2026-10-27, `bun scripts/steps.js`)

Data: 1970 steps (one row per tool call; a step with no calls counts as one "answer" row) from 30 agents' history.md.
- **Template repeat share is high**: agent/agent 71%, saga-tales 89%, dev/critic 48%, trade-card/local 45%. Many
  calls have the same tool and the same argument shape, so SCRIPT/LOCAL could cover a lot of them.
- **Answers are rare**: ≤ 3% of rows for most agents. The big model mostly picks tools; it rarely writes
  prose.
- **Failure is common**: 58–88% of rows are ok for the busiest agents. Failed calls show where the arguments are
  wrong, which is the small model's training signal (the input that worked on retry).
- **The action-history baseline is weak**: guessing the next tool from the last two tools agrees 90% of the time
  at τ 0.7, but it covers only 8% of steps (100% agreement at τ 0.9, covering 4.5%). The previous tools alone do
  not decide the step; the state does. That gap is what the JEPA predictor over the state embedding (§4) has to
  close: a repeat share of 45–70% against a safe coverage of 4.5% today.

**Go**: there are enough repeated templates. Next is step 2 (train E+P+H on `steps.jsonl`; beat 4.5% coverage
at ≥ 97% agreement).

## 11. Step 2, first try (2026-10-27, `bun scripts/router.js steps.jsonl`): no-go with a hashed encoder

Setup:
- E: a frozen hashed bag of the state (request words, previous two tools, the last result head), D 2048.
- T: a frozen random projection of the next call's template, K 64.
- P: linear, trained on the latent error (loss 0.48 → 0.39 over 30 epochs, ~1 s in Bun).
- Decision: the nearest tool prototype, then the nearest template within that tool.

Held-out results, the last 30% of each agent's steps:

| router | best tool agreement | coverage there |
|---|---|---|
| prev-2 baseline (§10) | 100% | 4.5% |
| JEPA latent, template prototypes | 67% | 10.6% |
| JEPA latent, tool → template | 69% | 6.5% |
| supervised softmax on the same E (check) | 67% (75% random split) | 7% (12%) |

Reading: the problem is the encoder, not the JEPA objective. Even a supervised head on these features gets only
33–41% top-1. Bag-of-words state does not say which tool comes next, and the confident guesses are wrong a third
of the time. The data is also small (1970 rows over 30 agents; ~1400 ok train rows), and desks change over time
(a random split beats the chronological one by 8–9 points).

What would change the result, in order of cost:
1. **A real encoder**: a sentence embedder over the step's own *thought* line (the reply's thought, written just
   before the calls) plus the open checklist or goal milestone. The thought names the next action; bag-of-words
   over the request does not. But the thought is the big model's own output, so this routes only the *argument
   writing*, not the decision (still a saving: the big model replies with a thought and a tool name only).
2. **Per-run repeat routing** (no learning): inside one run, a call identical to an earlier one whose result has
   not changed is answered from that earlier result. Partly exists already (the 3-minute data cache in tool.js).
3. **More data**: rerun steps.js monthly; per-agent models where an agent has > 500 rows (agent/agent, the dev
   critic, trade-card/local).

Decision for now: no router turns on. Keep the exporter and trainer; the next experiment is (1) — the big model
writes `thought` + `tool` only and a local model fills `input` against the tool's schema — measured on the
held-out rows as the valid-and-ok rate of the filled inputs.

## 12. Argument fill by a local model (2026-10-27, `bun scripts/fill.js steps.jsonl --n 60`)

The big model's thought and tool name were given, and Apple's on-device model (through `/__askk/llm/apple/v1`)
wrote only the JSON input. 60 held-out ok calls with slotted arguments:

| json parses | same keys | values close (≥ 60% word overlap) | exact | latency |
|---|---|---|---|---|
| 93% | 30% | 0% | 0% | 1.45 s/call, ~1300 prompt chars |

Failures:
- **Wrong shape**: it adds a `tool` key, drops optional fields (`files.read` `from`/`lines`), or misses required
  ones (`goal.note` `evidence`). The fix is mechanical: decode against the tool's `spec()` schema. That would
  probably lift "same keys" toward 100%.
- **Wrong content**: the values are the real work (which checklist id, which URL, which search words, the
  evidence text). The small model picks plausible but different ones (`id: deliver` for `work`, another
  Wikipedia page). This is not a format problem: the values *are* the decision, and the thought does not pin
  them down.

## 13. Conclusion so far

- The typed responses split cleanly (steps.js), and there are many repeated call shapes (45–89% on busy agents).
- Neither half of the plan reaches a safe bar with what exists today: the JEPA router decides at 69% (bar 97%),
  and the 3B local filler gets the values right 0% of the time. Switching either on would make desks wrong, not
  cheap.
- What does hold: a **SCRIPT** route for calls with fixed arguments in a known state. The prev-2 baseline is 100%
  at 4.5% coverage, and these are mostly bookkeeping (`dispatch.wait`, `files.list`, `terminal.read`).
- Cheaper wins that need no learning: (a) shrink the big model's prompt (the cost is the prompt, not the reply);
  (b) per-run repeat answers from cache (§11.2); (c) schema-checked inputs so a bad call is caught before it runs
  (lifts the 58–88% ok rate).
- Worth retrying: a real local function-calling model (Qwen3-1.7B / xLAM via llama-server, which is installed)
  with schema-constrained decoding, and the router on a sentence-embedding encoder once there is more data.

## 14. Built: the router in the loop, shadow mode (2026-10-27)

- Kernel: `config.router {decide, act}` (`agent/agent.js`, before the model call). `decide({request, steps,
  agent})` → `{mode: script | big, calls?, p, why}`. Shadow unless `act`. With `act` and mode `script`, its calls
  run with no model call (thought "(script route) …"). The step event carries `route {mode, acted, p, predicted,
  agree}`. Listed in `classes.js`; tests in `test/router.test.js`.
- `agent/router.js` `scriptRouter(rows, {tau 0.9, minN 3, act false})`: the previous-two-calls table over
  fixed-argument call shapes (the only route that held at 100%, §10).
- Compose: main.js `router: (agentName) => router | null` is handed to every agent spec.
- Desk: the core desk `desks/agent` runs it in shadow from `memory/agent/router/steps.jsonl` (refresh:
  `bun scripts/steps.js desks --out memory/agent/router/steps.jsonl`).
- UI twin: the step row carries `route`; the agent's thread shows "router shadow · <tools> · agrees/differs",
  "script route · …" or "router · big" (`RouteChip`, `components/agents/thread.jsx`).
- Live check: a request on :1111 ran 3 steps, each recorded `route` (all `big`, p 0: no known pattern for that
  request).

Later the same day: `act: true` on the core desk, limited to `READ_ONLY` tools (router.js), so a replayed call
cannot change anything. Measured on all 1970 steps: **0 steps qualify**. Read-only calls with fixed arguments
never repeat after the same two calls, so the acting route is live but never fires. The repeats found in §10 are
calls that write or need fresh values; those need a correct argument writer, which nothing local has passed yet.

Before act: the shadow log shows `agree` on every `script` prediction for a week, set `act: true` in main.js.
The LOCAL route (a small model fills the arguments) stays off until a filler passes §12.

## Open questions

- Was "JEV/JVI" JEPA? If another method was meant, §5–7 hold; only §4's objective changes.
- First desk: dev (many tool steps) or trade-card (latency matters most)?

## 15. Local route in the loop, shadow (2026-10-27)

`withShadowFill(router, {fill, examples, log})` (router.js): for each call the big model writes, the router's
small model writes the same call's input from the thought and tool alone. Never awaited, never run. The router
compares it (same keys, exact), keeps `tally`, and logs each comparison to `memory/agent/router/shadow.jsonl`. The
core desk uses Apple's on-device model through the host. Live run on :1111: the fills came back in 2–6 s. The
filler mostly copies the earlier example inputs (another run's checklist ids, evidence and paths), which confirms
§12: it gets the shape right only sometimes and the values almost never. The LOCAL route acts only once
shadow.jsonl shows it exact on a tool for a sustained run; today, no tool qualifies.

## 16. Owner's design, confirmed (2026-10-27): typed hidden tool calling, JEPA-centric

Owner: "JEB style model" (the JEPA line; the "Laya" reference matches VL-JEPA's *selective decoding*: predict in
embedding space, decode text only when needed). "A type hidden tool calling. Fixed set of actions … convert the
LLM centric design to a JEV centric design, such that decisions can be now taken much quicker and for ones where
the state is not a typed answer or a direct answer, we can have a small on-device local model that can create the
specified query."

The design this asks for:
- **The action is a type, not text.** Each desk has a fixed action set: every tool, every artifact command,
  `answer`. The JEPA predictor picks one from the state embedding; no model writes the tool name.
- **Each slot is typed** (from the tool's `input` spec plus the history):
  - *enum*: a known value set, read from live state where it exists (checklist item ids, artifact ids, agents,
    terminal sessions) or else learned (≤ 8 values cover 90%). Picked by the predictor, nearest value in latent
    space. Never generated.
  - *number*: predicted, or copied from state.
  - *ref*: a path or URL, taken from state (the file tree, the links in the last result). Never invented.
  - *text*: free text (search words, a note, evidence). The only slot the small on-device model writes, prompted
    with that slot alone.
- **Decoding is selective**: the big model is called only when the predictor's error is high (a novel state) or
  when the action is `answer` to the owner.

Measured on 1518 ok calls (history): slot values are 34% enum, 16% number and 50% free text. **28.5% of calls
have no free-text slot**, so the predictor could decide them whole with no model at all. 71.5% have at least one
text slot for the small model. §12's 0% shows why typing matters: most of Apple's misses were enum and ref slots
(checklist `id`, `path`), which a typed design takes from state instead of asking a model.

Build order:
1. `slotTypes(tool, rows, state)`: the type of each input field (spec + history + live-state sources). Typed
   response format: `act: <id>` plus the typed slots.
2. A predictor head per slot type: action (done in §11; needs a better encoder), enum by nearest value, ref from
   state.
3. The small model fills text slots only (one slot per prompt). Re-run fill.js scoring only the text slots.
4. Shadow in the loop (§14–15 seam), then act per tool once its exactness holds.

## 17. Typed fill, first measure (2026-10-27, `bun scripts/typed-fill.js steps.jsonl --n 60`)

60 held-out ok calls, 143 slots:

| slot type | slots | exact | how it was filled |
|---|---|---|---|
| enum | 49 | 43% | known value with the most word overlap with the thought |
| ref | 26 | 8% | first path or URL in request / thought / last result head |
| number | 21 | 0% | first number in the same text |
| text | 47 | 2% (close 4%) | Apple on-device model, one slot per prompt |
| whole call | 60 | 3% | |

Reading:
- Typing helps enums a lot (0% → 43% with a word-overlap picker and no learning at all). A latent nearest-value
  picker and live-state sources (the open checklist ids, not the history's) are the next lift.
- Ref and number fail because the rows hold only a 300-char head of the last result. The right path or count sits
  in the state the agent saw (the file tree, the full result), and the exporter does not keep it. Next: record the
  state sources per step (artifact ids, tree paths, result links) so ref slots pick from them.
- Free text stays the hard part, and it is half of all slots. A 3B model writing the big model's exact search
  words or evidence is not a realistic bar. The useful bar is whether the call *works* (ok, same result class),
  which needs running the filled call in shadow, not string match.

Status: the loop has the script route (acting, read-only) and the local route (shadow). The typed-slot fill is
measured offline. No route replaces the big model on text slots.
