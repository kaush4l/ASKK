# Devika (stitionai/devika) — prior-art read

Source read: shallow clone of `https://github.com/stitionai/devika` at commit `80bb343` (2025-09-25).
All line numbers below are from that commit.

## 1. What it is

Devika is a Flask + SocketIO server with a Svelte frontend that runs a **fixed pipeline of
single-shot LLM calls** ("agents") to produce a code project on the host filesystem. Repo:
https://github.com/stitionai/devika. Last commit 2025-09-25, which only changed the README to point
at a successor product, Opcode (https://opcode.sh/). Not archived (`archived: false`, 19.5k stars,
196 open issues) but functionally dead: the README's own banner says "very early
development/experimental stage. There are a lot of unimplemented/broken features", and the source
agrees — `src/sandbox/*`, `src/documenter/{uml,graphwiz}.py`, `src/memory/rag.py` and all of
`src/experts/*` are empty or stubs (`src/experts/__UNIMPLEMENTED__` is a literal marker file). Worth
reading for its **decomposition of one coding task into named prompt-agents with typed outputs**,
not for its engineering.

## 2. The agent loop

There is no loop in the ReAct sense. There are two straight-line pipelines, chosen by whether the
project already has state, plus one bounded repair loop inside the runner.

Entry point — `devika.py:77-103`:

```
on socket "user-message"(message, base_model, project_name, search_engine):
    agent = Agent(base_model, search_engine)            # devika.py:85
    state = AgentState.get_latest_state(project_name)   # devika.py:87
    if not state:                     -> Thread(agent.execute(...))              # :89
    elif AgentState.is_agent_completed -> Thread(agent.subsequent_execute(...))  # :93
    else: warn, and if agent_is_active or not completed -> agent.execute(...)    # :96-103
```

First-run pipeline — `src/agents/agent.py:270-365`. Fixed order, no branching, no iteration:

```
execute(prompt, project_name):
    project_manager.add_message_from_user(...)                     # agent.py:275
    agent_state.create_state(project)                              # agent.py:277
    plan = Planner.execute(prompt)                                 # agent.py:279   (LLM #1)
    {reply, focus, plans, summary} = Planner.parse_response(plan)   # agent.py:282   (line parser)
    update_contextual_keywords(focus)                              # agent.py:292   (KeyBERT, local)
    InternalMonologue.execute(current_prompt=plan)                 # agent.py:295   (LLM #2, cosmetic)
    research = Researcher.execute(plan, keywords)                  # agent.py:302   (LLM #3)
    if research.ask_user != "":                                    # agent.py:323
        set_agent_active(false)
        while not got_user_query:                                  # agent.py:328-339
            poll project_manager.get_latest_message_from_user()    # BLOCKING poll, sleep(5)
    for q in research.queries:                                     # agent.py:93-116
        web_search.search(q); link = get_first_link()              # first link only
        browser.goto(link); screenshot; extract_text
        results[q] = Formatter.execute(page_text)                  # LLM #4..N
    code = Coder.execute(plan, user_context, search_results)       # agent.py:349   (LLM, one shot)
    Coder.save_code_to_project(code)                               # agent.py:357   writes files
    set_agent_active(false); set_agent_completed(true)             # agent.py:359-360
```

Follow-up pipeline — `src/agents/agent.py:179-268`. One classifier call, then one handler:

```
subsequent_execute(prompt, project_name):
    conversation   = ProjectManager.get_all_messages_formatted(project)  # agent.py:192 — FULL history
    code_markdown  = ReadCode(project).code_set_to_markdown()            # agent.py:193 — WHOLE repo
    response, action = Action.execute(conversation)                      # agent.py:195 — LLM router
    match action:                                                        # agent.py:201-265
        "answer" -> Answer.execute(conversation, code_markdown)
        "run"    -> Runner.execute(...)          # spawns subprocess, see below
        "deploy" -> Netlify().deploy(project)
        "feature"-> Feature.execute(...) ; save_code_to_project
        "bug"    -> Patcher.execute(...) ; save_code_to_project
        "report" -> Reporter.execute(...) ; PDF().markdown_to_pdf(...)
    set_agent_active(false); set_agent_completed(true)                   # agent.py:267-268
```

