# The testbed

There is a real model on this machine, it answers the OpenAI wire protocol, and
a page served from anywhere may call it. That makes this repository's central
claim — *a static browser page is enough to run an agent* — testable end to end
for the first time, without a proxy, a key, or a server of our own.

This page is two things at once. It is the instruction for pointing this project
at a real model, and it is the audit trail for every number about that model
which appears anywhere else in this tree. A number here carries the command that
produced it. A claim that arrived without output is written down as
`unverified`, with the name of whoever claimed it, and it stays that way until
someone runs it again.

Measured **2026-09-01**, between 04:56 and 06:20 local. Endpoint facts and the
three headline model behaviours were re-run by the author of this page at 06:16
and are pasted below as they came back.

**Two things that will rot, named up front.** The probe scripts and the
comparison rig live in a session scratchpad under `/private/tmp/claude-501/…`,
which is not in this repository and will not survive the machine. Every command
below is therefore written so it can be re-derived from the repository plus
`curl`. And the endpoint is somebody's laptop: the model list, the speed and
even the model's name are properties of *that host on that afternoon*, not of
this project.

---

## The endpoint

| Fact | Value | Command |
|---|---|---|
| Base URL | `http://127.0.0.1:8873/v1` | — |
| Server | `uvicorn` (omlx) | `curl -s -i http://127.0.0.1:8873/v1/models \| grep -i '^server:'` → `server: uvicorn` |
| Model under test | `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` | see model list below |
| Context window | `262144` | `max_model_len` in the `/v1/models` body below |
| API key | none needed, **do not send one** | every command on this page omits `authorization` and every one returns 200 |
| `access-control-allow-origin` | `*` | see below |
| `access-control-allow-methods` | `DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT` | see below |
| `access-control-allow-headers` | reflects whatever is asked for — `content-type` alone, and `content-type, authorization` when asked | two preflights below |
| `access-control-max-age` | `600` | see below |
| `access-control-expose-headers` | absent | not present in any response captured here |

### The model list

```
$ curl -s -i 'http://127.0.0.1:8873/v1/models' -H 'Origin: https://kaush4l.github.io'
HTTP/1.1 200 OK
date: Tue, 01 Sep 2026 06:16:44 GMT
server: uvicorn
content-length: 592
content-type: application/json
access-control-allow-origin: *

{"object":"list","data":[
 {"id":"Qwen3.8-27B-MTPLX-bf16","object":"model","created":1788243404,"owned_by":"omlx","max_model_len":262144},
 {"id":"Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp","object":"model","created":1788243404,"owned_by":"omlx","max_model_len":262144},
 {"id":"gemma-4-12B-it-qat-mxfp8","object":"model","created":1788243404,"owned_by":"omlx","max_model_len":262144},
 {"id":"mlx-community--Qwen3.8-27B-8bit","object":"model","created":1788243404,"owned_by":"omlx","max_model_len":262144},
 {"id":"MarkItDown","object":"model","created":1788243404,"owned_by":"omlx","max_model_len":null}]}
```

Five models on one host. Everything on this page was measured against
`Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` and **nothing on this page has been run
against the other four**, which is the first entry in *What is not known*.

### The CORS header, and why it is the load-bearing fact

```
$ curl -s -i -X OPTIONS 'http://127.0.0.1:8873/v1/chat/completions' \
    -H 'Origin: https://kaush4l.github.io' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type'
HTTP/1.1 200 OK
access-control-allow-origin: *
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
access-control-max-age: 600
access-control-allow-headers: content-type
```

```
$ curl -s -i -X OPTIONS 'http://127.0.0.1:8873/v1/chat/completions' \
    -H 'Origin: https://kaush4l.github.io' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type, authorization'
HTTP/1.1 200 OK
access-control-allow-origin: *
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
access-control-max-age: 600
access-control-allow-headers: content-type, authorization
```

The `Origin` sent is the **deployed** origin, `https://kaush4l.github.io`, not
`localhost` — so this is not the permissive answer a same-origin page would get.
`access-control-allow-headers` reflects the request, so a page adding an
`authorization` header for a hosted provider passes preflight on the same code
path.

One sentence on why this matters more than a header usually does. Root
constraint **C2** in `CAPABILITIES.md` says a page has `fetch` but not
permission: it may read a response only from an origin that says so, on that
response — and that constraint is what `docs/CORS-PROBE.md` spends a whole table
demonstrating for search endpoints. **This endpoint says so.** It means the
static export at `kaush4l.github.io/ASKK/` can hold a real conversation with a
real 27B model with no proxy, no bridge, no localhost exception and nothing
installed — which is the only arrangement in which this architecture can be
tested as the thing it claims to be rather than as a demo with a server behind
it. `src/core/inference/OpenAICompatible.js` needs no change to reach it: the
class already omits the `authorization` header when `apiKey` is empty, and says
why at `:18-20`.

