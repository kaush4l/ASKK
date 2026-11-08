# Tools: the standard

A **tool** is something a loop's model (or the owner) can call: one async function with a spec. Tools
are not objects; a `tools` element lists which ones an engine's loop may call, and the current phase
narrows that list (`offered = tools.list ∩ phase.tools`, contract.md). Code: `core/src/tools.rs`
(trait, registry, built-ins), `core/src/toon.rs` (reply format), `core/src/run.rs` (the loop).

## 1. The spec

| field | meaning |
|---|---|
| `name` | `<ns>.<verb>`: `clock.wait`, `files.read`, `web.fetch` |
| `description` | one line, shown in the prompt and the tools card |
| `args` | a compact schema: field → type (`string int number bool object list`), `?` when optional, one-line doc each. Rendered `{text: string, note?: string}` |
| `returns` | the result's shape, e.g. `{unix: int}` |
| `mode` | `quick` (returns at once) or `long` (may run a while). The loop never blocks on either; `long` is marked `[long]` in the prompt so the model knows to `await: none` and carry on |
| `timeout_ms` | the call is aborted after this → status `timed_out` (defaults: quick 10 s, long 120 s) |
| `effects` | any of `read write net exec`: shown to the owner (tools card), used later by phases and the sandbox |
| `by` | `model`, `owner` or `both`: who may call (translation.md §2.4 `Action.by`). Only `model`/`both` tools are offered to a model |

```rust
pub trait Tool: Send + Sync {
    fn spec(&self) -> &ToolSpec;
    fn run(&self, ctx: ToolCtx, args: Value) -> ToolFuture; // Result<Value>
}
pub struct ToolCtx { pub hub: Hub, pub engine: String, pub loop_id: String, pub call: String }
```

`ToolSpec::new(name, description).arg(Arg::new(..)).arg(Arg::opt(..)).returns(..).long().timeout(ms).effects(&[..]).by(..)`
builds a spec; `FnTool { spec, run: fn }` wraps a plain function (how the built-ins are written).

### Built-ins

| tool | args | returns | mode | effects | by |
|---|---|---|---|---|---|
| `note.write` | `{text: string, note?: string, append?: bool}` | `{written: id}` | quick | write | both |
| `clock.now` | `{}` | `{unix: int}` | quick | — | model |
| `clock.wait` | `{ms: int}` (≤ 5000) | `{waited_ms: int}` | long (timeout 6 s) | — | model |
| `help.ask` | `{question: string}` | `{asked, at, to}` | quick | write | model |
| `files.read` | `{path: string}` (inside `data/workspace/<engine>/`, ≤ 20000 chars) | `{path, text, clipped}` | quick | read | model |

## 2. Where tools come from

1. **Built-ins**, registered in Rust (`tools::builtins`).
2. **Rust tools added by the host**: `hub.add_tool(Arc<dyn Tool>)` (mirrors `hub.add_connector`); the
   server may add more at startup. Adding a name that exists replaces it. `hub.tool(name)`,
   `hub.tool_specs()` read it. The registry is process-wide (one app per process) so the pure
   prompt/view functions (`run::offered`, `run::render`, the tools kind) can read it without a Hub.
3. **Declarative tool files** (planned, not implemented): `<engines>/tools/<name>.md`, frontmatter is
   the spec plus how to run it; the body is the long doc.

   ```yaml
   ---
   name: web.fetch
   description: fetch a URL and return its text
   args: {url: "string — absolute http(s) URL", max_chars?: "int — clip, default 20000"}
   returns: "{status: int, text: string}"
   mode: long
   timeout_ms: 30000
   effects: [net]
   by: model
   # one of:
   http: {method: GET, url: "{url}"}
   command: ["curl", "-sL", "{url}"]   # runs under sandbox/run.sh `job`
   ---
   ```

   A `command` tool always runs through the sandbox (`sandbox/run.sh job …`), never directly; `{arg}`
   placeholders are substituted as single argv items (never through a shell). Secrets come from
   environment variables named in the file, never from state or prompts.

## 3. Calls: ids, states, messages

- Each call has an id unique in one loop run: the model's own (`c1`, `fetch-2`: a letter, then letters,
  digits, `_`, `-`) or, when it gives none, the next free `c<n>`. Reusing an id in a run is refused with a
  `format` note (the call is not started).
- States: `running → ok | failed | cancelled | timed_out`.
- Every call of the run is in `loop.state.calls: {c1: {tool, args, status, started, ended?}}` (`started`/`ended`
  in ms); running ones are in the prompt's RUNNING section (`c2 web.fetch running 3.2s`).
- When it ends, it becomes a message in `loop.state.messages`:
  `{role: "tool", call, tool, args, ok, status, text, at, ms}` (`ok` = `status == "ok"`; `text` is the
  JSON result or the error).
- A call that cannot start (tool not offered, id reused, over `max_running`) is a `failed` message at once.
- Per loop, at most `max_running` (loop config, default 8) calls run at once; the extra ones fail with
  `not started: N calls are already running (max_running N)`.
- States also include `interrupted`: the app stopped (shutdown) or died (crash) while the call ran.
- When the run ends (`max_steps`, cancel, engine stop), running calls are aborted and recorded `cancelled`.

