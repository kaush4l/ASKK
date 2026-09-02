# ASKK — architecture

A personal agent that runs entirely in the browser. Statically hosted, no server,
no build-time secrets. The user's data stays on the user's machine.

This is a **full-stack application with no backend server**. The backend is real —
domain model, use cases, repositories, persistence, a request/response boundary —
it simply runs in a Web Worker instead of on a host.

## Realms

    ┌─ page realm ────────────────┐        ┌─ worker realm ──────────────┐
    │  app/      React components │        │  backend/  Kernel           │
    │            PromptPanel      │ ─────► │            services/        │
    │            RunPanel         │ postMsg│            repositories/    │
    │            FilesPanel ──────┼── files.list / files.read ──┐        │
    │  client/   BackendClient    │        │            files/Workspace  │
    │            highlight.js     │ ◄───── └──────┬──────────────────────┘
    └─────────────┬───────────────┘               │
                  │                                │
                  └──────► protocol/ ◄─────────────┘   IndexedDB `askk` v3
                        (the only shared code)         conversations
                                                       settings
                                                       files ◄── the agent's,
                                                                 and now the
                                                                 human's to read

The third store is **read from both realms as of this wave**, and the arrow is
one-way on purpose. `backend/files/Workspace.js` is the only implementation of
`core/tools/FilesPort.js`, constructed in `composition.js` beside the other two
repositories, and it is reached five ways now: `read_file` and `write_file` as
tools, one line of the context block naming what exists, `ShellTool` staging
named files into the guest and harvesting them back, and — new — `files.list` and
`files.read` called from `app/FilesPanel.jsx` over the same envelope protocol
every other route uses.

The paragraph that stood here said *"nothing in `app/` reads it, which is a real
gap"*. That gap is closed; a narrower one is open in its place. **There is no
route in the other direction.** `FilesPort` declares `list`, `read` and `write`;
the kernel exposes only the first two to the page, and `FilesPanel` has no
upload and no editor. The page realm can watch the agent work and cannot join in.

Two page-realm files carry the view: `app/FilesPanel.jsx` renders the listing and
the file, and `client/highlight.js` colours it — a hand-written scanner over c,
js, json, md, py and sh, chosen over CodeMirror at a measured price
(`CAPABILITIES.md`, *Viewing and editing a file*).

The boundary is a rule the realm makes expensive to break and does NOT enforce.
That sentence used to read *"a component cannot import a service … the import
would fail at runtime, because that code is not in the page's realm"*, and it is
false: `Kernel.js` imports nothing but `Outcome` and the envelope, and
`IndexedDb`, `Workspace` and every service run perfectly well in a page. A
component that imported one would bypass the protocol and work, and every step
of the gate would stay green — measured by adding that import.

So it is checked instead of asserted. `test/architecture/layers.test.js` reads
the import lines of every file under `src/app/` and fails on one that names
`backend/` or `core/`, which is the direction with no runtime consequence to
catch it. The OTHER direction — a worker file reaching for the DOM — has one:
`docs/GATE.md` rows 6 and 7 measure which step notices, and the answer is only
the browser smoke.

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
| `backend/files/` | `core`, a `Repository` | `Workspace` implements `core/tools/FilesPort.js` over one of those repositories. The agent's own files: `list` · `read` · `write`, no `remove`. |
| `backend/services/` | `core`, `protocol`, port | Use cases. Load → enforce → save. Knows nothing about transports. |
| `backend/Kernel.js` | `protocol` | Routes `namespace.method` and converts thrown values to typed failures, uniformly. |
| `client/` | `protocol` | Turns postMessage broadcast into awaitable calls by correlating reply ids. |
| `app/` | `client` | React. Never imports `backend/` or `core/`. |

Dependencies point inward only. `core/` names nothing outside itself.

## The agent kernel — `core/`

    core/
      Message · Conversation               domain, invariants owned here
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

**Parsing never throws away a reply.** It reads TOON, then a brace run as JSON
if the TOON pass found no fields, then keeps the whole text as the answer field.
TOON is the only form the contract asks for, because small local models follow
line-oriented fields far more reliably than they emit valid JSON; JSON is still
read, as a repair, not as a form an agent file may request.

