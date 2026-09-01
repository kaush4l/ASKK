# ASKK — architecture

A personal agent that runs entirely in the browser. Statically hosted, no server,
no build-time secrets. The user's data stays on the user's machine.

This is a **full-stack application with no backend server**. The backend is real —
domain model, use cases, repositories, persistence, a request/response boundary —
it simply runs in a Web Worker instead of on a host.

## Realms

    ┌─ page realm ────────────────┐        ┌─ worker realm ──────────────┐
    │  app/      React components │        │  backend/  Kernel           │
    │  client/   BackendClient    │ ─────► │            services/        │
    │                             │ postMsg│            repositories/    │
    └─────────────┬───────────────┘ ◄───── └──────┬──────────────────────┘
                  │                                │
                  └──────► protocol/ ◄─────────────┘        IndexedDB
                        (the only shared code)

The boundary is enforced by the realm, not by convention. A component cannot
import a service and quietly bypass the protocol — the import would fail at
runtime, because that code is not in the page's realm.

Which is a claim about the boundary, not about the checks. A file can compile
for a realm it cannot run in, and for a long time nothing here executed a realm
to find out. `docs/GATE.md` measures exactly which of those faults each step of
`bun run check` catches, and names the two worker realms it still does not
reach.

## Layers, innermost first

| Layer | Depends on | Rule |
|---|---|---|
| `core/` | nothing | The agent kernel: domain, inference, response, engine. **Realm-agnostic, not side-effect free** — `fetch` is allowed because it exists in both realms; DOM and storage are not. |
| `protocol/` | nothing | The wire contract. Must survive structured-clone. Imported by both realms, so it may use no API exclusive to either. |
| `backend/repositories/` | `core` | `Repository` is the port; `IndexedDbRepository` and `MemoryRepository` implement it. Stores plain records — structured-clone drops prototypes. |
| `backend/services/` | `core`, `protocol`, port | Use cases. Load → enforce → save. Knows nothing about transports. |
| `backend/Kernel.js` | `protocol` | Routes `namespace.method` and converts thrown values to typed failures, uniformly. |
| `client/` | `protocol` | Turns postMessage broadcast into awaitable calls by correlating reply ids. |
| `app/` | `client` | React. Never imports `backend/` or `core/`. |

Dependencies point inward only. `core/` names nothing outside itself.

## The agent kernel — `core/`

    core/
      Entity · Message · Conversation      domain, invariants owned here
      inference/   Inference (abstract)    invoke(prompt, mm) -> text · stream(..., onDelta)
                   ├─ OpenAICompatible     /v1/chat/completions — omlx, LM Studio, vLLM, OpenAI
                   ├─ AnthropicCompatible  /v1/messages
                   └─ TransformersInference in-tab wasm, no endpoint, no key
                   Multimodality           image / audio / video as data or remote URLs
      response/    BaseResponse            fields -> instructions, object <-> text
                   ├─ SimpleResponse       thinking, response
                   └─ ReActResponse        think, plan, act, result
      engine/      Engine (abstract)       params, render, one step
                   └─ ReActEngine          think -> act -> observe -> answer

There is no provider table. Every OpenAI-compatible server is `OpenAICompatible`
and differs only by `baseUrl`, so a new server is a setting, not a subclass.

**A response class is its own prompt contract.** `instructions()` walks the
subclass's field table and renders the format rules the model must follow;
`parse()` reads the reply back. A subclass therefore declares nothing but its
fields — which is why `this` inside those statics is load-bearing, and why
Biome's `noThisInStatic` is off: its autofix would make every subclass render
the empty base contract.

**A loop is a subclass, not a flag.** `Engine` owns the parameters, prompt
rendering and one exchange; `run` is the only thing a control loop changes. Each
loop declares the response contract it is written against as
`DEFAULT_RESPONSE`, and `ReActEngine.observe` is the seam a toolbox fills.

**Parsing never throws away a reply.** It tries the requested format, then the
other, then keeps the whole text as the answer field. TOON is the default
because small local models follow line-oriented fields far more reliably than
they emit valid JSON.

## Agents are files, not code

    agents/main/agent.md          edited here
    public/agents/main/agent.md   published here by scripts/agents.js
    public/agents/index.json      the roster — a directory cannot be listed over HTTP