The only real feedback loop is in the runner — `src/agents/runner/runner.py:69-197`:

```
run_code(commands, ...):
  retries = 0
  for command in commands:
      out, failed = subprocess.run(command.split(" "), cwd=project_path)   # runner.py:85-92
      while failed and retries < 2:                                        # runner.py:102
          resp = LLM(rerunner_prompt(conversation, code, commands, error)) # runner.py:111-119
          if resp.action == "command":  run resp.command; if failed: retries+=1 else break
          if resp.action == "patch":    Patcher.execute(...); save; re-run; retries+=1 / break
```

**Termination.** Nothing evaluates whether the goal was achieved. `execute` terminates when the
Coder returns parseable output; `subsequent_execute` when its one handler returns. "Done" is
`set_agent_completed(project, True)` (`agent.py:360`, `agent.py:268`) — a bookkeeping flag, not a
verdict. The retry loop terminates at `retries < 2` (`runner.py:102`); a still-failing command is
simply abandoned with no error surfaced. `retry_wrapper` (`src/services/utils.py:9-26`) retries an
LLM call 5 times on unparseable output and then calls **`sys.exit(1)`** — killing the whole server
process. `LLM.inference` also calls `sys.exit()` on inference timeout or any exception
(`src/llm/llm.py:139`, `llm.py:145`).

Browser interaction is a third, separate loop capped at 5 iterations —
`src/browser/interaction.py:532`: `while True and visits < 5`.

## 3. Modes

No plan/ask/agent mode selector. The separation of thinking from doing is by **agent role**, not
by mode:

- Planning is a distinct agent whose output is a checklist parsed into `{step_no: text}`
  (`src/agents/planner/planner.py:19-66`). It never executes.
- `Action` (`src/agents/action/prompt.jinja2`) is the mode router on follow-up turns: the LLM picks
  exactly one of `answer | run | deploy | feature | bug | report`, and the prompt insists "The
  action can only be one … you should only take one optimal action" (`action/prompt.jinja2:29`).
- `Decision` (`src/agents/decision/prompt.jinja2`) is an alternative first-turn router emitting a
  *list* of function calls (`git_clone`, `generate_pdf_document`, `browser_interaction`,
  `coding_project`). **`make_decision` (`agent.py:128-177`) is dead code** — nothing calls it, its
  `git_clone` branch is an empty comment (`:138-140`), and `:160` reads `self.base_model`, which
  `Agent.__init__` never sets (`:37-67`) — it would `AttributeError`.
- `answer` is the closest thing to an ask mode: read-only Q&A over conversation + full code.
- `InternalMonologue` (`src/agents/internal_monologue/prompt.jinja2`) is a whole extra LLM call
  whose only job is to produce a human-sounding sentence for the UI. It feeds nothing.

## 4. Context window

Every agent builds its prompt by rendering one Jinja2 template from disk, read once at import
(`PROMPT = open("src/agents/planner/prompt.jinja2").read().strip()`, `planner.py:5`). There is no
message array — **every call is a single user string**, stateless, no system/assistant roles
(`LLM.inference(prompt, project_name)`, `llm.py:92`).

What goes in, per agent:

| Agent | Prompt contents (in template order) |
|---|---|
| Planner | user prompt only (`planner/prompt.jinja2:3`) |
| Researcher | plan, then `contextual_keywords` (`researcher/prompt.jinja2:8,26`) |
| Coder | `step_by_step_plan`, `user_context`, `search_results` (`coder.py:28-32`) |
| Action | full conversation, then `conversation[-1]` restated as "User's last message" (`action/prompt.jinja2:4-9`) |
| Runner/Rerunner | conversation, full code markdown, OS, commands tried, error text (`runner/rerunner.jinja2:3-29`) |
| Patcher/Feature/Answer | conversation, full code markdown, OS |

