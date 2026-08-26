# Port map — Python → vanilla JavaScript

Source of truth for the port: `/Users/kaush/PycharmProjects/PythonProject1`.
Read `docs/PHILOSOPHY.md` first; this file says where each Python thing lands
and what changes, with the reason.

**The oracle.** `tests/golden/` holds four files copied byte-for-byte out of the
Python tree. `render-bare.prompt`, `render-full.prompt` and
`render-plain-text.prompt` are what `Agent.render()` must produce, character for
character. `react-loop.json` is the answer and the history the react loop must
leave behind. A port that does not reproduce these has not been done.

---

## 1. File map

| Python | JavaScript | Notes |
|---|---|---|
| `core/components.py` | `core/components.js` | + `core/template.js` (the mini template renderer) |
| `core/assembler.py` | `core/assembler.js` | straight port |
| `core/responses.py` | `core/responses.js` + `response-base.js` + `response-parse.js` + `response-react.js` | pydantic field table → declared `FIELDS` array (R1) |
| `core/tools.py` | `core/tools.js` + `core/tool-*.js` | dispatch by registry, not by `isinstance` (R6) |
| `core/inference.py` | `core/inference.js` + `inference-base.js` + `inference-http.js` | SDK + httpx → `fetch` (R4); `ClaudeCLI` → host-only (R5) |
| `core/memory.py` | `core/memory.js` | threads+locks → a serialized async write queue (R3) |
| `core/session.py` | `core/session.js` | straight port |
| `core/phases.py` | `core/phases.js` + `core/flows.js` | edges become a declared table (R2) |
| `core/agent.py` | `core/agent.js` | straight port |
| `core/skills.py` | `core/skills.js` | `Path` → the `fs` port |
| `core/space.py` | `core/space.js` | threading.Lock → an async mutex on one owner |
| `core/state.py` | `core/state.js` | straight port; no lock needed on one JS thread |
| `core/registry.py` | `core/registry.js` | thread-per-agent → **worker-per-agent** (R3) |
| `core/utils.py` | `core/agentfile.js` | + `core/frontmatter.js` (YAML subset, R7) |
| `core/cron.py` | `core/schedule.js` | crontab file → the `cron` port (R8) |
| `models.json` | `agents/models.json` | seeded into OPFS on first boot |
| `main.py` | `app/` | the REPL becomes the page |
| `test_core.py` | `tests/*.test.js` | ported check for check, run by `bun test` |
| — | `core/ports.js` | S9: `fs`, `clock`, `fetch`, `spawnWorker`, `cron` (R9) |

---

## 2. Rulings

Each ruling is a place where the Python cannot be transliterated. Every one
states what is kept, what changes, and why.

### R1 — pydantic → a declared `FIELDS` table

`responses.py` is the purest pillar precisely because the field set *is* the
contract: `model_fields` gives order, `description=` gives the instruction,
`list[str]` gives the bracket syntax, `model_validator` gives the coercion.
JavaScript has none of that reflection, so the table is written out:

```js
class ReActResponse extends BaseResponse {
  static FIELDS = [
    { name: "think",  list: true,  default: () => [], description: "..." },
    { name: "plan",   list: true,  default: () => [], description: "..." },
    { name: "act",    default: "answer",              description: "..." },
    { name: "result", default: "",                    description: "..." },
  ]
  static ANSWER_FIELD = ""            // empty = the last declared field
  static normalize(data) { ... }      // the model_validator, by another name
}
```

Nothing else configures a response. **The order of `FIELDS` is the order in the
prompt** — it is load-bearing, and `render-bare.prompt` proves it. Descriptions
must be copied character for character from the Python.

`Component` gets the same treatment for the same reason: a static `FIELDS` list
naming the fields, so `templateData()` and `key()` can walk them in a defined
order. `key()` hashes a stable JSON serialization of those fields in declaration
order — a JS object's key order is not something to rely on across a rebuild.

### R2 — the phase graph gets a declared edge table

The Python architecture doc names this its **top finding (F-1)**: the graph's
edges are bare string literals returned from eight method bodies, `flow` is a
two-valued string with no third value expressible from config, the entry point
is hardcoded, and the routing predicates are Python.

The port keeps the **behaviour exactly** — same phases, same edges, same
predicates, same caps — and moves the edge set into `core/flows.js` as data:

```js
export const FLOWS = {
  react: { entry: "react", edges: { react: { done: null } } },
  full: {
    entry: "understand",
    edges: {
      understand:    { simple: "react", complex: "select_skills" },
      select_skills: { done: "plan" },
      plan:          { done: "work" },
      work:          { done: "verify" },
      verify:        { pass: "critique", retry: "plan", exhausted: "respond" },
      critique:      { done: "respond", retry: "plan", exhausted: "respond" },
      respond:       { done: null },
      react:         { done: null },
    },
  },
}
```