Agent files are **copied, not compiled**. They are fetched by the running app,
so an agent's behaviour can be changed in a deployed build by editing markdown
and reloading — no toolchain on the machine running it. Frontmatter is parsed in
the browser by a documented YAML *subset* (`core/agent/AgentFile.js`) rather than
a dependency; an unsupported construct costs one setting, not the file.

Measured: **`Bun.markdown` does not read frontmatter** — it is a renderer, and
turns the opening `---` into an `<hr>` and the metadata into an `<h2>`. The body
is kept as raw markdown and never rendered: it is a prompt, and a model reads
markdown.

**The agent decides when the work is done.** There is no step ceiling and no
repeat ceiling; `max_steps` and `repeat_limit` are retired, and a file still
carrying one is told so in a note rather than left believing a limit is in
force. A counter cannot tell the difference between an agent that is stuck and
an agent three steps into something that needs nine, so a counter ending the run
is a guess overruling the only party that knows.

What replaces a ceiling is telling the agent what it is doing. A repeated call
is not executed again — the result would be identical — and the observation says
exactly that. It is a fact the agent can act on, where a forced stop is merely
something that happens to it.

**A file declares only what differs.** Everything else takes the default, so an
agent file says what is different about this agent and nothing more.

| default | why |
|---|---|
| `maxTokens` 131072 | An agent that has read anything needs room to reason about it. A small default truncates long work silently. |
| *(no step or repeat ceiling)* | The agent decides when its work is done — see below. |

## Tools

    core/tools/Tool.js          name · description · parameters · call() -> Outcome
    core/tools/Toolbox.js       prompt rendering, call parsing, execution
    core/tools/ShellTool.js     a command in the sandbox
    core/tools/McpTool.js       one tool belonging to an MCP server
    core/tools/SubAgentTool.js  another agent, offered as a tool

The model writes calls as text — `researcher({"task": "..."})` — because every
model can do that, including ones with no function-calling API. Calls on one line run together;
each line runs after the one above. Parsing scans for balanced brackets rather
than using a regex, because an argument string may contain parentheses and a
regex that stops at the first `)` truncates calls into silent nonsense.

An agent gets only the tools its file names. Nothing is attached that the file
did not ask for, and an unresolvable name costs that tool alone.

## The sandbox

    scripts/wasm/build.sh          the artifact, from pinned sources
    scripts/wasm/image/            what goes inside it
    public/sandbox/vm-worker.js    the host: WASI shim, one instance per command
    backend/sandbox/C2wSandbox.js  the port implementation
    core/sandbox/Sandbox.js        the port

An Alpine userland inside an x86 emulator compiled to wasm, built with
container2wasm. It is the first thing in this tree that lets an agent find
something out rather than be told it.

**It needs no `SharedArrayBuffer`.** Measured: it boots with
`crossOriginIsolated = false`, which is what makes it deployable to a static
host that cannot set COOP and COEP headers. That single fact is why this
substrate was chosen over the alternatives.

**Boot to first output: 814 ms.** The module is fetched and compiled once
(~107 MB, 15 ms to compile) and instantiated per command (9 ms).

Three limits, each measured rather than assumed, and each stated to the model
rather than hidden:

- **One boot runs one command.** With no blocking stdin there is no interactive
  shell, so the filesystem does not survive between calls. A long-lived pty was
  the alternative: it needs blocking stdin, hence SharedArrayBuffer, hence
  headers this app cannot set — and one malformed command wedges the shell for
  every later caller.
- **1024 bytes of command line.** At 1025 the guest prints
  `too many write (1025 > 1024) failed to prepare entrypoint info` and exits
  before running anything. `C2wSandbox` checks this and says so, rather than
  passing on an exit code about an entrypoint nobody wrote. **A program that
  will not fit belongs in the image, not on the command line.**
- **About a hundred times slower** than the machine it runs on. Fine for `ls`,
  a grep, a small script. Not a place to run a build.

### Two builds

    PROFILE=ship  scripts/wasm/build.sh    107,049,115 bytes (gzip 40,064,757)
    PROFILE=check scripts/wasm/build.sh    109,684,303 bytes
    the shipped image, with mcp-disk in it   107,054,914 bytes