**It refuses one now, on both routes inside the contract and on the one
outside it, and the third route inside is the residual.** A reply cut off
before it wrote `act:` and a reply whose `act` is a word that is neither verb
are both `ACT_UNSAID` (`ReActResponse.js:161`); the field has no default (`:55`
is the comment where the default was), neither ends the run, and each response
carries `unsaidBecause` saying which of the two it was in words. The engine
echoes the reply back with that sentence, counts the streak
(`ReActEngine.js:348`) and ends the run only at `UNSAID_CEILING = 2` in a row
(`:349`), through `unreadable` (`:452`), which names the route and names no
lever — the ending is a decision with a reason attached rather than an accident
wearing an answer's clothes. The route outside the contract is the reply that
never reached it: one that ran out of tokens inside the model's reasoning. The
transport refuses it and now says so as `Reason.OVERRUN`
(`OpenAICompatible.js:331`); the engine reads that (`ReActEngine.js:289`),
tells the live view the pass ended holding nothing (`:308`), and sends
`OVERRAN` (`:110`) back
through the scratchpad on the same streak — a sentence measured to recover the
next turn 10 of 10 times on the task that overruns, where every shorter
version of it recovered none.

The third route is unchanged and is stated as a cost rather than repaired: a
reply in which *neither* parser finds any field still becomes an answer holding
the whole text (`BaseResponse.js:277`). Measured over the 34 replies recorded in
`bench/transcripts/`, that branch is taken ten times and every one of the ten is
`Reply.THINKING`, which the transport refuses before the parser is reached — so
inside the contract it is unreachable, and the tokens a prompt sentence about it
would cost on every turn would prevent nothing. The scaffold that beat us here —
an envelope with a closing brace, where an unterminated fragment is `malformed`
and the turn is retried — still refuses that one reply where we answer it.

The guard for the worst trigger sits one layer up rather than here, in the
transport below, and the two are independent: the transport refuses a reply whose
answer never began, the parser refuses one that began and never said what to do.

**The transport classifies a truncated reply before the parser ever sees it.** A
thinking model on the OpenAI wire has four states, and `OpenAICompatible._state`
is the only thing that assigns one: a complete answer; an answer cut off
mid-sentence, passed on with a note; the scratchpad arriving on the answer
channel because the tokens ran out inside the think block; and no answer started
at all. The third is refused outright rather than shown, because that text
contains the model rehearsing the response format — lines like
`act: shell({"command": "..."})` written as an example — and the response layer
reads a rehearsal as a decision. That has happened in this tree. The refusal
belongs in the transport and nowhere below it: `finish_reason` and
`reasoning_content` exist only there, and every layer beneath is reasoning about
a string it has been told is an answer.

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

**The agent decides when the work is done, inside terms it is told.** What was
retired is the HIDDEN ceiling, not the number: `repeat_limit` is gone, and
`max_steps` became the step line of a `Budget` — `AgentSpec` reads it, and
`Budget` applies 24 steps, 250k tokens and 600 seconds when a file names none.
This paragraph said "there is no step ceiling" for two waves after that change
and was simply wrong; `Budget.js:63` is the default and `ReActEngine` ends the
run on it.

The difference that survives is which party knows. A budget is rendered INTO the
prompt and the last turn is told it is the last, so the agent spends what it has
and writes an answer; the ceiling it replaced ended runs silently from outside,
which is a counter overruling the only party that can tell being stuck from
being three steps into something that needs nine.

What replaces a ceiling is telling the agent what it is doing. A repeated call
is not executed again — the result would be identical — and the observation says
exactly that. It is a fact the agent can act on, where a forced stop is merely
something that happens to it.

**A file declares only what differs.** Everything else takes the default, so an
agent file says what is different about this agent and nothing more.

| default | why |
|---|---|
| `maxTokens` 131072 | An agent that has read anything needs room to reason about it. A small default truncates long work silently. |
| `budget` 24 steps · 250k tokens · 600 s | Terms the agent is TOLD, not a ceiling applied to it — see below. `repeat_limit` is retired; `max_steps` became the step line. |