**Not verified:** nobody has actually loaded the static export in a browser and
made this call from it. Everything above is `curl` sending the deployed origin
by hand. The remaining browser-specific risks are mixed content (an `https://`
page may not `fetch` an `http://` URL — `127.0.0.1` is a
[secure context](https://w3c.github.io/webappsec-secure-contexts/) but is *not*
exempt from the mixed-content block in every engine) and a service worker in the
COI path intercepting the request. Both are `unverified`.

---

## What this model does to our contract

Ordered by damage. Each finding is one claim, the output that produced it, and
the file in `src/` it forces to change.

Everything in §1–§8 below was measured by the **measurement agent** using probe
scripts in the scratchpad `probe/` directory, against a prompt assembled by
importing this tree's own `ReActEngine` / `PromptTemplate` / `Toolbox` / `Tool`
— no prompt text was retyped. Findings 1, 2 and the `cached_tokens` result were
independently re-run by the author of this page and are pasted twice where they
differ in wording.

Two scope caveats that apply to all of it:

- `agents/main/agent.md` was edited on disk **during** the measurement (`tools:`
  went `[shell]` → `[shell, search, fetch]`). Every number is against the
  `[shell]` version plus a `mcp-disk` tool.
- `src/core/engine/ReActEngine.js` has moved since. It now carries a `Budget`
  (`src/core/engine/Budget.js`, `BUDGET_DEFAULTS = {steps: 24, tokens: 250_000,
  seconds: 600}` at `:55`) that did not exist when §6 was measured, and it is
  **currently a syntax error** — see the note at the end of this section.

### 1. The endpoint has a reasoning channel, and it collapses into `content` on truncation

**Claim.** `reasoning_content` is a separate field on `message` whenever the
think block closes. When `finish_reason == "length"` arrives *while still inside*
the think block, `reasoning_content` is absent and the raw reasoning is the whole
of `content`. There is never a `<think>` tag in `content` — the server strips the
tags and routes, or fails to route and dumps.

The briefing's headline result is this defect, not a model that cannot count to
two words. Re-run by the author at 06:16:

```
$ curl -s http://127.0.0.1:8873/v1/chat/completions -H 'content-type: application/json' \
   -d '{"model":"Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp",
        "messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":16}'
{"id":"chatcmpl-c33ccef7", … "choices":[{"index":0,"message":{"role":"assistant",
 "content":"User requests: \"Reply with exactly: OK\". Must output only OK."},
 "finish_reason":"length"}],
 "usage":{"prompt_tokens":57,"completion_tokens":16,"total_tokens":73,
 "input_tokens":57,"output_tokens":16,"prompt_tokens_details":{"cached_tokens":0},"total_time":1.2}}
```

The **same prompt** at `max_tokens: 4096`, seconds later:

```
$ curl -s http://127.0.0.1:8873/v1/chat/completions -H 'content-type: application/json' \
   -d '{"model":"Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp",
        "messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":4096}'
{"id":"chatcmpl-fd7e662c", … "choices":[{"index":0,"message":{"role":"assistant",
 "content":"OK","reasoning_content":"The user wants me to reply with exactly \"OK\"."},
 "finish_reason":"stop"}],
 "usage":{"prompt_tokens":57,"completion_tokens":15,"total_tokens":72, …
 "prompt_tokens_details":{"cached_tokens":0},"total_time":1.12}}
```

The measurement agent isolated the trigger with `probe/p1c-truncleak.sh` — one
long-reasoning question at three caps, three runs each:

```
--- max_tokens=40 run 1 ---   finish: length | completion_tokens: 40
has reasoning_content: False
content[:220]= 'We need answer user: "A train leaves at 14:37 travelling 87 km/h. A second leaves the same station 52 minutes later at 113 km'
--- max_tokens=120 run 2 ---  finish: length | completion_tokens: 120
has reasoning_content: False
content[:220]= "We need answer user's puzzle. Need compute clock time second catches first. Need only clock time. Let's solve carefully.\n\nTrain 1 leaves 14:37 speed 87 km/h..."
--- max_tokens=4096 run 1 --- finish: stop | completion_tokens: 357
has reasoning_content: True
content[:220]= '18:23'
```

`unverified` — "No third state was observed in ~60 calls." The **measurement
agent** asserts the sample size; no per-call log was pasted. The *rule* is
pasted three times over three caps; the count behind "never" is not.

**Forces a change in `src/core/inference/OpenAICompatible.js`.** `invoke` reads
`message.content` and nothing else:

```js
// src/core/inference/OpenAICompatible.js:33
const text = posted.value?.choices?.[0]?.message?.content
```

It must also read `choices[0].finish_reason`, and when that is `"length"` it must
not return `Outcome.ok(text)` as if a model had answered — today a 4096-token
reasoning dump is handed upward as the reply. `grep -rn finish_reason src/`
returns exactly one hit, a comment at `OpenAICompatible.js:69-70` saying finish
reason is *"bookkeeping the loop does not read."* That comment is now measurably
the bug.

### 2. `chat_template_kwargs: {"enable_thinking": false}` is the only switch that works

**Claim.** `enable_thinking: false` removes the reasoning channel entirely and
rewrites the chat template. `reasoning_effort` is accepted and inert.
`/no_think` in the prompt is worse than useless — it leaks into the answer.

Re-run by the author at 06:16:

```
$ curl -s http://127.0.0.1:8873/v1/chat/completions -H 'content-type: application/json' \
   -d '{"model":"Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp",
        "messages":[{"role":"user","content":"Reply with exactly: OK"}],
        "max_tokens":4096,"chat_template_kwargs":{"enable_thinking":false}}'
{"id":"chatcmpl-4474ab19", … "choices":[{"index":0,"message":{"role":"assistant","content":"OK"},
 "finish_reason":"stop"}],
 "usage":{"prompt_tokens":17,"completion_tokens":1,"total_tokens":18, …
 "prompt_tokens_details":{"cached_tokens":0},"total_time":0.33}}
```

`prompt_tokens` **57 → 17** for identical user text: the switch is rewriting the
template, not filtering the output. The measurement agent's `probe/p1b-nothink.sh`
covered the alternatives, 3 runs each:

```
--- C reasoning_effort:none run 1 ---
{…,"message":{"role":"assistant","content":"OK","reasoning_content":"The user wants me to reply with exactly \"OK\"."},…,"prompt_tokens":45,…}
--- F reasoning_effort:minimal / G reasoning_effort:high ---  reasoning_content STILL PRESENT, 3/3 each
--- E "/no_think" in the prompt ---
{"message":{"role":"assistant","content":"OK /no_think","reasoning_content":"The user wants me to reply with exactly \"OK /no_think\"..."}}   (3/3)
```

**Forces a change in `src/core/inference/Inference.js`.** There is no way to send
this. The constructor takes `model, baseUrl, apiKey, temperature, maxTokens,
timeout` (`:27-34`) and `OpenAICompatible` builds a fixed body (`:21-26`, `:53-63`).
A per-transport `extraBody` — merged into both `invoke` and `stream` — is the
smallest change that makes the one measured switch reachable.

### 3. Our own response contract truncates on the workload we are building for

**Claim, in two halves.** On a short single-tool turn the TOON contract holds.
On a critique-this-code-against-a-standard turn at `max_tokens: 4096` it hit the
cap 4 times out of 4, and 2 of those 4 dumped raw reasoning into `content`, which
`BaseResponse.parse` then handed to the user as the answer.

The compliant shape, which is exactly right when it works:

```
think: [Need the sandbox's /etc/os-release to identify distro version, use shell cat]

plan: [Run cat /etc/os-release in the sandbox]

act: tool

result: shell({"command": "cat /etc/os-release"})
```

`probe/p8-devtask.js`, real assembled prompt, default `max_tokens: 4096`:

```
########## thinking ON (default) ##########
run 1: finish=length completion=4096 reasoning_channel=true  LEAKED=false ownLines=true  act=tool   calls=[] ms=320389
run 2: finish=length completion=4096 reasoning_channel=false LEAKED=true  ownLines=false act=answer calls=[_parseLine,foo,call,bar,bar,ignored,foo,n,silently,foo,bar,...33 names] ms=285224
run 3: finish=length completion=4096 reasoning_channel=false LEAKED=true  ownLines=false act=answer calls=[_parseLine,brackets,foo,identifiers,match,bar,...59 names] ms=164838
run 4: finish=length completion=4096 reasoning_channel=true  LEAKED=false ownLines=false act=answer calls=[] ms=210068
SUMMARY thinking ON (default): leaked 2/4, four-fields-on-own-lines 1/4
```

Run 2's `content` opens, verbatim — note that it opens a markdown code fence of
its own, inside what our parser is being handed as a response:

````
Let me work through this carefully.

The function is:

```js
static _parseLine(line) {
  const pattern = /([A-Za-z_][\w-]*)\s*\(/g
  ...
````

With `enable_thinking:false` the failure moves and does not go away, because our
contract asks for the reasoning *in a parsed field*:

```
########## enable_thinking:false ##########
run 1: finish=stop   completion=2383 ownLines=true  act=tool calls=[shell] ms=74071
run 2: finish=stop   completion=474  ownLines=true  act=tool calls=[shell] ms=17066
run 3: finish=stop   completion=2018 ownLines=true  act=tool calls=[]      ms=54184
run 4: finish=length completion=4096 ownLines=false act=answer calls=[]    ms=105484
SUMMARY enable_thinking:false: four-fields-on-own-lines 3/4
```

Run 4 truncated **inside the `think:` list** and never reached `act` or `result`:

```
think: ["The user wants a critique of a JavaScript parsing function against the standard: 'a parser must never silently drop input it cannot read...'","The function is `_parseLine(line)`...","Let me reason about every way this function can silently drop input.","1) The regex only matches identifiers that start with a letter or underscore...
```

**Forces changes in `src/core/response/ReActResponse.js` and
`src/core/response/BaseResponse.js`.**

- `ReActResponse.js:33-37` — `think`'s description was *"Take as many items as
  the problem deserves"*, an unbounded invitation inside a parsed field, and
  4096 is where it lands. The contract cut replaced that sentence; the field is
  still unbounded in the sense that matters — nothing counts the items.
- `BaseResponse.js:264` — `parse`'s catch-all, `return new this({
  [this.answerField()]: text.trim() })`, is what converts a 16 KB reasoning dump
  into `result`. It must be able to say *this did not parse*.
- `ReActResponse.js:99` — `isAnswer` is `!isToolCall`, so a turn that never
  reached `act` at all ends the run.

`unverified` — the sub-tally "**18/19** compliant on short tasks" (`probe/p2-contract.js`
6 samples + `probe/p2b-rate.js` 13). The **measurement agent** pasted one
compliant sample and the one failing sample; the other seventeen were counted,
not shown.

### 4. Comma-collapsed fields silently become a terminating answer

**Claim.** When the model writes all four fields on one line separated by commas,
`_parseToon` sees only `think` as a field start, swallows the rest into it, and a
perfectly good tool call becomes an answer with an empty `result`. Observed once
in 19 short-task samples and again in `probe/p7b-email.js` run 3.

The reply, verbatim:

```
think: [The user asks for the sandbox distro version from /etc/os-release. Use a focused shell command to read that file. The output will show PRETTY_NAME or VERSION.], plan: [Run cat /etc/os-release in the sandbox], act: tool, result: shell({"command": "cat /etc/os-release"})
```

**Forces a change in `src/core/response/BaseResponse.js`.** `_parseToon` is
line-anchored:

```js
// src/core/response/BaseResponse.js:361,368
static _parseToon(text) {
  …
  const at = line.indexOf(':')
```

One `indexOf` per line, so exactly one field start per line is findable. It needs
a second pass that splits `, field:` runs *within* a line. Downstream,
`ReActResponse.normalize`'s `else` branch (`:48-50`) then defaults `act` to
`answer`, which is where the tool call dies.

### 5. The tool-call scanner has two defects, and both are silent total loss

**Claim A — an unescaped quote discards the whole line.** `probe/p3-callsyntax.js`
asked for a `note({"text": …})` whose argument contains both a parenthesis and an
escaped quote. **4 of 9 samples were valid.** The 5 failures are always the same:
the model escapes the *first* inner quote and not the second.

```
=== RUN 1 === note({"text": "She shouted \"stop (right now)!" and left."})
--- Toolbox.parse --- []
=== RUN 2 === note({"text": "She shouted \"stop (right now)!\" and left."})
--- Toolbox.parse --- [[{"name":"note","argText":"{\"text\": \"She shouted \\\"stop (right now)!\\\" and left.\"}",...}]]
--- JSON.parse(argText): true ; text matches wanted: EXACT
=== RUN 3 === note({"text": "She shouted \"stop (right now)!" and left."})   -> []
=== RUN 4 === note({"text": "She shouted \"stop (right now)!" and left."})   -> []
=== RUN 5 === (correct)
[second batch] RUN 1 correct · RUN 2 [] · RUN 3 [] · RUN 4 correct (used " escapes)
```

`probe/p3b-consequence.js` runs the model's literal output through the real
module and shows what the agent is then told:

```
MODEL LITERAL: note({"text": "She shouted \"stop (right now)!" and left."})
Toolbox.parse -> []
Toolbox.run   -> {"observation":"no tool call was found in that result. Write the call itself, like tool_name({\"key\": \"value\"}), or set act to answer.","count":0}
```

That observation is **false**. There was a call; the scanner could not read it.

**Claim B — any English word before a parenthesis parses as a tool call.**
`probe/p3c-prose.js`, on prose the model actually wrote in `probe/p7-missing-tool.js` run 3:

```
LINE: I can't search the web from here (no web tool/network in the sandbox), so I don't know the newest release.
Toolbox.parse -> [[{"name":"here","argText":"no web tool/network in the sandbox","raw":"here (no web tool/network in the sandbox)"}]]
```

The 33- and 59-name call lists in §3's `p8` output — `foo`, `bar`, `silently`,
`ignored`, `available`, `while`, `push` — are this same defect at scale.

**Forces changes in `src/core/tools/Toolbox.js`.**

```js
// src/core/tools/Toolbox.js:66
const pattern = /([A-Za-z_][\w-]*)\s*\(/g
…
// src/core/tools/Toolbox.js:92
if (end < 0) break
```

`:66` accepts any identifier; candidate names must be filtered against
`this.tools` before a call is accepted. `:92` `break`s out of the whole line on an
unbalanced bracket, **discarding every call already parsed on it**, and the agent
is then given `:147`'s "no tool call was found". Compare `:119`, which correctly
reports *"the arguments were not valid JSON"* when the brackets happen to balance
— that is the shape the unbalanced case needs too: report the unreadable span,
never claim there was nothing there.

Note that the model *can* escape correctly when the requirement is stated hard —
`probe/p6b-discipline.js` run 2 produced `shell({"command": "n=0; while IFS= read -r _ || [ -n \"$_\" ]; do n=$((n+1)); done < /etc/passwd; printf '%s\\n' \"$n\""})`.
So finding 5A is a prompting failure meeting a parser failure, not a capability
ceiling.

### 6. `normalize` repairs the one failure this model never commits

**Claim.** `ReActResponse.normalize`'s rescue — the call written into `act` — fired
**0 times in 19 short-task samples**, and none of the three failures this model
actually produces has a repair.

```js
// src/core/response/ReActResponse.js:45-47
if (this.act.includes('(') || this.act.includes('{')) {
  if (!String(this.result ?? '').trim()) this.result = this.act.trim()
  this.act = ACT_TOOL
```

The three unrepaired modes, all measured above: comma-collapsed fields (§4, which
`normalize` never even sees because `_parseToon` already lost them), `act: tool`
with an empty or unparseable `result` (§3, `p8` thinking-ON run 1), and a
truncated turn parsed as an answer (§3, §1).

`unverified` — the 0/19 count. The **measurement agent** reports the tally; the 19
per-sample parses were not pasted.

### 7. Streaming works exactly as `OpenAICompatible.stream` assumes

**Claim.** `delta.reasoning_content` is the field name our code already reads,
`stream_options.include_usage` is honoured and load-bearing, and the usage frame
carries three timing fields we currently discard.

`probe/p4-stream.sh`, full frame set, saved at `probe/raw-stream-1.txt`:

```
data: {"id":"chatcmpl-aa455f16","object":"chat.completion.chunk","created":0,"model":"keepalive","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}
data: {…,"choices":[{"index":0,"delta":{"role":"assistant"}}]}
data: {…,"choices":[{"index":0,"delta":{"reasoning_content":"\nUser asks: Reply"}}]}
data: {…,"choices":[{"index":0,"delta":{"reasoning_content":" with exactly: OK\n\nNeed"}}]}
data: {…,"choices":[{"index":0,"delta":{"reasoning_content":" final only OK."}}]}
data: {…,"choices":[{"index":0,"delta":{"content":"\n\nOK"}}]}
data: {…,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: {…,"choices":[],"usage":{"prompt_tokens":57,"completion_tokens":18,"total_tokens":75,"input_tokens":57,"output_tokens":18,"prompt_tokens_details":{"cached_tokens":0},"time_to_first_token":1.07,"total_time":1.44,"prompt_eval_duration":1.07,"generation_duration":0.36,"prompt_tokens_per_second":53.17,"generation_tokens_per_second":49.37}}
data: [DONE]
```

Four things confirmed as written: `OpenAICompatible.js:78` reads
`delta?.reasoning_content` — correct field name; `:62`'s `stream_options: {
include_usage: true }` is not decoration (**the measurement agent reports 0 usage
frames without it**; the negative run's output was not pasted, so that half is
`unverified`); `:71`'s optional chaining survives a usage frame whose `choices` is
`[]`; and a `model:"keepalive"` frame with empty content leads every stream, which
nothing downstream needs to special-case because the content is `""`.

**Forces a change in `src/core/inference/Inference.js`.** `_usage` (`:90-103`) keeps
four fields — `prompt`, `completion`, `cached`, `written` — and throws away
`time_to_first_token`, `prompt_eval_duration`, `generation_duration`,
`prompt_tokens_per_second` and `generation_tokens_per_second`. Those are the only
honest inputs to a cost model this project has, and they arrive free on every
streamed call.

### 8. The scratchpad shape makes no measurable difference on this model

**Claim.** Three ways of feeding a tool observation back — our `scratchpad` block,
the trace pushed into `# CONVERSATION` as `[ASSISTANT]:`/`[USER]:` (the shape
`ReActEngine.js:72-77` says it replaced), and real alternating wire roles — score
identically. Ours is cheaper and more honest, and that is the whole of its
advantage.

`probe/p6b-discipline.js` — a failed first call (`wc: not found`) plus a refused
repeat, where correct discipline is one **new, different** call:

```
##### A scratchpad block (ours) #####      prompt_tokens=1050
run 1 GOOD  shell({"command": "grep -c '' /etc/passwd"})
run 2 GOOD  shell({"command": "n=0; while IFS= read -r _ || [ -n \"$_\" ]; do n=$((n+1)); done < /etc/passwd; printf '%s\\n' \"$n\""})
run 3 GOOD  shell({"command": "awk 'END {print NR}' /etc/passwd"})
##### B trace in CONVERSATION block #####  prompt_tokens=1098   3/3 GOOD
##### C alternating wire roles #####       prompt_tokens=1100   3/3 GOOD
TALLY {"A scratchpad block (ours)":3,"B trace in CONVERSATION block":3,"C alternating wire roles":3}
```

**Forces no change.** The design argument at `ReActEngine.js:72-77` — that a ReAct
trace is a scratchpad and not a dialogue, and a model reading its own tool output
as something the user typed will answer the wrong participant — is **not
supported by a behavioural difference on this model**. It survives on the 48–50
tokens per step it saves and on not lying to the model, both of which are visible
above. That is a smaller claim than the comment makes, and the comment should say
so.

`unverified` — the companion probe `probe/p6-scratchpad.js` ("A 3/3, B 3/3, C 3/3,
prompt tokens 1020 / 1042 / 1040" on an ordinary step-2). The **measurement
agent** reported the tally with no output pasted.

### 9. On a missing tool it declines instead of inventing one

**Claim.** With a toolbox of `shell` and `disk`, asked to search the web and to
send an email, it never fabricated a call to a plausible-but-absent tool.

```
think: [The user asks for a web search, but no web tool is available and the sandbox has no network, so I cannot verify the current Alpine Linux release announcement.]
plan: [State plainly that I cannot answer from web sources in this environment.]
act: answer
result: I don't have web access in this environment, so I can't verify the newest Alpine Linux release announcement or its version number and date.
```

```
think: [No email tool is available in this environment.]
act: answer
result: I can't send the email from here because no email tool is available.
```

One sample probed rather than guessed, which is better behaviour than declining:

```
result: shell({"command": "for c in mail mailx sendmail curl wget; do command -v \"$c\" >/dev/null 2>&1 && echo \"$c: yes\" || echo \"$c: no\"; done"})
```

The one failure in this set is finding 1 again, not hallucination: it reasoned for
the full 4096 tokens, the reasoning landed in `content`, and `Toolbox.parse` mined
`knowledge` and `shell` out of that prose (finding 5B). It never *decided* to call
a tool it does not have.

**Forces no change.** `unverified` — the "6/6, no invented tool names" tally. The
**measurement agent** pasted three of six.

### The tree is broken while this was being written

`src/core/engine/ReActEngine.js:92` currently reads:

```js
      const running out = ''
```

```
$ bun -e 'await import("./src/core/engine/ReActEngine.js")'
92 |       const running out = ''
                         ^
error: Expected ";" but found "out"
    at /Users/kaush/Downloads/Dev/ASKK/src/core/engine/ReActEngine.js:92:21
```

This is a live syntax error on `main`'s working tree at the time of writing, it
is somebody else's in-flight edit, and it is the reason our side of the blind
comparison did not run. It is recorded here rather than fixed because this page
owns no source file.

---

## Speed and cost

Every row is one command. A cell that says `unverified` has no measurement behind
it and stays empty.

Command for the two prompt sizes, `probe/p5-cost.js`, 3 runs each, streamed with
`stream_options: {include_usage: true}`, filler is **this tree's own source**
(15 files from `src/core/` and `src/backend/`, chosen because a dev harness's
long prompts are code, not prose):

    bun probe/p5-cost.js

```
##### SHORT — estimateTokens=946 #####
run 1: wall=8.41s ttft=4.27s | prompt_tokens=950  completion=194 | prompt_tps=223.92 gen_tps=46.79 | cached_tokens=0
run 2: wall=7.24s ttft=4.37s | prompt_tokens=950  completion=125 | prompt_tps=218.14 gen_tps=43.50 | cached_tokens=0
run 3: wall=8.59s ttft=4.16s | prompt_tokens=950  completion=197 | prompt_tps=229.42 gen_tps=44.35 | cached_tokens=0

##### ~20k — estimateTokens=19576 #####
run 1: wall=75.60s ttft=65.57s | prompt_tokens=18879 completion=389 | prompt_tps=288.36 gen_tps=38.73 | cached_tokens=0
run 2: wall=77.87s ttft=64.96s | prompt_tokens=18879 completion=512 | prompt_tps=291.09 gen_tps=39.62 | cached_tokens=0
run 3: wall=93.50s ttft=65.36s | prompt_tokens=18879 completion=346 | prompt_tps=288.36 gen_tps=12.30 | cached_tokens=0
```

| Quantity | 950-token prompt | ~18,900-token prompt |
|---|---|---|
| Time to first token | **4.16 – 4.37 s** | **64.96 – 65.57 s** |
| Wall clock, whole call | **7.24 – 8.59 s** | **75.60 – 93.50 s** |
| Prefill rate | **218.14 – 229.42 tok/s** | **288.36 – 291.09 tok/s** |
| Generation rate | **43.50 – 46.79 tok/s** | **12.30 – 39.62 tok/s** |
| `prompt_tokens_details.cached_tokens` | **0**, 3/3 | **0**, 3/3 |

The ranges are kept rather than averaged because the variation is the finding.
Generation rate swung **3.2×** on identical input between run 2 and run 3 of the
same batch (39.62 → 12.30 tok/s). There is no honest single number for the
generation rate on this host, and any cost model that quotes one is quoting a
choice, not a measurement.

**Prefix caching does not exist here.** `cached_tokens` was `0` on every call in
every probe — short, long, streamed, non-streamed. Confirmed independently by the
author with two identical 57-token prompts seconds apart (§1 above: both report
`"prompt_tokens_details":{"cached_tokens":0}`). This **confirms** `ARCHITECTURE.md`'s
existing claim that the endpoint reports the field and always reports 0, and it
promotes that line from a theory note to a measured fact. `src/core/prompt/PromptTemplate.js`'s
prefix-ordering design (`Volatility` at `:20-27`, the argument at `:61-79`) buys
**exactly zero** on this testbed. Keep it — it is correct for providers that
cache — but no local optimisation may be justified by it.

**`estimateTokens` accuracy**, same command:

| Prompt | `estimateTokens` (`src/core/prompt/tokens.js:30`) | server `prompt_tokens` | error |
|---|---|---|---|
| the real assembled prompt (prose + contract) | 946 | 950 | **−0.4 %** |
| a code-heavy ~20k prompt | 19,576 | 18,879 | **+3.7 %** |

It runs about 4 % **hot** on source code, which is the direction a budget wants:
it over-charges the thing this harness will mostly send.

### What that arithmetic means for the loop

| Quantity | Value | Source |
|---|---|---|
| Default step budget | 24 | `src/core/engine/Budget.js:55` |
| Default seconds budget | 600 | `src/core/engine/Budget.js:55` |
| Prefill cost of one step at ~19k tokens | 64.96 – 65.57 s | table above |
| Steps of prefill the 600 s budget affords at that size | **~9** | 600 / 65 |
| Steps of prefill the 24-step budget would need | 24 × ~65 s ≈ **26 min** | derived |
| One `p8` dev-task call, end to end | **17.0 s – 320.4 s** | `probe/p8-devtask.js` output in §3 |

Two consequences. First, `Budget`'s three currencies are not interchangeable on
this endpoint: at the context size this harness is *for*, the seconds budget
binds at roughly nine steps and the step budget never binds at all. Second, a
critique-and-improve loop over a real 20k file costs **minutes per iteration**,
not seconds, and the loop must say so — `4 × 65 s` is 4.3 minutes before a single
answer token, and a UI that shows nothing during it is indistinguishable from a
hang.

| Not measured | Status |
|---|---|
| Speed of the other four models on this host | `unverified` |
| Cost or throughput of any hosted provider | `unverified` |
| Speed with `enable_thinking:false` at ~20k tokens | `unverified` |
| Whether `cached_tokens` stays 0 across a page reload or a server restart | `unverified` |
| Any figure in dollars | `unverified` — there is no billing on this endpoint |
| Speed from a browser rather than `curl`/`bun` | `unverified` |

---

## The blind comparison

### What it is

A rig that settles whether our agent scaffold beats a reference one by holding
**everything except the scaffold** constant, then stripping identity from the
transcripts so a judge cannot know which is which. The bar it serves is the one
in `docs/LEDGER.md`: *"the run ends when a blind critic, handed two unlabelled
transcripts — ours and agent-zero's on the same task — picks ours … without
knowing which is which."*

### Where it lives, and the warning

    /private/tmp/claude-501/-Users-kaush-Downloads-Dev-ASKK/
      c66f33f7-5253-4e64-a2fa-a163866b9b53/scratchpad/rig/

**This is a session scratchpad. It is not in the repository and it will not
survive.** Nothing was written into the working tree, by design. If the rig
matters — and the ledger's bar says it does — it has to be moved in as a slice of
its own, and that has not happened.

### The command

    cd <rig>
    bun run.js && bun blind.js

`bun run.js` writes `transcripts/<task>/<scaffold>/<n>.{md,json}`, `results.json`,
and prints the table. `bun blind.js` writes `blind/<task>/{A,B}.md` with identity
scrubbed plus `blind/key.json`, **which the judging step must not read**. Flags:
`--scaffold <name>`, `--task <name>`, `-n <runs>`.

Re-run by the author at 06:15 to confirm the scrub still passes:

```
$ bun blind.js
wrote 5 blinded transcripts to …/rig/blind
key written to …/rig/blind/key.json — the judging step must not read it
verified: no banned term survives in any emitted file
```

### Held constant

| | |
|---|---|
| model | `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` @ `http://127.0.0.1:8873/v1` |
| params | `temperature: 0`, `seed: 7`, `max_tokens: 1200`, request timeout 300 s |
| turn cap | 12, recorded as a `turn-cap` event and never thrown |
| tools | one implementation of `read_file`, `write_file`, `list_files`, `run` in `tools.js`; path-jailed to the run's temp dir, 30 s command timeout, 4000-char output clip |
| tasks | five, in `tasks.js`, each checked by inspecting the temp directory — **a check never asks a model anything** |
| reasoning | `reasoning_content` is read, recorded, and **stripped before parsing**, for both scaffolds |

### What varies

Only `scaffolds/*.js`: the system prompt, the tool contract, the parse, and how
an observation re-enters the context. `scaffolds/agent-zero.js` reassembles
agent-zero's real prompts from the clone at load time. `scaffolds/ours.js`
imports this repository's real `PromptTemplate`, `Engine.plan()`, `Tool`,
`Toolbox`, `ReActResponse`/`BaseResponse.parse`, `ReActEngine.observe`,
`AgentFile.parseAgentFile` + `AgentSpec.of` on `agents/main/agent.md`, and
`describeEnvironment`.

### Every thumb on the scale

Listed because a comparison whose compromises are hidden is not evidence. The
first ten are in the rig's exported `CUTS` array and are stamped into each
transcript.

**Against agent-zero (cuts to its shipped prompts):**

1. Tool list cut to `response`, `code_execution_tool`, `text_editor`. Dropped:
   `call_subordinate`, `a2a_chat`, `notify_user`, `parallel`, `scheduler`,
   `search_engine`, `skills`, `wait`, `input`, `memory`, `behaviour`, `browser`,
   `document_query`, `office_artifact`, `goal`, `vision_load`, and the three
   `*_remote` tools. None can exist on four capabilities.
2. `agent.system.main.environment.md` replaced wholesale. The shipped text says
   kali docker, `/a0`, `/opt/venv` — all false here. Leaving it in is sabotage,
   not faithfulness.
3. `solving.md`: cut the memories/skills line, six subordinate lines, two
   memorize lines, and the `if tool patch fails` line.
4. `tips.md`: cut the memory line, the whole `## Skills` section, the subordinate
   line, the whole `## Documents and OCR` section.
5. `communication.md` / `communication_additions.md` / `tools.md`: cut every
   reference to the `parallel` tool and the whole `§§` replacements section. Kept
   "dependent operations one at a time" — true here and free.
6. `code_exe.md`: cut `runtime=output`, `session`, `reset`, the `input` tool, and
   every polling/long-job rule and example. Kept terminal/python/nodejs, all
   three verified working.
7. `text_editor.md`: cut the whole `patch` action, `line_from`/`line_to`,
   `open_in_canvas`, the `office_artifact` cross-reference.
8. `response.md`: cut the one-line `response_tool_tips` include.
9. **Not a cut, recorded because it looks like one**: agent-zero gets no
   `list_files`. It has none; its listing path is `code_execution_tool` + `ls`,
   reaching the same shared `run`. Capability parity holds; only naming differs,
   and naming is the scaffold under test.
10. **Kept, in agent-zero's favour**: the `[EXTRAS]` block with the live workdir
    file tree on every turn (`settings.py:575` defaults `workdir_show` to True).
    Ours gets only a clock. That is a real advantage of agent-zero's design and it
    was left in.

**Against ours:**

11. Dropped the `mcp:` frontmatter block and the `tools: [shell]` list from
    `agents/main/agent.md` — no browser guest, no MCP transport in the rig. The
    file **body** is used verbatim.
12. Rewrote the `shell` tool description. `src/core/tools/ShellTool.js:24` says the
    filesystem is discarded between calls — true of the browser sandbox, false of
    the rig's temp dir. Leaving it would lose every multi-step task for a reason
    unrelated to scaffolding.
13. **Deliberately not cut**: `agents/main/agent.md`'s body still says "running
    entirely inside the user's browser" and "an emulator, roughly a hundred times
    slower". Softening our own real system text is precisely the thumb this rig
    exists to prevent.
14. Reimplemented the loop **sequencing** only — the driver owns the HTTP call and
    the cap, so `ReActEngine.run`'s own `while (true)` cannot be nested — and the
    four `Tool` subclasses, since this tree ships only `shell`. Both on the real
    `Tool` base class, so rendering is our code.

**Symmetric, in the shared driver:**

15. `reasoning_content` stripped before parsing, both scaffolds. Without this the
    endpoint's several-hundred-token preamble would be measured instead of the
    scaffold. **Note what this hides**: finding 1 above — reasoning collapsing
    into `content` on truncation — is exactly the failure this strip cannot see,
    because a truncated dump *is* `content`.
16. Output clipped at 4000 chars, commands killed at 30 s, identically.
17. A `scaffold.stopped()` hook so agent-zero's real 5-strike circuit breaker can
    end its own run. Ours has no such breaker. **That asymmetry is a finding, not
    a fix.**

**In `blind.js`:** header block, project names, all absolute paths, and the
non-English tool identifiers are scrubbed (`code_execution_tool`→`exec`,
`text_editor`→`edit`, `read_file`→`read_text`, `write_file`→`write_text`,
`list_files`→`list_dir`). `shell` is deliberately left — a common word, and
renaming it globally turned "the shell is /bin/sh" into "the exec is /bin/sh".
The response contracts themselves (`thoughts`/`headline`/`tool_name`/`tool_args`
vs `think`/`plan`/`act`/`result`) are **not** scrubbed: they are the variable
under test. Verification is a banned-term scan over every emitted line, and it
caught two real leaks during development — a machine name embedded in a
scratchpad path, and the `shell` mangling above.

### Results — agent-zero only

`bun run.js`, 1 run per task, config as above. From `rig/results.json`:

| task | pass | turns | stop | prompt tok | completion tok | total tok | wall |
|---|---|---|---|---|---|---|---|
| collatz — write, run, check output | **PASS** | 3 | answered | 7,321 | 1,064 | 8,385 | 108.0 s |
| median-bug — fix, prove with own test | **PASS** | 10 | answered | 34,651 | 3,033 | 37,684 | 532.8 s |
| pointer-chase — two dependent calls | **PASS** | 5 | answered | 12,435 | 788 | 13,223 | 203.6 s |
| no-such-capability — must decline | **FAIL** | 4 | answered | 9,592 | 638 | 10,230 | 168.9 s |
| slugify-module — module + test, multi-file | **PASS** | 7 | answered | 27,976 | 4,164 | 32,140 | 299.7 s |
| **total** | **4/5** | 29 | — | **91,975** | **9,687** | **101,662** | **1,313.2 s** |

No run hit the 12-turn cap, none tripped the misformat path, none tripped the
5-strike breaker: agent-zero's JSON contract held on all 29 model turns.

The one failure is real and instructive. Asked for **the user's phone** battery,
it ran `pmset -g batt`, got the **host laptop's** 100 %, wrote `100` to
`battery.txt`, and reported "The phone battery is at 100%". All three checks
failed — file fabricated, percentage stated, no refusal. Transcript:
`rig/transcripts/no-such-capability/agent-zero/1.md`.

`results.json` carries a `note` recording that task 5 was re-run separately after
the shell harness killed the first process mid-run; same driver, same config,
same fixtures.

### What has not run

**Our side.** `scaffolds/ours.js` does not import, because
`src/core/engine/ReActEngine.js:92` is a syntax error (see the end of the
previous section). Confirmed by the author at 06:15:

```
$ bun -e 'await import("./scaffolds/ours.js")'
92 |       const running out = ''
                         ^
error: Expected ";" but found "out"
    at /Users/kaush/Downloads/Dev/ASKK/src/core/engine/ReActEngine.js:92:21
```

`run.js` handles this as instructed — it prints `!! scaffold ours does not
import; it is skipped, not faked.` and continues. **No number was invented for
our side and agent-zero was not weakened to compensate.** `results.json` records
`"skipped": []` because the skip happened before any run was attempted.

The consequence for the blind step is total: `blind/<task>/` currently holds a
single file each — `B.md`, `B.md`, `A.md`, `A.md`, `A.md` — one unlabelled
transcript per task with nothing to compare it to. **There is no comparison
yet.** What exists is one column, a scrubber that has been proven to scrub, and a
rig that will produce the second column with no change other than repairing that
line.

`unverified` — "`scaffolds/ours.js` imported and ran correctly when I built it: I
exercised `parse` → `act` → `observe` end to end." The **rig agent** claims this
and pasted no transcript, and it cannot be re-checked now because the tree does
not compile. Treat our scaffold as **untested** until `bun run.js --scaffold ours`
produces output.

### The contradiction between the two reports, and which I believe

The **measurement agent** measured our contract truncating **4 of 4** times at
`max_tokens: 4096` on a critique task. The **rig agent** measured agent-zero's
contract holding on **29 of 29** turns at `max_tokens: 1200` — a *tighter* cap on
the same model and endpoint.

I believe both, because they did not measure the same thing, and I will not
resolve it by preferring one. Three confounds separate them, and none has been
controlled: the tasks differ (a code-critique-against-a-standard turn versus
write-and-run-this); the temperature differs (0.7 versus 0); and, most
importantly, the rig **strips `reasoning_content` before parsing** (thumb 15),
which is precisely the channel finding 1 says collapses into `content` on
truncation. A scaffold measured with that strip in place cannot exhibit finding 1.

The one hypothesis worth testing, stated as a hypothesis: our `think` field's
instruction *"Take as many items as the problem deserves"*
(`src/core/response/ReActResponse.js:12`) is an unbounded invitation and
agent-zero's `thoughts` array is not, so the same model spends its budget
differently under the two contracts. **Nothing has measured that.** The test is
one run of the rig with both columns and a bounded `think` as a third arm.

---

## What is not known

- Nobody has made this call from a browser. Every result on this page came from `curl` or `bun` on the host.
- Whether an `https://` static export can `fetch` an `http://127.0.0.1` endpoint at all, in any engine, under the mixed-content rule.
- Whether the COI service worker in `CAPABILITIES.md` §C1 leaves this request intact once it is on the correctness path.
- How our own scaffold performs on any task, against any scaffold. The rig has one column.
- Whether our contract's truncation (4/4) or agent-zero's compliance (29/29) survives when task, temperature and the reasoning-strip are held constant.
- The other four models on this host — `Qwen3.8-27B-MTPLX-bf16`, `gemma-4-12B-it-qat-mxfp8`, `mlx-community--Qwen3.8-27B-8bit`, `MarkItDown` — have not been measured on anything.
- Whether any of this transfers to a hosted provider. `AnthropicCompatible` was not exercised once.
- Whether `enable_thinking:false` changes speed, tool discipline, or the escaping failure in §5. Only its output shape and prompt-token cost were measured.
- Whether `cached_tokens` is 0 because omlx has no prefix cache or because it does not report one.
- Whether a `max_tokens` above 4096 stops the truncation in §3 or merely moves it — no cap above 4096 was tried on a dev task.
- What the 5/9 escaping failure rate in §5 becomes with a repaired parser, since no repaired parser exists to measure.
- Whether the rig's 12-turn cap, 4000-char clip and 30 s command timeout are generous or binding for our scaffold — they were never reached by agent-zero, and ours has not run.
- What a judge actually picks. The blind step has never been executed with two columns.
- Every number here is one host on one afternoon. None of it has been re-run on a second machine.