Same pinned sources; the difference is flags and nothing else.

**check** is what upstream's Dockerfile actually defaults to — `INIT_DEBUG=true`,
`LINUX_LOGLEVEL=7`. The guest narrates its own boot: `HOST: got`,
`Running: [sh -c ...]`, `executing: /sbin/runc --debug run`, and every runc
`DEBU` line after it. When it does not reach a shell, this tells you where it
stopped. Nothing is stripped — the name section is what makes a trap readable.

**ship** emits only the command's own output, and then has its `name`,
`producers` and `target_features` sections removed. Those are developer
sections: symbol names for a debugger, and a description of the toolchain that
built the file. Nothing running the module reads them and every visitor
downloads them. wasm-opt is asked to strip, never to optimise — the module is an
emulator that its own build already optimised, and re-optimising it risks
changing behaviour to save nothing.

Measured: c2w already passes `INIT_DEBUG=false` and `LINUX_LOGLEVEL=0` itself,
overriding the Dockerfile's own defaults, so `ship` passes no build args at all
and `check` uses c2w's `--debug-image`. Passing the same `--build-arg` twice
works only by whichever end of the list buildx prefers, and a flag whose effect
depends on that is not a flag to rely on.

## MCP in a browser

    core/mcp/McpConfig.js         a server, as an agent file declares it
    core/mcp/McpClient.js         initialize · tools/list · tools/call
    core/mcp/SandboxTransport.js  the server, as a process in the guest
    core/mcp/HttpTransport.js     the exception: a server someone else runs
    core/mcp/discover.js          an agent's servers, started and asked

MCP was designed around stdio: a server is a process and the client writes
JSON-RPC to its stdin. A browser has no processes and no stdin, which is the
usual reason "MCP does not run in the browser". **It is not a protocol problem
— the protocol is transport-agnostic — and this app already has somewhere to
run a process.** The guest in `public/sandbox/` is a real Linux userland, so a
command run there is a real process, and the server it starts is a real MCP
server. Nothing is emulated at the protocol level and nothing is a shim.

### The server is part of the agent

There is no second configuration file. A server is declared where the agent is:

    mcp:
      - name: host
        command: mcp-disk
        args: []
        env:
          TZ: UTC
        include_tools: [disk]

An agent that can drive a database and one that cannot are two different
agents, and splitting that fact into another file means reading two files to
know what either of them can do. The field names are the ones every other MCP
client uses, so a server someone already has working transfers by copying the
same values across.

It was `name=command`, a single string, for exactly one afternoon. The moment a
server needed arguments, an environment and an allowlist, that syntax was a
small bad language with its own escaping rules — which is why the frontmatter
reader now parses nested maps and lists of maps, and why `AgentSpec.mcp` holds
records rather than names.

### `include_tools`, and why a filter is not a nicety

Every tool a server offers is rendered into every prompt of every turn,
including the turns that never call one. Measured on a server offering
twenty-nine tools: **3,717 tokens for all of them, 1,332 for the nine that were
wanted.** That is the standing cost an allowlist removes. Empty means
everything. A name in the list the server does not offer is reported — a filter
that silently keeps nothing looks exactly like a server that offers nothing, and
those need different fixes.

### What the guest can and cannot host

The server has to be IN the image. That is what `scripts/wasm/image/` is for,
and it follows directly from the 1024-byte command limit: a program cannot be
sent in as part of a command line, so it is on disk in the guest or it does not
exist. Rebuilding:

    docker build --platform=linux/amd64 -t localhost:5000/askk-sandbox:1 scripts/wasm/image
    docker push localhost:5000/askk-sandbox:1
    PROFILE=ship OUT_NAME=sandbox.wasm scripts/wasm/build.sh localhost:5000/askk-sandbox:1

Both flags were found the hard way. c2w resolves images through a **registry,
not the local daemon**, so a locally built image it has never seen is answered
with `pull access denied`. And on Apple silicon the push carries an arm64
manifest unless `--platform=linux/amd64` is given, after which c2w — which
hardcodes linux/amd64 — reports `no matching manifest`, which reads like a c2w
bug and is not.