## Tools

    core/tools/Tool.js          name · description · parameters · call() -> Outcome
    core/tools/Toolbox.js       prompt rendering, call parsing, execution
    core/tools/FilesPort.js     the agent's own files, as a port
    core/tools/ShellTool.js     a command in the sandbox — over those files
    core/tools/ReadFileTool.js  read one back
    core/tools/WriteFileTool.js write one
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

**It has a language in it as of this wave: Python 3.12.14.** That is the whole of
what the rebuild bought, and it is enough to write a program, run it, and run a
test over it — driven from the page's own composer by the accountant on
2026-09-01: `shell({"command": "python3 receipt.py; python3 -V"})` returned
`total 42` and `Python 3.12.14`, where `receipt.py` was a file the model had
written a turn earlier through `write_file`. It cost 12,572,161 gzipped bytes.

**It needs no `SharedArrayBuffer`.** Measured: it boots with
`crossOriginIsolated = false`, which is what makes it deployable to a static
host that cannot set COOP and COEP headers. That single fact is why this
substrate was chosen over the alternatives.

**Boot to first output: ~1.4 s over loopback.** The module is fetched and
compiled once and instantiated per command. This is the one number in this file
that the gate re-derives on every run — `bun run check` prints it, most recently
*"the real guest answered `Linux localhost 6.1.0 …` in 1517ms cold, then a
failing command in 1056ms warm (exit 1); 52602121 bytes fetched, inflated to
143205983"* (accountant, 2026-09-01, integrated tree). It has moved twice for two
different reasons and both are worth separating: 925–945 / 671–692 ms → ~1,400 ms
when the smoke step began staging two files onto a budget-filling command line
(the same guest, asked for more), and ~1,400 → ~1,520 ms when the guest itself
grew Python. The cold figure is the whole 50.2 MiB fetch, the inflate and a
compile; the warm one is an instance and an Alpine boot. It fetches the compressed module because that is what the deploy
can carry, and it prints both sizes so a build that shipped the raw module under
that name fails here rather than reaching a visitor.

Four limits, each measured rather than assumed, and each stated to the model
rather than hidden:

- **One boot runs one command.** With no blocking stdin there is no interactive
  shell, so the GUEST's filesystem does not survive between calls. A long-lived
  pty was the alternative: it needs blocking stdin, hence SharedArrayBuffer,
  hence headers this app cannot set — and one malformed command wedges the shell
  for every later caller. What survives instead is the *agent's* filesystem, one
  realm up: `ShellTool` stages any of the agent's files whose path the command
  mentions into `/w` before the command runs and saves back every file left
  there afterwards, so a command's work outlives the boot that did it even
  though the boot does not. That staging is paid out of the same 962-unit
  command budget, and a file that will not fit is refused in a sentence naming
  what placing it would have cost and what was left.
- **962 on the channel, and the channel does not count bytes.** The guest charges
  one for every UTF-8 byte and one MORE for every space and every newline — not
  whitespace, since tab, CR, VT and FF all cost one, which is how the rule was
  pinned. Over 1000 it prints
  `too many write (1025 > 1024) failed to prepare entrypoint info` and exits
  before running anything; `C2wSandbox` refuses first and says what the command
  cost, rather than handing the emulator's complaint back as the command's own
  output. `MAX_COMMAND_COST` is 1000 because 1000 is the LOWEST ceiling measured
  across shapes — 1,008 ran on the shape that ships — so the guard is
  deliberately conservative by up to eight. The 38-unit gap to 962 is the status
  wrapper below, and `commandBudget` is derived from it rather than written down,
  so anything added to the wrapper shrinks it without an edit. Two earlier
  readings of this number were wrong and both passed a bisection, which is why
  `C2wSandbox.js` now carries the sweep table and not just the answer. **A program
  that will not fit belongs in the image, not on the command line.**