**No compaction, no summarisation, no truncation, anywhere.** `get_all_messages_formatted`
(`src/project.py:115-128`) returns every message ever, formatted `"Devika: …"` / `"User: …"`.
`ReadCode.code_set_to_markdown` (`src/filesystem/read_code.py:28-35`) walks the entire project
directory and inlines every readable file into one markdown blob. Both are passed whole on every
follow-up turn. The single exception is the browser agent, which hard-slices page content:
`prompt.replace("$browser_content", browser_content[:4500])` (`interaction.py:499`). Token usage is
*counted* with tiktoken and emitted to the UI (`llm.py:84-90`) but never used to trim anything.

**Persistent memory** — three SQLite tables, all in `data/db/devika.db`:

1. `Projects.message_stack_json` — the conversation, append-only JSON blob rewritten in full on
   every message (`src/project.py:47-59`).
2. `agent_state.state_stack_json` — a stack of state dicts, each `{internal_monologue,
   browser_session{url,screenshot}, terminal_session{command,output,title}, step, completed,
   agent_is_active, token_usage, timestamp}` (`src/state.py:25-45`), appended per observable event
   (`state.py:65-78`). This is the projection the UI renders. It is a real event log — but it is
   written for display, and the agent reads back from it only `get_latest_state(...)
   ["browser_session"]` (`coder.py:96-98`).
3. `Knowledge(tag, contents)` — a keyword→search-result cache (`src/memory/knowledge_base.py`).
   **Both call sites are commented out** (`agent.py:96-99`, `agent.py:115`), with the file's own TODO
   admitting "The tag check should be a BM25 search, it's just a simple equality check now."

Cross-turn continuity is therefore: conversation text + the files on disk. Nothing else.
`src/memory/rag.py` is a 2-line docstring: `"""Vector Search for Code Docs + Docs Loading"""`.

## 5. Tools

There is no tool registry and no tool-calling loop. "Tools" are Python methods the pipeline calls
in a fixed order, and two prompt-level command vocabularies.

Real capabilities:

- **Web search** — Bing / Google CSE / DuckDuckGo by string (`agent.py:84-89`). Only
  `get_first_link()` is used (`agent.py:106`): one page per query, max 3 queries.
- **Headless browser** — Playwright `go_to` / `screenshot` / `extract_text` (`src/browser/browser.py`).
- **Browser driving** — vendored natbot (`interaction.py:1-6`), command language is **free text
  lines**: `SCROLL UP|DOWN`, `CLICK X`, `TYPE X "TEXT"`, `TYPESUBMIT X "TEXT"`
  (`interaction.py:24-29`), parsed by `str.startswith` (`:503-523`). DOM flattened to
  `<link id=1>text</link>` pseudo-HTML by `Crawler.crawl` (`:231+`).
- **Shell** — `subprocess.run(command.split(" "), cwd=project_path)` (`runner.py:85-90`). No shell,
  no PTY, no timeout, no sandbox; `stderr` piped and never decoded (`runner.py:91`).
- **File write** — `save_code_to_project` (`coder.py:68-80`), whole-file overwrite. No read-file,
  edit-file, list-dir or grep tool; the model gets the whole repo as text instead.
- **PDF** (`src/documenter/pdf.py`), **Netlify deploy** (`src/services/netlify.py`), **KeyBERT
  keyword extraction** (`src/bert/sentence.py`). `git_clone` is an unimplemented comment
  (`agent.py:138-140`).