`Phase.run(agent, session)` now returns an **outcome name**, not a phase name;
the flow table maps `(phase, outcome) -> next phase`. The flow is validated at
load: every outcome a phase can return has an edge, every named phase exists,
terminals are declared. A typo is a load error, not a silent stop 40 turns in.

`flow:` in agent.md is now any key of `FLOWS`, and a third flow is a config
change. The two shipped flows produce phase call orders identical to the Python
— the ported tests assert the exact sequences
`["understand","select","plan","work","work","verify","critique","respond"]` and
`["understand","react"]`.

Phase prompt text (`UNDERSTAND_PROMPT` … `CRITIQUE_PROMPT`) stays module
constants in this increment, copied character for character. Making it
configurable is F-1's sixth constraint and is **out of scope** — it changes the
prompt bytes, and the bytes are the oracle.

### R3 — thread-per-agent → worker-per-agent

`registry.py` starts one thread with its own event loop per agent, because an
agent's resources belong to the loop that created them, and marshals calls with
`run_coroutine_threadsafe`. The browser's equivalent of "its own loop" is a
**Web Worker**. The two classes survive with their jobs intact:

| Python | JavaScript | Job |
|---|---|---|
| `AgentThread` | `AgentWorker` | owns the worker; `run(msg)` is a correlated `postMessage` round-trip |
| `ThreadedAgent` | `WorkerAgent` | pins an agent to its worker; exposes `name`, `description`, `invoke`, `messages` — the duck type that makes a sub-agent a tool with no adapter |

Keep: built-ins resolved before project agents so a same-named project agent
**replaces** rather than doubles; sub-agents wired only after every worker is up,
so two agents may name each other; the summarizer distributed to everyone as
`agent.summarizer` and not as a tool; verifier and critic distributed the same
way; the main agent owning every peer so closing it closes them all; `STATE`
updated by the registry because it is the only place that sees a turn begin and
end.

`Transcript`'s write lock exists because two appends on two threads race and the
reply lands before the question. A worker has one JS thread, so the port is a
**serialized async write queue** — a promise chain each write appends to — which
is the same guarantee by the mechanism the platform gives.

`messages` must be a live view, not a copy: `memory.js` **rebinds** the array on
compaction, and the Python's `Agent.messages` still pointed at the old one
(finding F-4, a verified latent bug). Fix it here: `Agent.messages` is a getter
delegating to the transcript.

### R4 — the transports become `fetch`

`OpenAICompatible` used the `openai` SDK, `AnthropicCompatible` used `httpx`.
Both become plain `fetch` against the same endpoints with the same request
bodies — two fewer dependencies and the same wire.

`/v1/chat/completions` and `/v1/responses` are both still selected by the `api`
field, exactly as before. Multimodal content assembly is unchanged: the same
`image_url` / `input_audio` / `video_url` parts, the same Anthropic
`source: {type: "base64"|"url"}` shapes.

A browser adds one constraint the Python never had: **the model server must send
CORS headers**, or the page cannot reach it. That is a fact about the
deployment, not a thing the code can fix; the UI says so plainly when a request
fails with a network error and no status.

`Multimodality._encode_file` reads a path off disk. In the browser that becomes
reading through the `fs` port; a path that is not in the workspace is skipped
with a warning, exactly as an unreadable file was.

### R5 — `ClaudeCLI` is host-only

It shells out to a binary. A static page has no subprocesses. The class is
ported to `core/inference-cli.js` using the `spawn` port (`Bun.spawn` on the
host), registered into `KINDS` **only when a spawner is present**. In the browser
build the `claude` kind is absent, and naming it in `models.json` is a load-time
error that says why. It is tested on the host.

Fix F-9 while porting: the binary default is `"claude"`, resolved through the
path, not a hardcoded absolute home directory.

### R6 — tool dispatch by registry, not by type inspection

`Toolbox.of` picks a constructor by `isinstance` → `hasattr(invoke, name)` →
`callable`, which the architecture doc names as the one place tools do not honour
the pattern. The port keeps the same three kinds and the same acceptance rules,
but expressed as an ordered list of `{ match, build }` entries, so a fourth kind
is an entry rather than an edit to an if-chain. Behaviour is unchanged: a `Tool`
passes through, anything with `invoke` + `name` becomes an agent tool, anything
callable becomes a function tool, `null` is skipped.

`Tool.fromFunction` reads the parameter names off the function signature in
Python. JavaScript cannot do that reliably, so a function tool declares its
shape: either `fn.usageArgs` / `fn.description` properties, or an explicit
`tool(name, description, usageArgs, fn)` helper. Reading argument names out of
`Function.prototype.toString` is banned — it breaks under any minifier, and this
project ships minified.