- **The exit status has to be asked for.** c2w's `proc_exit` is the *emulator's*
  and returns 0 whatever ran, so for as long as this sandbox existed every
  command came back successful. The guest is now sent
  `sh -c '( <cmd> ) ; echo "__askk_rc$?"'` and the marker is taken off the **end**
  of stdout — the end, not a line of its own, because fd 2 shares the buffer and
  because `printf abc` runs straight into it. Measured through the real image:
  `ls /nope` 1, `false` 1, `exit 7` 7, `sh -c "exit 3"` 3. It costs 25 bytes and
  no measurable time, and the gate asserts it. Where the shell never reaches the
  echo — a trap, quoting that swallowed it — the emulator's 0 stands and the trap
  arrives as a note.
- **About a hundred times slower** than the machine it runs on, which is the
  sentence the model is handed and is the wrong order of magnitude. Measured
  against the identical busybox in `docker run --rm alpine:3.21`: 358x on an
  `awk` loop, 485x on `sha256sum`, 255x on `gzip`. Fine for `ls`, a grep, a small
  script. Not a place to run a build.

### Getting it to the visitor

The image ships **inside the export** — `public/` is copied whole, so
`composition.js` derives its URL from the base path exactly as it derives the
worker's. That is what makes a shell command work when the export is served, and
it has been run end to end through the built artifact.

**Three things had to be true and two of them now are.**

**The guest is in the repository — and the guest that is in the repository is not
the guest this section describes.** The raw module is 143,205,983 bytes, far over
GitHub's 100 MiB per-file block, so it stays excluded by `.gitignore`'s
`public/sandbox/*.wasm` rule — named rather than numbered, because that line was
cited as `.gitignore` line 33 in three documents and is now a comment. `gzip -9`
puts the same guest at 52,602,121 bytes, under the block and using 50.2% of it;
it inflates to the raw module's own sha256; `vm-worker.js` inflates it with
`DecompressionStream` after sniffing `1f 8b`; and GitHub Pages serves a `.gz` as
raw gzip bytes with no `Content-Encoding`, so the sniff is the path that ships
(measured against a Pages site that already serves one, `docs/GATE.md`).
`git ls-tree HEAD public/sandbox/` lists it as a blob, so the
neither-tracked-nor-ignored state this section used to describe is closed.

**For one wave the tracked blob was the OLD guest** — 40,029,960 bytes at
`HEAD`, inflating to 107,054,914 with zero occurrences of `python3.12`, so a
clone booted a guest without a language in it and failed `bun run toolchain`.
`e59eeba` closed that: `git show HEAD:public/sandbox/sandbox.wasm.gz | wc -c`
is 52,602,121 and the inflated module carries 703 occurrences, the same as the
working tree's. Every figure in this section is now `HEAD`'s.
`docs/LEDGER.md` row S51, closed.

**There is a deploy step.** `scripts/deploy.js` builds the directory a static
host serves, and the whole of its design is that it builds from a CLEAN
CHECKOUT: `git archive <ref> | tar -x`, then `bun install --frozen-lockfile`
into an empty `node_modules`, then `next build`. Nothing in a developer's
working tree can reach the output, which is what makes it answer the question a
deploy is actually for — can a stranger with this repository and nothing else
produce the page. It refuses to write a directory it did not write before, it
refuses a file over the block, it writes a `deploy.json` so the directory says
what prefix it was built for, and **it does not push**. `scripts/deploy-check.js`
then opens that directory in a real browser over a host that sends no COOP, no
COEP and no CORP — proved by a 404 control the browser itself fetches — and
drives two turns through the page's own composer, one that needs no tool and one
that needs the shell.

**Nobody has published it.** `gh-pages` is still 93 commits and 56 files with no
guest in it, and `https://kaush4l.github.io/ASKK/sandbox/sandbox.wasm.gz` is
still a 404 beside a page that answers 200. That is one push, and it is the
owner's: a script that both builds and publishes turns one review into none.

`SANDBOX_IMAGE=<url> bun run build` compiles a different URL into the bundle for
a deploy whose host will serve the file. It is an override, not the location, and
nothing has ever fetched the image from another origin — see `CAPABILITIES.md`,
which carries that as `unverified` rather than as a plan.