`mcp-disk` is a whole MCP server in fifteen lines of POSIX `sh`, and it is in
the image for a reason beyond proving the transport: **the leanest MCP wrapper
is no wrapper.** The guest boots fresh for every command, so an interpreter's
startup is paid on every single tool call, on an emulator running roughly a
hundred times slower than the machine underneath it. A framework that imports
in a second natively does not import in a second here.

Three things the guest cannot host, stated rather than discovered later:

  * **A server that needs the network.** There is none in the guest.
  * **A server that keeps state between calls.** Every call is a new process.
  * **A server whose job is to touch the real machine** — driving the user's
    Chrome, reading their home directory. Those live on the other side of a
    boundary a static page cannot cross by itself, and no image ever built will
    change that. A `url:` entry is the only way to reach one, and it needs CORS
    on the server's side.

### One request per process

`SandboxTransport` pipes JSON-RPC into the server the way every stdio client
does:

    printf '%s\n' '<request>' | mcp-disk

Because the process is new each time, anything the server was told before is
replayed ahead of the request, and replies are matched **on request id** — a
server answering the replayed `initialize` first would otherwise have its answer
read as the result.

The handshake is two messages, not one: `initialize` **and**
`notifications/initialized`. A server is entitled to refuse every request until
it has been told the client is ready, and the ones that do are
indistinguishable from a server that is simply broken.

MCP reports a tool's own failure with `isError` on a normal result, not as a
JSON-RPC error. The distinction is kept: "the tool ran and failed" comes back as
text the agent can read and act on, "the call could not be made" is a failure.
A server that cannot be started at all costs its own tools and leaves a note —
the assistant still runs.

## Sub-agents are threads

    ChatService -> AgentWorkerPool -> new Worker(agentWorker.js, { name: <agent> })

A sub-agent runs on its own **named** worker: the agent's identity is the
thread's identity, visible in devtools and in `agents.threads`. Two agents doing
long work at once are two threads, not two turns. Verified: nested module
workers work, and `self.name` propagates.

**An agent file already declares a tool's whole interface.** `name` becomes the
callable name and the thread name; `description` becomes the line telling the
calling model when this agent is the right one to ask. There is no separate
"as a tool" section because a good description already is one.

A sub-agent is given **no sub-agent tools of its own**. That is a depth limit,
not an oversight: agents that can call each other can call each other in a
cycle, and a cycle of threads that spawn threads is a fork bomb on the user's
machine.

Sub-agents are **stateless** — asked one complete question, they answer it. A
per-sub-agent transcript would make the same call return different things at
different times, which is not what a tool is.

## Nothing throws

Every fallible call returns an `Outcome` — `ok` with a value, or a `Failure`
with a code, a message and a hint the user can act on. Notes ride along on both,
recording anything that was corrected or degraded.

    core/Outcome.js       Outcome.ok(v) · Outcome.failed(code, msg, {hint}) · Outcome.attempt(fn)

This is not a style preference. Every part of the flow runs on the client, where
the code, the storage and the transport are all inspectable, so a failure is a
state that can be named in advance rather than an exception unwinding to
somewhere that has lost the context to explain it. A throw also crosses realms
badly: an `Error` does not survive structured-clone with its type or stack.

The rules that follow from it:

- **Repair, do not refuse.** An unknown role becomes `user`, an empty title
  keeps the old one, an out-of-range temperature falls back — and each records
  what it changed. A rejected save loses every other edit made with it.
- **Degrade, do not stop.** No IndexedDB means `MemoryRepository` and a note
  saying persistence is gone; an unavailable model kind falls back to the
  default. An app that will not start is worse than one that says what it lost.
- **A failure keeps what succeeded.** `chat.send` persists the user's message
  before calling the model, so a failed turn returns the failure *and* the saved
  message.
- **`Outcome.attempt` is the only place foreign code is wrapped**, and the
  Kernel's try/catch is a backstop for defects, not the mechanism.
- **No abstract-constructor guards.** Instantiating a base class is a mistake in
  code, not a state the running flow reaches; its methods return
  `NOT_IMPLEMENTED` outcomes instead of throwing on a user's machine.

## Prompt structure