Tools take **one object argument**, matching the `name({...})` wire the model
writes. `parse_batches`, `ARG_ERROR` handling, per-batch `Promise.all`, and the
`on_results` callback are straight ports — including that the callback may not
throw.

### R7 — YAML frontmatter, hand-rolled

Agent files and skill files are `---` YAML `---` markdown. Bun's runtime may
offer a YAML parser, but **the browser does not**, and this core must run in
both. So `core/frontmatter.js` parses the subset the format actually uses:

- scalars: `key: value`, quoted or bare
- inline lists: `key: [a, b]`
- block lists: `key:` then `  - a`, including at the parent key's own indentation
- nested maps, recursing on indentation — the chrome agent's `config:` block is
  three levels deep (`config` → `mcpServers` → the server name → its fields), so
  a fixed depth would have been wrong. The parser recurses, which is both
  shorter and correct.
- `#` comments, blank lines, `true`/`false`/numbers

Anything outside the subset is a parse error naming the line. It is not a YAML
implementation and must never grow into one. `parse_agent_file`'s error
behaviour is kept exactly: no leading `---` and no closing `---` are both errors
with the same messages, because a silently empty config surfaces later as a
confusing bad model call.

### R8 — cron → the `cron` port

`cron.py`'s substance is not the crontab binary, it is the **rules**: a name is
letters/digits/dashes/underscores; a schedule is five fields or one of eight
`@shortcuts`; a goal is required and one line; nothing may contain the marker,
because a newline would forge a second entry and the marker would forge
ownership; a line without the marker belongs to somebody else and is read,
copied through untouched and never matched by a delete; and a read that fails
for any reason other than "no crontab" means **nothing is written at all**,
because rewriting a file we could not see is how other people's jobs disappear.

All of that ports verbatim into `core/schedule.js` against a `cron` port with
two adapters:

- **host** — the real `crontab` binary, via the spawn port, generating the same
  launch line.
- **browser** — a `schedule.json` in OPFS plus a ticker that wakes the agent on
  the goal when the page is open. Jobs missed while the page was closed are
  reported as missed, never silently replayed.

The four tool functions keep their names, their signatures and their exact
return strings, because those strings are what the model reads.

### R9 — `core/ports.js`

The core is pure: no DOM, no network, no ambient clock, no ambient randomness.
Everything environmental is handed in at construction — the same principle the
whole architecture rests on, applied to the environment.

```js
{ fs, clock, fetch, spawnWorker, spawn, cron, random }
```

- `fs` — `read`, `write`, `list`, `remove`, `replace` (atomic), rooted at a
  workspace. Adapters: OPFS (browser), `node:fs` via Bun (host), in-memory
  (tests). `replace` is the atomic temp-then-rename the Python relies on for the
  log and for `space.json`.
- `clock` — `now()`. Tests freeze it; `ContextBlock` is the only caller that
  matters, and freezing it is how the golden prompts stay stable.
- `fetch` — the transports' only way out.
- `spawnWorker` — the registry's only way to make an agent.
- `spawn` — host only; `undefined` in the browser, which is what removes the
  `claude` kind.
- `cron` — R8.
- `random` — nothing in the port needs it yet. Do not add it until something
  does.

---

## 3. Surfaces with no browser counterpart

Kept honest rather than faked:

| Python surface | Why it has no browser form |
|---|---|
| `ClaudeCLI` | no subprocesses on a page. Host-only; see R5. |
| MCP over stdio | the same reason. MCP over HTTP/SSE works and is what the browser build wires; a stdio server needs a host bridge, which this build does not ship. |
| real `crontab` | a page cannot install a system job. See R8 — the rules port, the backing store does not. |
| `agents/<name>/tools.py` | a page cannot import and execute a Python module. Agent-owned tools become `agents/<name>/tools.js` ES modules loaded through the fs port. |

---

## 4. Findings carried over

Fixed by this port, because the fix is in the port: **F-1** (R2), **F-2**
(`getComponent` is what `baseComponents` calls — the registry is the only
authority), **F-3** (every component registers in `components.js`; no import
side effects), **F-4** (R3, `messages` is a getter), **F-6** partly (the tool
protocol stays text; the registry in R6 is what would let a native path in),
**F-9** (R5).

Left standing, documented, out of scope: **F-5** (Agent mixes config and
runtime), **F-7** (no retries, no streaming, no token accounting; compaction
still triggers on message count), **F-8** (the repeat guard keys on the whole
batch string), **F-10** (`consult` builds a throwaway reviewer per call).

Do not fix these opportunistically. Each changes behaviour the ported tests
pin, and each is its own increment.