### Two builds

    PROFILE=ship  scripts/wasm/build.sh <image>   the artifact that ships
    PROFILE=check scripts/wasm/build.sh <image>   the same sources, narrating
    the shipped image, Alpine + mcp-disk + Python 3.12.14
                                                  143,205,983 raw / 52,602,121 gz

The image argument is REQUIRED. It used to default to `alpine:3.21`, which built
a guest with neither `mcp-disk` nor Python in it and said nothing; bare, the
script now prints the three-line rebuild recipe and exits 2.

The byte counts that used to be written here per profile are gone rather than
corrected. They moved three times in one day — twice for a rebuild and once for a
prune — and a number restated in ten files is a number that is wrong in nine of
them. `bun run toolchain` prints the live pair on every gate run.

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

### The guest's servers wait for the guest

Discovery is two commands per server — `initialize` and `tools/list`, because the
transport has no session — and it ran **on every turn**. Measured in
`test/backend/ChatService.test.js`: two `sandbox.run` calls before the model was
called, on a turn that said hello. Two Alpine boots at roughly a second each,
and on the first turn of a session those two boots are the whole 50.2 MiB image,
fetched and inflated, for a question that never wanted a guest. That made
`composition.js`'s promise — *"an agent that never runs a command must never
download the guest"* — false for every agent with an `mcp:` block, which is
every agent that shipped.

Two changes, and the measured number is 2 → 0 for that turn. `Sandbox` answers a
second question now, `warm`: not "could a command run" but "is the guest already
up", and a port that cannot tell answers false, because guessing wrong costs a
download nobody asked for. `discoverMcpTools` skips a guest-backed server while
the guest is cold and says so in a note, so the tools appear from the turn after
the first `shell` call rather than never and rather than at once. And
`ChatService` keeps what discovery found for the session, keyed by agent and by
whether the guest was up — the same argument as the one inference object it
already reuses, one seam over.

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

A third trap, paid for in a whole rebuild during this wave: on macOS **AirPlay
Receiver holds port 5000** and answers `403 / Server: AirTunes`, so a readiness
probe against the port succeeds without a registry behind it and the push fails
minutes later with `connection refused`. Wait for `listening on` in
`docker logs`, not for the port to answer.

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

**A thread has now actually been entered, and it is the gate that says so.** For
four waves this realm was the one on the diagram nothing had ever run, and the
cause was one line rather than a missing mechanism: the roster held a single
agent, so `ChatService.js:220` computed no peers, so no `tools:` entry could
resolve to a peer and the pool was never asked for a thread. What was missing
was a second agent. `agents/researcher/agent.md` is it — `search` and `fetch`,
its own eight-step budget — and `main` names it in `tools:`. `bun run smoke`
runs one: a scripted OpenAI-compatible endpoint on the smoke host answers the
thread's own request, the thread's own `fetch` reads a page from that host, and
the answer comes back through `AgentWorkerPool.ask` as an ordinary `Outcome`
with `confirmedName: "researcher"` beside it. Nothing in lint or `bun test` can
start a Worker, so that step is the only place this realm can be executed at
all.

**A sub-agent has the tools its own file names, minus the ones a second realm
may not hold.** It used to be built with the literal `tools: []`, which made
every sub-agent a model with no way to find anything out.
`core/agent/delegable.js` is the policy and it is a resource argument rather
than a taste: a delegated tool is a SECOND live instance of whatever it reaches,
so `read_file` and `write_file` are refused because `Workspace` is one write
queue over one store and a thread cannot share the parent's instance, and
`shell` is refused because the guest is a 50.2 MiB download that inflates to
143 MB in whichever realm holds it. `search` and `fetch` survive because their
whole cost is a request. Each refusal travels back to the calling agent as a
note, so a file that asked for `shell` is told the line did not take effect.

**Where the app is served from is passed in, not read again.** The pool takes a
`basePath` and sends it with every task; `agentWorker.js` builds one catalogue
per prefix from that. It used to read `process.env.NEXT_PUBLIC_BASE_PATH` for
itself — a second module deriving what `composition.js` already derives, which
is the exact duplication that put `imageUrl: ""` into every build ever made.

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

## Ready is not the same as able