Calling convention: **JSON in a fenced block, coerced by brute force.** Each agent declares its own
schema in its template ("Any response other than the JSON format will be rejected by the system")
and validates with the `@validate_responses` decorator (`src/services/utils.py:32-90`), which tries
four parses in order: whole string as JSON → the text between the first pair of ``` fences → the
substring from first `{` to last `}` → each line individually. Failure returns `False`, which
`@retry_wrapper` (`utils.py:9-26`) treats as "retry, up to 5, then `sys.exit(1)`".

The Coder and Patcher do **not** use JSON. The Coder emits a `~~~`-delimited block of
`File: path` + fenced code, parsed line-by-line (`coder.py:34-66`); the Patcher's variant expects
the filename in backticks (`patcher.py:...`, `current_file = line.split("\`")[1]`).

Registering a new tool: write a Python class with `render`/`validate_response`/`execute`, add its
`prompt.jinja2`, import it (`src/agents/__init__.py`, `agent.py:1-12`), instantiate it
(`agent.py:51-62`), add an `elif` in `subsequent_execute` and a bullet in `action/prompt.jinja2`.
Four files minimum, all hand-wired.

Permission model: **none.** No allowlist, no confirmation, no sandbox. `src/sandbox/firejail.py`
and `src/sandbox/code_runner.py` are 0-byte files. Arbitrary LLM-authored commands run as the
server user in the project directory.

## 6. Loop strategies

- **Planning**: yes, one shot, as a numbered `- [ ] Step N:` checklist parsed into a dict
  (`planner.py:52-57`). The plan is passed as a *string* to the Researcher and Coder; the parsed
  step dict is only used for display (`agent.py:289`). Nothing tracks per-step completion.
- **Reflection**: none. `InternalMonologue` is narration for the UI, not self-critique
  (`internal_monologue/prompt.jinja2:9`).
- **Retry on malformed output**: 5 attempts per agent call (`utils.py:12`).
- **Retry on runtime failure**: 2 attempts, and the rerunner prompt asks the model to **attribute**
  the failure — "identify whether this error is caused by the code or the command"
  (`rerunner.jinja2:31`) — then routes to either a corrected command or the Patcher
  (`runner.py:126-197`). This attribution split is the single best idea in the repo.
- **Verification**: none beyond exit code. Nothing runs tests; nothing re-checks the plan.
- **Sub-agents**: no. The 12 "agents" are sequential prompt templates inside one thread.
- **Parallelism**: no. One `threading.Thread` per user message (`devika.py:89`). Searches are
  sequential (`agent.py:93`), and each opens a *fresh* asyncio event loop inside the for-body
  (`agent.py:101-102`).
- **Human-in-the-loop**: yes — the Researcher may return a non-empty `ask_user`, suspending the
  pipeline until the user replies (`agent.py:323-339`). 5-second SQLite poll, but the *contract*
  (a worker declaring "I need this from you" inside a typed response) is sound.

## 7. Configuring a new agent

**You cannot.** Agents are hardcoded Python classes; there is no declarative agent format, no
registry file, no per-agent model/temperature. The only user-facing configuration is one TOML file
covering storage paths, API keys, endpoints, logging and a single timeout —
`sample.config.toml`, verbatim and complete:

```toml
[STORAGE]
SQLITE_DB = "data/db/devika.db"
SCREENSHOTS_DIR = "data/screenshots"
PDFS_DIR = "data/pdfs"
PROJECTS_DIR = "data/projects"
LOGS_DIR = "data/logs"
REPOS_DIR = "data/repos"

[API_KEYS]
BING = "<YOUR_BING_API_KEY>"
GOOGLE_SEARCH = "<YOUR_GOOGLE_SEARCH_API_KEY>"
GOOGLE_SEARCH_ENGINE_ID = "<YOUR_GOOGLE_SEARCH_ENGINE_ID>"
CLAUDE = "<YOUR_CLAUDE_API_KEY>"
OPENAI = "<YOUR_OPENAI_API_KEY>"
GEMINI = "<YOUR_GEMINI_API_KEY>"
MISTRAL = "<YOUR_MISTRAL_API_KEY>"
GROQ = "<YOUR_GROQ_API_KEY>"
NETLIFY = "<YOUR_NETLIFY_API_KEY>"

[API_ENDPOINTS]
BING = "https://api.bing.microsoft.com/v7.0/search"
GOOGLE = "https://www.googleapis.com/customsearch/v1"
OLLAMA = "http://127.0.0.1:11434"

LM_STUDIO = "http://localhost:1234/v1"
OPENAI = "https://api.openai.com/v1"