The prompt is **data, not a render method**. Each part is a `PromptBlock`
declaring how often its bytes change; a `PromptTemplate` declares the order.
Rearranging a prompt is editing a list — in code, or in an agent file.

    core/prompt/PromptTemplate.js   PromptBlock · Volatility · PromptTemplate
    core/prompt/tokens.js           estimateTokens · TokenScale

Two published findings decide the default order, and they pull opposite ways:

1. **Caching is prefix matching.** A provider reuses its work on the longest run
   of leading tokens two requests share; the first differing byte ends the reuse
   for everything after it. So stable material must come first, in a fixed
   order. ([OpenAI][oai], [Anthropic][ant])
2. **Models lose the middle.** Attention is reliable at the start and the end of
   a prompt and degrades in between — mid-prompt rules lose a large share of
   their compliance. ([Liu et al.][litm])

Obeying (1) alone puts every rule at the top of a wall of text. Obeying (2)
alone puts the response contract last, where it is re-read from scratch on every
call. **The resolution is that (2) needs a reminder at the end, not the whole
rule.** The full contract goes in the cached prefix where it is free; one line
restating the field names goes last, where it is read.

    identity      static    who this is                                  ─┐
    instructions  static    the agent file's body, unlabelled              │ reusable
    tools         static    what it can do — part of what it is           │ prefix
    contract      static    the full response spec, stated once          ─┘
    ── breakpoint: everything above is identical on the next call ──
    conversation  append    grows only at its end, so it extends the prefix
    context       volatile  carries a clock; nothing after it is reusable
    reminder      static    one line restating the contract, for recency
    cue           static    hands the turn over

A block renders as a markdown section at **one `#`**. The prompt is a document
and these are its sections — there is nothing above them to be a subsection of,
and an agent file's own headings are written at that level too, so a deeper level
here would put the frame below the thing it frames. `instructions` gets no
heading at all: it *is* the agent file's body, and labelling a document with a
heading announcing that it is a document adds a level without adding a
distinction.

`reminder` and `cue` are static and sit after volatile material, which is
normally a mistake. They declare `tail: true` to say it is deliberate — that
flag is what lets `PromptTemplate.audit` distinguish a design from an accident.
An arrangement that wastes tokens reports itself as a note, on the same channel
as every other correction.

**Per agent.** An agent file may declare its own order, and `researcher` does:

    prompt: [instructions, contract, context, conversation, reminder, cue]

Because it is stateless. Every call brings a different single question, so its
conversation block is not append-only and nothing after it could have been
reused anyway. With no prefix left to protect, context moves ahead of the
question, where the model reads it more reliably. **The right order depends on
what an agent actually carries** — which is the reason this is a template and
not a method.

## Context — one fact

    core/agent/Environment.js   describeEnvironment()

    # CONTEXT

    now: Saturday, 29 August 2026 at 23:09 (America/New_York)

23 tokens. A model knows what it was trained on and nothing about the moment it
is answering in, and the clock is the only thing it cannot derive, guess, or be
told by the conversation itself.

Everything else that was tried here has been removed. `locale` is already
carried by the language the conversation is in. `you are` and `your model` and
`running in` and `platform` describe things the agent has no decision to make
about — and its own name is already in its instructions. `storage` is the app's
problem, reported to the user directly rather than to the model. The introductory
sentence went too: it was longer than the facts it introduced, and a heading that
says CONTEXT does not need a paragraph explaining that context follows.

**The bar a fact has to clear is that it changes an answer.** Everything in a
prompt is paid for on every call, including the parts that felt informative.

This block is also the **only clock the agent has**. There was a `now` tool and
it has been deleted: the time is already in the prompt, so the tool spent a call,
a result and a second inference fetching what the model had read a few hundred
characters earlier. Asking the time now takes **one** call.

    A FACT belongs in the context block. A CAPABILITY belongs in a tool.

If the answer is the same every time it is asked within a turn, state it once and
stop paying for it. A tool earns its round trip by *doing* something a prompt
cannot contain — reading a page, searching, asking another agent. `BUILTIN_TOOLS`
is left in place, and empty, as the seam for the first tool that qualifies.

Being the clock is what makes this block volatile, and that is what decides where
it renders: after the conversation, so a value that ticks cannot push the
transcript out of the reusable prefix. Seconds are left off — nothing is decided
by them, and they would make two calls in the same turn differ for no reason.