`ready` means this app started: the worker booted, storage answered, the roster
loaded. It says nothing about the one thing that decides whether a question gets
an answer, and the default settings name a model server on `127.0.0.1` that most
people are not running — so a first visit read "ready", asked something, and met
a transport failure.

`backend/services/HealthService.js` asks the other question at boot, on the
`health.model` route: a plain GET of `<baseUrl>/models`, four-second deadline,
nothing read. Not a completion, because a probe that spends tokens on every page
load costs money to open a tab; not a HEAD, because several OpenAI-compatible
servers answer one with 405. **Any status at all means reachable** — a 401 is a
running server with a key problem and says so, a 404 is a running server that
does not list models — and only `blocked` distinguishes the three ways nothing
came back, which is the distinction `HttpPort` exists to make. A model that runs
in the tab is not probed at all: there is no endpoint, and calling it
unreachable would be a warning about a configuration that is correct.

An unreachable model is a RESULT and not a failure, so it renders as an empty
state with the address in it and the word *settings* as a control, rather than
as a red error. Saving settings asks again, because a message telling someone to
fix something that stays up after they have fixed it is worse than none. The
gate plants the discard port and asserts the sentence, which is the only place
it can be asserted: there is no DOM in `bun test`.

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
- **`Outcome.attempt` is where foreign code becomes a value**, and the Kernel's
  try/catch is a backstop for defects, not the mechanism. It is not the only
  `try` in the tree and the claim that it was is retired: `grep -rc 'try {' src`
  counts 22, and each of the others is a place a bare `try` says something
  `attempt` cannot — a `finally` that must clear a deadline on every path
  (`browserHttp.js`), a loop that keeps what arrived before it broke
  (`Inference.js`), an event-callback boundary that has no promise to attach to
  (`IndexedDb.js`, `Speech.js`). What the rule actually forbids is a `throw`
  crossing a seam, and nothing in `src/` does.
- **No abstract-constructor guards.** Instantiating a base class is a mistake in
  code, not a state the running flow reaches; its methods return
  `NOT_IMPLEMENTED` outcomes instead of throwing on a user's machine.

## Prompt structure

The prompt is **data, not a render method**. Each part is a `PromptBlock`
declaring how often its bytes change; a `PromptTemplate` declares the order.
Rearranging a prompt is editing a list — in code, or in an agent file.

    core/prompt/PromptTemplate.js   PromptBlock · Volatility · PromptTemplate
    core/prompt/tokens.js           estimateTokens

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

    instructions  static    the agent file's body, unlabelled             ─┐
    tools         static    what it can do — part of what it is           │ reusable
    contract      static    the full response spec, stated once          ─┘ prefix
    ── breakpoint: everything above is identical on the next call ──
    conversation  append    grows only at its end, so it extends the prefix
    scratchpad    append    this turn's own actions and observations
    context       volatile  carries a clock; nothing after it is reusable
    budget        volatile  empty on almost every turn; the hand-over when it is not
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

    prompt: [instructions, tools, contract, context, conversation, scratchpad, budget, reminder, cue]

Because it is stateless. Every call brings a different single question, so its
conversation block is not append-only and nothing after it could have been
reused anyway. With no prefix left to protect, context moves ahead of the
question, where the model reads it more reliably. Only that one block moves:
this example stood here for a wave as a six-name list that silently dropped
`tools`, `scratchpad` and `budget` — an agent adopting it would have rendered no
tool block at all and been unable to call anything, which `PromptTemplate.of`
would have reported as a note nobody was reading. **The right order depends on
what an agent actually carries** — which is the reason this is a template and
not a method.

## Context — a clock, and what exists

    core/agent/Environment.js   describeEnvironment()
    backend/services/ChatService.js   the files line

    # CONTEXT

    now: Saturday, 29 August 2026 at 23:09 (America/New_York)
    your files: notes.md src/main.c plan-2.txt