[LOGGING]
LOG_REST_API = "true"
LOG_PROMPTS = "false"

[TIMEOUT]
INFERENCE = 60
```

`Config` is a singleton that copies the sample on first run and back-fills any missing keys from it
(`src/config.py:5-38`) — a nice touch: config migration for free, no versioning needed.

The model catalogue is a hardcoded dict of `(display name, model id)` per provider
(`src/llm/llm.py:33-69`), with Ollama's list populated at runtime from the daemon (`llm.py:70-71`).
The user picks *one* `base_model` in the UI and **every** agent in the pipeline uses it
(`Agent.__init__`, `agent.py:51-62`). No per-role model routing.

## 8. Spaces and artifacts

**Filesystem**: one directory per project, `data/projects/<name-lowercased-hyphenated>`
(`coder.py:70`, `project.py:130-131`), named from the LLM's own "Project Name:" line. No VFS, no
per-agent isolation, no snapshots. Path traversal unguarded on write (`file['file']` joined straight
onto the project dir, `coder.py:73`); `get_project_files` does check `commonprefix` on read
(`project.py:148-149`).

**Shared state between agents**: three channels, all global-ish —
(a) the SQLite conversation, which every follow-up agent receives whole;
(b) the project directory, which `ReadCode` re-serialises into every prompt;
(c) `Agent.collected_context_keywords`, an in-memory list of KeyBERT keywords accumulated from the
plan's "Current Focus" line and injected into the Researcher's prompt (`agent.py:46`, `:118-126`,
`:302`). It dies with the `Agent` object, which is reconstructed per socket message
(`devika.py:85`) — so in practice it is always the keywords from this turn only.

**Artifacts**: three kinds, each surfaced by a different mechanism.
- *Code* — written to disk, and pushed to the UI by `emulate_code_writing` (`coder.py:90-112`):
  one state entry per file, `terminal_session.command = "vim <file>"`, code as `output`,
  `sleep(2)` between files, then a `code` socket event. Theatre — but it does mean the file view is
  a projection of the same state stack as everything else.
- *PDF* — `Reporter` produces markdown, `PDF().markdown_to_pdf` renders it to `data/pdfs/<project>.pdf`
  (`agent.py:253-265`), and the user gets a plain download URL in chat.
- *Screenshots* — captured per page visit and emitted as a `screenshot` socket event with raw bytes
  (`agent.py:111`), also stored in the state stack's `browser_session`.
- *Zip* — `project_to_zip` (`project.py:133-145`) for download; `Netlify().deploy` for hosting.

## 9. What it gets RIGHT that HARNESS lacks

Ranked by value per unit of work.

1. **Error attribution before repair** (small) — `crates/agent/step.rs` or a new
   `crates/agent/repair.rs`. On a non-zero exit from `WorkspacePort::exec`, don't hand the raw
   failure back to the loop. Make one narrow LLM call whose only output is
   `{"action": "command"|"patch", ...}` — "is this the *invocation* or the *code*?"
   (`rerunner.jinja2:31`). A wrong command re-run costs one exec; a wrong patch costs a rewrite plus
   a rebuild. HARNESS has no typed distinction, so the model burns rounds editing source when the
   fix was a missing flag. Cap at 2 like `runner.py:102`.
2. **`ask_user` as a field of a structured agent response** (small) — `crates/agent/step.rs` +
   `crates/kernel` Response variant. Devika's Researcher returns
   `{"queries": [...], "ask_user": "<... or empty string>"}` (`researcher/prompt.jinja2:13-16`) and
   the pipeline suspends on a non-empty value (`agent.py:323`). HARNESS's seam is
   `handle(Request) -> Response`; add a `Response::AwaitingUser { question }` so a *sub-agent* in
   its own Worker can block for input without the parent inventing a protocol. Devika polls SQLite
   every 5s; HARNESS should park on the event log instead.
3. **The plan as a parsed, addressable checklist** (medium) — `crates/agent/phase.rs` +
   `crates/core` projection. Devika parses `- [ ] Step N: …` into `{n: text}`
   (`planner.py:52-57`) but then throws it away and passes the plain string to the Coder
   (`agent.py:349`). Do the half they didn't: keep `Vec<PlanStep{id, text, status}>` in the event
   log, render it as a UI projection, and put *only the current step plus the plan outline* in the
   Coder's context. This is the concrete shape of HARNESS's stated "goal→plan→implement→test→verify".
4. **A per-observable-event state stack that IS the UI** (medium, mostly already present) —
   `crates/core`. `new_state()` (`state.py:25-45`) is a flat record with slots for
   `internal_monologue`, `browser_session`, `terminal_session`, `token_usage`, `step`; every agent
   appends one and the whole stack is pushed to the client (`state.py:78`). Copy the *discipline*:
   a tool has not run until it appended a state entry carrying its command and output. Devika
   carries the previous browser session forward across a code-write entry (`coder.py:98`) so UI
   panes don't flicker.
5. **A one-shot classifier that routes the follow-up turn** (small) — `crates/agent/toolbox.rs` or
   a `mode` field on the agent frontmatter. `action/prompt.jinja2` picks exactly one of
   `answer|run|deploy|feature|bug|report`. HARNESS wants "plan/ask/agent modes like GitHub VS Code
   agents": this is the cheapest implementation — one cheap-model call returning
   `{"response", "action"}`, and each action is a different toolset, not a different loop.
6. **Config self-migration from a checked-in sample** (small) — `crates/adapters_web` config load /
   `public/agents/index.json`. `Config._load_config` (`config.py:14-38`) copies `sample.config.toml`
   if absent, else back-fills every missing key and sub-key from the sample and rewrites the file.
   No schema version, no migration code, ~20 lines. HARNESS's "portability and easy configuration"
   goal gets this for free.
7. **Multi-tier JSON coercion with a hard retry budget** (small) — `crates/context/openai.rs` or a
   `crates/agent/parse.rs`. Four escalating parses (raw → fenced → first-`{`-to-last-`}` →
   per-line) before giving up (`utils.py:32-90`), wrapped in a 5-try budget (`utils.py:9-26`).
   HARNESS needs the ladder and the budget; it must **not** copy the `sys.exit(1)` — that's item 2
   of §10.
8. **Search results summarised before they enter context** (small) — `crates/agent/tools.rs`. Devika
   never inlines a raw page: `results[query] = self.formatter.execute(data, project_name)`
   (`agent.py:112`) runs a dedicated Formatter agent over the extracted text first. A cheap
   distillation call per fetched page is the difference between a usable window and a blown one.
9. **PDF as a first-class artifact path** (small) — `crates/agent/tools.rs` + `crates/ui`. markdown →
   HTML → PDF, written to a known dir, surfaced as a download link (`documenter/pdf.py`,
   `agent.py:253-265`). HARNESS's "artifacts (PDF, doc, image, video)" goal wants exactly this
   pipeline; in-browser it is markdown → HTML → print-to-PDF, no dependency.
10. **The role catalogue itself** (medium) — seed `public/agents/`. planner / researcher /
    formatter / coder / runner / patcher / feature / reporter / answer / action is a sound
    decomposition of a coding task. Devika half-externalises it (`PROMPT = open(".../prompt.jinja2")`,
    `planner.py:5`) but keeps class, parser and wiring in Python; HARNESS's
    markdown-with-frontmatter is strictly better — take the list, not the mechanism.

## 10. What would be a MISTAKE to copy

- **`sys.exit(1)` as error handling.** `utils.py:23` kills the entire server when a model returns
  five bad JSON responses; `llm.py:139` and `llm.py:145` do the same on timeout or *any* exception.
  A parse failure in a sub-agent takes down every other project. This is the anti-pattern HARNESS's
  typed-errors rule exists to prevent.
- **Whole-repo-in-every-prompt.** `read_code.py:28-35` inlines every file on every follow-up turn;
  `project.py:115` inlines every message ever. No truncation, no budget — the token counter only
  displays a number (`llm.py:84-90`). This is why HARNESS has `compact_at`/`keep_recent`.
- **A straight-line pipeline with no loop.** Plan → research → code → done. One shot at the code,
  no test, no verification. Devika cannot fix its own output unless the user types "run".
- **Fake progress theatre.** `emulate_code_writing` sleeps 2s per file and prints `vim <file>` to
  the terminal pane (`coder.py:90-108`); `InternalMonologue` spends a whole LLM call on a sentence
  with no downstream consumer (`agent.py:295`). Both cost real money to simulate work.
- **`subprocess.run(command.split(" "))`** (`runner.py:85`) — breaks on any quoted argument, no
  timeout, and `stderr` piped then never decoded (`:91`), so the rerunner is routinely asked to
  diagnose an empty error string.
- **No sandbox, at all.** Empty `src/sandbox/*.py`; model-authored commands run as the server user.
- **Search = first link only** (`agent.py:106`), max 3 queries. One SEO-spam result poisons context.
- **One model for all twelve roles** (`agent.py:51-62`). HARNESS's per-agent `model` frontmatter is
  the fix; keep it.
- **Blocking 5s SQLite poll for user input** (`agent.py:328-339`) — keep the contract (§9.2), drop
  the mechanism.
- **Line-prefix parsing of LLM prose.** `Planner.parse_response` (`planner.py:31-59`) dispatches on
  `line.startswith("Project Name:")`; Coder and Patcher have two already-divergent parsers for the
  same code-block shape. `Planner.validate_response` is `return True` (`planner.py:16-17`).
- **Dead and stub code shipped as features.** `make_decision` is unreachable and would `AttributeError`
  on `self.base_model` (`agent.py:160`); the knowledge base's only two call sites are commented out
  (`agent.py:96-99`, `:115`); `src/experts/` contains a file literally named `__UNIMPLEMENTED__`;
  `rag.py` is a docstring. Devika's star count comes from a demo video, not from this code.

## 11. Citations

Every claim above carries an inline `file.py:line` from commit `80bb343`. The non-obvious ones,
gathered:

- Repo state: `git log -1` → `80bb343cbe4a4e5f5a0ba08d2524920139baceb6 2025-09-25 14:17:36 +0530`;
  GitHub API `archived: false`, `pushed_at: 2025-09-25`, 19560 stars, 196 open issues.
  `README.md:1` "Checkout Opcode, the second iteration of Devika."; `README.md:14` "currently in a
  very early development/experimental stage. There are a lot of unimplemented/broken features."
- `make_decision` is unreachable: `devika.py:77-103` is the only dispatch site and calls only
  `agent.execute` / `agent.subsequent_execute`; and `agent.py:160` reads `self.base_model`, which
  `Agent.__init__` (`agent.py:37-67`) never assigns.
- stderr is captured and dropped: `runner.py:85-90` pipes it, `runner.py:91` decodes
  `process.stdout` only, and `rerunner.jinja2:27-29` interpolates that value as `error`.
- Knowledge base is inert: both call sites commented out at `agent.py:96-99` and `agent.py:115`;
  `src/memory/knowledge_base.py:6-8` "the tag check should be a BM25 search".
- Stub inventory by `wc -c`: `src/sandbox/firejail.py` 0, `src/sandbox/code_runner.py` 0,
  `src/documenter/uml.py` 0, `src/documenter/graphwiz.py` 0, `src/experts/__UNIMPLEMENTED__` 0;
  `src/memory/rag.py` is a 2-line docstring.
- No compaction anywhere: the only slice in the codebase is `interaction.py:499`
  (`browser_content[:4500]`); `read_code.py:28-35` and `project.py:115-128` are unbounded; token
  counting at `llm.py:84-90` feeds only `emit_agent("tokens", ...)`.
- `Planner.validate_response` is `return True` (`planner.py:16-17`); the Coder parses `~~~` +
  `File: ` (`coder.py:34-66`) while the Patcher expects the filename in backticks
  (`patcher.py:56`, splitting the line on a backtick and taking index 1).