## Counting tokens

Characters are a bad proxy: the same 100 characters are ~15 tokens of English
and ~40 of JSON, and every limit that matters — the context window, the cache
minimum, the bill — is denominated in tokens.

There is no tokenizer in this tree. The real one belongs to the model, differs
per model, and shipping one means either a megabyte of vocabulary for a number,
or a number confidently wrong for whichever model the user chose. Instead:

- `estimateTokens` counts word pieces, symbols and newlines locally.
- Every reply carries `usage.prompt_tokens` — the exact count, from the only
  tokenizer whose opinion counts. Streamed calls ask for it explicitly with
  `stream_options: {include_usage: true}`.
- `TokenScale` learns the ratio between the two, per model, and applies it.

Measured on this tree, three turns: **865 est / 872 counted**, **1,351 /
1,373**, **962 / 970** — within 1.6% before any calibration.

    962 tokens · 723 reusable · prefix ends at conversation · 970 counted

723 of 962 tokens — 75% — are identical on the next call, and stay identical as
the conversation grows, because the growth happens after them.

`usage.prompt_tokens_details.cached_tokens` is the one number that says whether
the arrangement is *working* rather than merely correct. It is surfaced beside
the estimate. **Measured: the local omlx endpoint reports the field and always
reports 0** — it does not cache prefixes — so on this endpoint the ordering is
theory. It pays against providers that do cache, and the number will say so
without anyone having to trust this document.

Anthropic is the one transport told explicitly where its prefix ends: the
template's boundary becomes a `cache_control` breakpoint splitting the prompt
into two content blocks that concatenate to exactly the same text. Below
Anthropic's 1,024-token minimum the split is skipped, because a breakpoint under
it is ignored anyway.

[oai]: https://developers.openai.com/cookbook/examples/prompt_caching101
[ant]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[litm]: https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long

## Watching a turn happen

A request/response pair can only speak once, at the end. That is no use while a
model is producing text token by token, and no use at all for the prompt, which
matters *before* the call rather than after it. So the protocol has a third
message: an `Event`, addressed with the id of the call it belongs to.

    protocol/Envelope.js   Event(id, name, data) · EventName.PROMPT | DELTA | STEP

Events are **advisory**. A caller that passes no listener gets the identical
Response, and nothing in the flow depends on one arriving. That is what lets the
same code path serve a transport that streams and one that cannot.

    Engine.step   → onPrompt(prompt)          the assembled prompt, before it is sent
    Inference     → onDelta(chunk, kind)      each piece of the reply, as it arrives
    ReActEngine   → onStep({step, parsed})    a pass of the loop, once it has a shape

`Inference.stream` returns exactly what `invoke` returns. Streaming is a
difference in **timing, never in result** — the base class implements it by
calling `invoke` and emitting the whole answer as one chunk, so a subclass that
cannot stream is still correct and no caller needs a branch.

Two things streaming does change, and both are handled where they arise:

- **An error can arrive after a 200**, mid-body, once text is already on screen.
  `_postStream` returns the partial text with the failure rather than discarding
  it — a long partial reply is worth more than a blank turn.
- **The deadline is a gap timer, not a total one.** A long answer is not a stuck
  connection, and a total timeout would kill exactly the slow honest replies
  streaming exists to make bearable.