23 tokens for the clock, and about five per file for the second line. **Both are
here for the same reason and it is the rule below, not a widening of it:** a
model cannot derive the moment it is answering in, and it cannot derive what it
wrote down last week either. The files line is `ChatService._context`, capped at
forty names, and past the cap it SAYS it was cut — `(and 12 more, not listed)` —
because an agent certain it has seen every file is the one thing a silent
truncation would buy. A model knows what it was trained on and nothing about the moment it
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
cannot contain — reading a page, searching, asking another agent. `BUILTIN_TOOLS` holds
five: `shell`, `read_file`, `write_file`, `fetch` and `search`. There is no
`list_files`, and its absence is this rule applied rather than an omission — the
names of the agent's files are a FACT, so they are one line of the context block
instead of a round trip, measured at ~5 tokens a file against 22 tokens of
rendered tool description plus a whole call. Past forty files the line says it
was cut, and past forty the tool would be the better buy.

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
- Nothing learns the ratio between the two. A calibrator named `TokenScale`
  sat in `tokens.js` for six waves with no caller outside its own test, and
  slice D deleted it rather than thread a scale through `PromptTemplate.render`,
  `ReActEngine` and `Budget`: `grep -rn "TokenScale" src scripts test bench
  agents public` → nothing, exit 1, re-run by the accountant on 2026-09-01.
  The estimate below is uncalibrated and `tokens.js`'s header says why —
  `Budget` spends `usage.prompt_tokens`, the exact count, so a calibration
  nothing fed would show as learned.

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
                  Speaker (abstract)       synthesize(text) -> samples · speak(text)
                  ├─ WebSpeechSpeaker       the operating system's voice
                  └─ TransformersSpeaker    in-tab wasm, weights from the hub
                  index.js                 EARS · VOICES — one row per checkpoint
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

The first three items on this list were done and the list did not notice, which
is the failure mode this file is supposed to be immune to. They are written down
as done, with what to grep, rather than deleted, because a plan that quietly
loses its own history is how the same thing gets built twice.

**Done.** *Tools* — `core/tools/Toolbox.js` exists and `ReActEngine.js:379`
runs it (`:376` is the empty-toolbox guard three lines above). *An action is
mandatory, not defaulted* — `act` absent or unmatched is `ACT_UNSAID`, the turn
is retried with the reply echoed back, and the run ends named at a ceiling of
two; the branch that ended a run by accident is gone and `grep -rn "default:
ACT_ANSWER" src/` returns only the comment recording it. This was *"the one place
a reference scaffold beat this one in a measured head-to-head"*, named by a
judge who was handed a transcript and no stake in it — not a blind one; every
judge on every panel has said which arm was which. Its successor, *the overrun
comes back as a turn*, was named the same way by four judges of five and is
done in `src/` (`ReActEngine.js:289`) and not yet in the rig that scores it
(`docs/LEDGER.md` row S62). *Streaming* —
`EventName.DELTA` on the same request id, emitted at `ChatService.js:266`. *Prompt components* — `core/prompt/PromptTemplate.js`.
*Deploy* — static export to GitHub Pages at `/ASKK` with `.nojekyll`;
`git log --oneline gh-pages | wc -l` is 93, of which exactly **one**
(`a1d7a98 Deploy 2ef2c05`) is a commit descended from this architecture's
skeleton, and it is eleven commits behind `main` (`git rev-list --count 2ef2c05..main`, re-run 2026-09-01). Verify by polling the build id,
never page content: a stale build serves a byte-identical page from disk cache.

**Also done, and written here rather than deleted for the same reason.** *A
filesystem* — item 4 on this list for four waves, described as "nothing on the
realm diagram holds files" — exists: `core/tools/FilesPort.js` is the port,
`backend/files/Workspace.js` the implementation over a third IndexedDB store,
and it is drawn on the diagram at the top of this file. Verify by writing a file
in one turn and reading it back after a reload; `bun run check`'s smoke does it
every run. What it did NOT deliver is the eleven *Building software* rows the
item claimed it would unblock: it closed three of them and the other eight need
a toolchain inside the guest or a reader inside the page, neither of which is a
store. That over-claim is left visible rather than edited out. *A deploy step* —
`scripts/deploy.js` and `scripts/deploy-check.js`, and the guest is tracked.