### The lifecycle: the engine never waits on tools

1. **A step** is a task: render → model call → parse → cancel / start the calls (each recorded `running` in
   `state.calls`, then spawned) → record `state.waiting = {on: "all" | "any" | "none" | [ids], ids: [the awaited
   set], since}` → the loop turns `waiting` and **the task ends**. `hub.running()` does not list a waiting loop.
   Its now-line says `step 2 · waiting on c1, c2` (`waiting on any of …`, `answer pending · waiting on …`).
2. **A call** is a detached task owned by the Hub, keyed by (loop id, call id) so cancel / stop / shutdown
   abort it. It runs within `timeout_ms`, then under the loop's writer records its message and status (unless it
   was cancelled meanwhile), and calls the callback `hub.wake(loop)`.
3. **`wake`** (under the loop's writer): if a step task is running, the wake is held and delivered when that task
   ends; else, if the loop is `waiting` and its condition holds (`all`/ids: none of the set running; `any`: one
   of the set done; `none`: at once), the next step starts. Exactly one step runs per loop at a time, so two
   calls finishing together give one next step.
4. A step ends with a wake of its own, so `await: none` (and calls that finished during the step) take the
   next step at once. A held answer (`pending_answer`) is finalized by the wake that sees no call running — the
   last completion — without another model step.
5. **Restart**: on boot, calls recorded `running` become `interrupted` (failed messages); a loop that was waiting
   is `waiting` again and is woken once (`hub.resume()`, after the connectors are added) so its model sees the
   failures. **Shutdown** aborts call tasks and records them `interrupted`; the loop ends `stopped`.
6. **Owner events wake at once** (docs/async-cases.md): input to a running/waiting loop is recorded and the next
   step comes now (calls keep running; a held answer is recorded `superseded`); a phase change (`set`/`next`)
   wakes a waiting loop, which renders the new phase. A call started in another phase finishes and its message
   carries `phase: <old>` (`[tool c1 x ok (started in phase a)]`). A result for a call no longer in the run is
   recorded with `late: true` and wakes nothing.

## 4. The reply format

TOON by default, JSON as the fallback (toon.rs header):

```
thought: <one line>
calls[N]{id,tool,args}:
  c1,web.fetch,{"url":"…"}
  c2,clock.now,{}
await: all | any | none | c1,c3
cancel: c2
answer: <text>
```

- `calls[N]` starts the N calls at once, in parallel. `calls[N]{tool,args}:` (or `calls[N]:`) without ids
  is still accepted (ids assigned). `calls[0]` is allowed. The row count must equal N.
- `await` (default `all`) says when the next step comes:
  - `all` — when every call of this reply has finished;
  - `any` — as soon as one of them has;
  - `none` — right away; the calls keep running;
  - `c1,c3` — when those have (ids not running are ignored).
  With no calls in the reply, `all`/`any` refer to every running call (so `calls[0]` + `await: any`
  means "wake me when something finishes").
  So the model can start a long tool and, while it works, call the next ones.
- Results arrive as tool messages as they finish; a step is taken as soon as the await condition is met.
  Results that arrived meanwhile (e.g. during a model call) are in the next prompt.
- `cancel: c2, c4` aborts those running calls → `cancelled` messages. Cancelling an id that is not
  running adds a `format` note.
- `answer:` (the last field; it runs to the end of the reply). **Rule:** the answer ends the run once no
  call is running. If calls are running (including ones started in the same reply), the answer is held
  as `loop.state.pending_answer` (shown "answer pending"); no task waits: each completion is recorded as it comes, and the last one's callback
  ends the run with that answer — without another model step. To end at once, cancel them in
  the same reply.
- A reply needs at least one of `calls`, `await`, `cancel`, `answer`; otherwise it is a `format` message
  and the loop steps again (each step counts toward `max_steps`).
- JSON fallback: `{"thought", "calls": [{"id"?, "tool", "args"}], "await", "cancel", "answer"}` — `await` a
  string or a list of ids, `cancel` a list or a comma-separated string; bare or in a ``` fence.

## 5. The prompt template

Defined once, `run::SECTIONS`:
`ENGINE, PHASE, TOOLS, RUNNING, MEMORY, NOTES, HISTORY, INPUT, REPLY FORMAT`. Empty sections are left out
(TOOLS always shows, `No tools.` when none). TOOLS is generated from the offered specs, one line each:

```
- clock.wait {ms: int} [long]: wait some milliseconds (ms: at most 5000) → {waited_ms: int}
```

REPLY FORMAT is generated by `toon::format_help` from §4 (without tools it never mentions calls).
HISTORY shows tool messages as `[tool c2 clock.now ok] {"unix":…}`.

## 6. Callbacks and workflows

The step/wait/wake shape is general: an object that waits records **a set of calls + a wait condition**, and
whatever finishes calls `hub.wake(id)`. `Hub::wake` dispatches on the waiting object's kind (`Kind::wake`,
returning a `WakeFn`); the loop's handler is `run::wake` (take the next model step). A workflow step is the same
thing — a set of calls (tools, or loop runs) and a condition — and a workflow element (later) registers its own
wake handler that advances to its next step instead of calling a model. Only the loop's handler exists today.