A reasoning model emits its scratchpad on a separate field (`reasoning_content`
on the OpenAI wire, `thinking_delta` on Anthropic's) and can do so for a long
time before the first word of an answer. It is delivered as `kind: 'reasoning'`
— **shown, because silence is indistinguishable from a hung request, but never
accumulated into the text the response contract is parsed from.**

The page renders raw text while it arrives and replaces it with the parsed
answer the moment the pass resolves. Showing both would be showing the
scaffolding beside the thing it holds up.

## The prompt is visible

The right-hand panel is the complete prompt as it went to the model, and above
it the arrangement that produced it: every block, its volatility, its token
count, and which of them are inside the reusable prefix. A ReAct run is several
calls, so each step keeps its own prompt and the panel follows the run.

This is the one part of a turn that is invisible from both ends: the user sees
what they typed, the model sees the assembled text, and nobody sees the
assembly. It is also where every prompt bug lives — a block in the wrong order,
an instruction that was never rendered, a transcript that grew past the context
limit, a prefix that stopped being reusable when someone moved a line.

`Engine.plan(history)` returns the text and the accounting together, on purpose.
A prompt you can only read as one string is a prompt whose cost and cache
behaviour you have to guess at.

## Speech

    core/speech/  Transcriber (abstract)   transcribe(audio) -> text · feed/finish
                  ├─ WebSpeechTranscriber   the browser's own recogniser
                  └─ TransformersTranscriber in-tab wasm, weights from the hub
                     ├─ WhisperTranscriber   accurate, pads every input to 30 s
                     └─ MoonshineTranscriber variable length, English only
                  Speaker (abstract)       synthesize(text) -> samples · speak(text)
                  ├─ WebSpeechSpeaker       the operating system's voice
                  └─ TransformersSpeaker
                     ├─ SupertonicSpeaker    needs a style vector
                     └─ VitsSpeaker          one file, one language, no vector
                  audio.js                 resample · concat · loudness · toWav

    backend/speechWorker.js          a second backend realm, same envelope
    backend/services/SpeechService.js dictate · push · finish · speak · load
    client/Speech.js                 Microphone · Dictation · Voice

**A subclass declares one call and gets live dictation for free.** `transcribe`
takes a complete utterance and returns text; the base class buffers audio,
re-runs it on a timer and reports each result as a partial. This is the same
bargain `Inference` makes — declare `invoke`, get `stream` — for the same
reason: **liveness is a difference in timing, never in result**, so a model that
can only be handed a finished recording still dictates.

It decides what a partial *means* here. Every one is a re-transcription of the
whole segment, not a fragment appended to the last, so words already on screen
change as more audio arrives. That is a language model revising an ambiguous
ending once it hears what followed. Transcribing each block independently and
concatenating would produce text that never changes and is wrong at every
boundary.

**Three engines each way, because they fail in different places.** The browser's
recogniser does not exist in Firefox and sends the audio to the browser vendor;
whisper is accurate and pads every input to thirty seconds; moonshine takes the
audio at its real length and is English only. A user who cannot dictate with one
of them can dictate with another, and the model id is a setting, so any
checkpoint the pipeline supports is one field, not one class.

### Two realms, one verb

The microphone, the loudspeaker and the browser's own engines are page APIs. The
models are wasm that must not run on the thread drawing the transcript. So the
same capability is served by two paths and the caller sees one:

    native engine   constructed in the page, owns the device, no worker involved
    model engine    speech worker; audio out, transcript back as events

Which one it is, is answered by `OWNS_INPUT` and `OWNS_OUTPUT` — statements about
what API a class needs, made by the class, never a question about what realm it
is in. `client/Speech.js` is therefore the first thing in `client/` to import
`core/`. Dependencies still point inward and `app/` still imports neither
`core/` nor `backend/`.

The speech worker is a **second** backend realm, not a second service in the
first. A transcription pass is a few hundred milliseconds of wasm that yields to
nothing and a worker has one message loop: behind the agent's calls it would make
dictation lag the speaker, in front of them it would make the agent wait on the
microphone. Measured with a model transcribing continuously: **10 ms worst frame
gap over 14,281 frames**, against a 17 ms baseline for the page under load.

`speech.dictate` is a long call in the shape `chat.send` already established —
made once, emitting events for as long as it runs, its Response the final
transcript. What is new is that another call ends it, because audio has to be
pushed in while it is open. `EventName` gains `PROGRESS` and `PARTIAL` rather
than a second mechanism: a download that takes minutes and a transcript that is
still being revised are both "something to say before there is an answer", which
is what an Event already is.

### Measured, and each one changed a default

- **Quantised speech weights do not load.** `onnx-community/whisper-base`,
  `Xenova/whisper-tiny.en` and `onnx-community/moonshine-base-ONNX` all fetch
  their `*_quantized.onnx` files and then fail to build a session —
  `qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale`.
  All three load at `fp32`. The exports are newer than the runtime that reads
  them, so the default dtype for speech-to-text is full precision. Text-to-speech
  keeps `q8`: `Xenova/mms-tts-eng` builds and speaks with it.
- **A failed session poisons the runtime.** After one build failure, every later
  attempt in that realm fails with the *first* failure's message. A fresh page
  loaded `whisper-base` at fp32 in one attempt; the identical call after a failed
  `q8` build in the same page failed instantly. The fp32 fallback in
  `_build` therefore repairs a missing dtype file — a 404 before any session
  exists — and cannot repair this, so it leaves the original failure reported.
- **`Xenova/speecht5_tts` cannot work through this pipeline.** The
  `text-to-speech` task is registered `type: 'text'`, so a processor is never
  loaded, and `TextToAudioPipeline._call` reaches its SpeechT5 branch only
  `if (this.processor)`. The call falls through to plain text-to-waveform, the
  speaker embedding is dropped in silence, and the session fails with
  `Missing the following inputs: speaker_embedding` after a 200 MB download.
  Supertonic is that library version's own default for the task and has a branch
  that reads the embedding.
- **Every model wants 16 kHz and none of them resample.** Audio at the device's
  native 48 kHz is transcribed as a recording played at a third speed, and the
  model returns confident nonsense rather than an error. The capture context asks
  for 16 kHz and `feed` resamples whatever it actually got.

### What the microphone is not allowed to cost

Capture runs in an `AudioWorklet` built from a blob, so the samples are collected
on the audio thread. A `ScriptProcessorNode` does the same job on the page's own
thread and is the fallback — taken with a note, because it is the difference
between dictation that costs nothing to draw and dictation that stutters the
whole interface.

Blocks are pushed to the worker and not awaited. Awaiting the acknowledgement
would make the audio thread's delivery rate depend on how long a transcription
pass takes, and the blocks would arrive in bursts after every pass instead of
steadily. A pass already in flight is never joined by a second one: transcription
is slower than real time on a modest machine, and one pass per block builds a
queue that never drains.

A segment is committed at twenty seconds and a fresh one started. Without it
every pass would re-transcribe the whole dictation, so the tenth minute would
cost ten times the first — and whisper truncates at thirty seconds anyway, so the
later audio would be dropped in silence.

## Design rules earned, not assumed

- **Decide realm positionally, never by interrogation.** `typeof window` is folded
  to a constant by the bundler, so branching on it is a build-time decision
  wearing a runtime disguise. A file's realm is determined by which directory it
  lives in and which entry point pulls it in.
- **Entities are rehydrated, never restored.** structured-clone and IndexedDB both
  drop the prototype. Repositories take and return plain records; `fromJSON` is
  what makes them objects again.
- **`Kernel.handle` always resolves.** A rejection would cross the boundary as an
  unhandled rejection and hang the caller's promise forever instead of failing it.
- **An unexpected throw is `INTERNAL`, never a plausible-looking `NOT_FOUND`.** A
  defect must not be reportable as a clean negative result.
- **A dead worker rejects every outstanding call.** Silence is worse than an error.
- **Never build a user-facing message from `constructor.name`.** The production
  bundle renames classes, so the message is wrong in exactly the build a user
  reads it in. Inference classes carry a static `LABEL`.
- **The user's message is persisted before the model is called.** A failed or
  slow turn must not cost them what they typed.
- **One inference object per configuration, reused.** Rebuilding per turn is
  free over HTTP and ruinous for transformers.js, where construction loads the
  weights.

## Where this goes next

1. **Tools** — a `Toolbox` behind `ReActEngine.observe`, which currently
   reports that none exist. That method is the whole of the change.
2. **Streaming** — the protocol answers once per request. Streaming tokens needs
   a second message shape (`chunk`) keyed to the same request id, and a
   `_postJson` sibling that reads the SSE body.
3. **Prompt components** — soul / system / history / contract are assembled by
   `Engine.render` in a fixed order. The reference implementation makes each a
   `Component` with a slot, so an agent file can choose the recipe.
4. **Single-writer election** — `navigator.locks` in the worker, so two open tabs
   cannot both drive the same run. The lock must be held by a promise that never
   settles, or it releases the moment the callback returns.
5. **Deploy** — static export to GitHub Pages at `/ASKK`, with `.nojekyll` (Pages
   strips `_next/`). Verify by polling the build id, never page content: a stale
   build serves a byte-identical page from disk cache.