**Two more, done by the wave that produced this draft, and both were items on the
list below.** *A view of the agent's files* — item 2 — is `app/FilesPanel.jsx`
plus `client/highlight.js`: `grep -rn "files\." src/app src/client` returns
`files.list` and `files.read`, `bun run smoke` drives the rail button, the
listing, an opened file, its colours and its download on every gate, and five
deletions in `src/app/**` turn it red. *Something in the guest that builds
software* — item 4 — is Python 3.12.14 in `scripts/wasm/image/Dockerfile`, with
`bun run toolchain` making three real guests write a module, run a `unittest`
suite over it and read the result back. Both are drawn above. **Neither is
complete, and the residue is what items 2 and 4 become:** nothing goes INTO the
files from the page, and the model has never been told the guest has Python.

**Open, in the order that unblocks the most:**

1. **Push it.** The environment works in a browser, the deploy directory that
   carries it builds from a clean checkout and has been driven in a browser, and
   `https://kaush4l.github.io/ASKK/sandbox/sandbox.wasm.gz` is still a 404. This
   is no longer a host hunt or a tracking problem: it is `bun scripts/deploy.js`
   and one push, then a `curl` that answers 200. See *Getting it to the visitor*
   above.

2. **A way IN to the agent's files.** The reading half is done (above). Nothing
   goes the other way: `FilesPort` has a `write` the kernel does not expose to
   the page, `FilesPanel` has no upload and no editor, and `read-only` is on
   screen. Until a human can hand the agent a file, "we have files" is half
   true — and a diff, a rewind and an editor are all downstream of the same
   missing route.

3. **Single-writer election** — `navigator.locks` in the worker, so two open tabs
   cannot both drive the same run (`grep -rn "navigator.locks" src` → 0). The
   lock must be held by a promise that never settles, or it releases the moment
   the callback returns.

4. **The model has been told what is in the guest. What goes in next is now a
   budget question.** `ShellTool.js:223` says *"BusyBox, the Alpine base tools
   and python3 are available"*, and the constant it interpolates —
   `GUEST_TOOLS` — is checked against `scripts/wasm/image/Dockerfile`'s `apk
   add` list in both directions by `test/core/tools/ShellTool.test.js`. Priced
   by the accountant on both instruments: **+9 bytes** (arithmetic on the two
   strings, not the +10 this paragraph carried), and **+3 prompt tokens counted
   by the endpoint's own `usage`** — 950 → 953 on the S50 task. The tree's own
   `estimateTokens` says +2 over the same substitution
   (`bun scripts/dryrun.js "what kernel is this machine running?"`, 893 → 895);
   where the two disagree the endpoint is the one the bill is written in.
   What that check does NOT cover is the artifact: `toolchain-check.js` asserts
   `python3` and nothing else, so a second runtime added to this sentence would
   ship unguarded. `docs/LEDGER.md` rows S50 and S56. The remaining *Building
   software* rows are now a budget question rather than a capability one: a
   formatter, a linter and `git` are an `apk add` line, and 52,602,121 of
   GitHub's 104,857,600 is already spent.

5. **Done, by the wave that wrote this paragraph, and its residue with it.**
   *Sub-agents that are actually constructed* — the roster is two agents, `main`
   names `researcher` in `tools:`, and `bun run smoke` starts the thread, drives
   its own tools and asserts the name the worker reported for itself. *And they
   say what they are doing while they do it* — one message per finished pass
   from `agentWorker.js`, kept on the thread record and forwarded to whoever is
   watching the parent's call as `EventName.DELEGATE`, which the rail renders
   as `researcher: fetch (1)`. The gate drives the whole path through the built
   page: a question typed into the composer, the parent delegating, the rail
   watched by a `MutationObserver` while it happens, and the parent's answer in
   the transcript.

   What a delegated run still cannot do is **outlive the turn that asked for
   it**. `SubAgentTool.call` awaits one promise, so the parent is blocked for as
   long as the child takes; there is no way to hand a question over, get on with
   something else, and be told later. That is the next thing on this list, and
   it is what the goal calls a status check and a notification: a delegated run
   that has an id, a record that survives the turn, and a way to be told it
   finished.
