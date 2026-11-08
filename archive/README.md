# Askk

(The repository folder is still named `powerhouse`; the app, crates and docs are Askk.)

One default engine, **Askk**, whose **phases** (chat, research, build) you switch from the text area at the foot of
the dashboard. Engines come from a configuration folder. An **engine** is a folder; what it can do is exactly the
elements it holds — a **model**, a **loop**, **phases**, **tools**, **memory**, notes — and the UI draws
exactly that: an engine with no tools element says "No tools". Nothing is hardcoded: the backend
(Rust) reads the folder, keeps each object's live state, and sends every object with its own views;
the frontend (SvelteKit + Svelte 5) only places those views. Everything is rebuilt from the folder at
start, so state survives a restart. When a loop's prompt reaches 90 % of the model's context budget it
**refocuses**: the history is folded into its essentials and the lessons go to memory.

## Requirements

- [bun](https://bun.sh) (UI toolchain and scripts)
- [Rust](https://rustup.rs) stable (core + server)

```sh
bun install
```

## Run

```sh
bun run start
```

Builds the UI into `build/`, then runs the release server on one port serving both the UI and the
API: open <http://127.0.0.1:4600>. Data lives in `./data` (created and seeded on first start).
Ctrl-C stops cleanly; the next start carries on from the saved state.

Other folders/ports: `cargo run --release -p askk-server -- --data <folder> --port <n> --ui build`.

## Develop

```sh
bun run app         # desktop window + sandboxed backend; the same UI at http://127.0.0.1:4600 in any browser
bun run test        # cargo tests (core + server) and bun tests (src/)
scripts/lifecycle.sh  # run → act → stop → restart → kill -9 → restart on a throwaway folder
```

`bun run app` builds the UI and `askk-server`, then the Tauri shell starts the server under
`sandbox-exec` (`sandbox/profiles/server.sb`: repo read-only, data/engines read-write, loopback
listen, outbound HTTPS only) and opens a window on it. Env: `ASKK_DATA` (default `data`),
`ASKK_ENGINES`, `ASKK_PORT` (4600), `ASKK_SANDBOX=0` (no sandbox, to debug denials).
Engine and UI files hot-reload while it runs; a change to `src/` needs a restart.

## The UI

Everything is a **card**. Every object (engine or element) sends four views of itself — `icon`, `small`
(overview), `medium` (expanded), `large` (intense) — each a Node tree rooted in a Card, plus a live `status`
(`{light, now, since}`: a phase-coloured light, one line of what it does now, since when). The UI picks each card's
size from the space it gets, the device and the canvas zoom; the − / + on every card steps it, remembered per
object. Size changes morph in place, status changes cross-fade, the light pulses while running (all off under
reduced motion).

Each page is itself a tree, `data/ui/<view>.json`, rendered by the same primitives plus `Page`, `Panel`,
`CardGrid`, `Canvas`, `Background`:

```json
{ "c": "Page", "props": { "background": { "image": null, "fields": [{ "at": [1, 1], "size": "md", "color": "wall-a", "hard": true }], "wash": true, "ripples": true, "tint": null, "blur": 0, "dim": 0 } },
  "children": [{ "c": "Panel" }, { "c": "CardGrid", "props": { "source": "engines", "size": "auto", "min": "md", "gap": 4, "children": { "size": "small" } } }] }
```

Edit the file (it hot-reloads) or Unlock → Page: background image (URL or upload), fields, ripples, tint, blur,
dim, grid min/gap, canvas grid/minimap/edges, with live preview. Trees name **scale steps only** (gap 0–6, text
xs–xl, width/field/radius steps, tone names): a raw px, %, hex or font name is refused. Every value comes from one
token file, `design/tokens.json` (`bun scripts/tokens.js` regenerates the app.css block). An engine may set
`children: { size: small, kinds: { loop: { size: large } } }` in its engine.md: the default size of its cards
(the cascade, contract §6). Rules: `docs/design-rules.md` §1, §6, §10, §11; contract §2/§5/§6.

## The data folder

```
data/
  engines/<id>/engine.md          an engine: frontmatter + body (its description, read by the model)
  engines/<id>/elements/<eid>.md  its elements, any kind
  engines/<id>/engines/<cid>/…    child engines, same shape, any depth
  state/<object id>.json          live state {phase, state}, written by the app only
  layout/dashboard.json           card order + remembered card sizes; layout/canvas.json positions + sizes
  ui/dashboard.json, ui/canvas.json  each page as a component tree (background, panel, grid / canvas)
  ui/assets/                      background images a page tree names (served at /ui/assets/…)
  theme.json                      design tokens (light + dark)
  runtime.json                    boots, last exit (clean | crash)
  workspace/<engine id>/          files the engine's files.read tool may read
```

Edit any `.md` while the server runs: it hot-reloads; a file that does not load shows as a failed
object naming the file, the rest keeps running. A `.md` may also carry `state:` and `phase:` — the
object's starting state when nothing is saved for it (`docs/contract.md` §1).

## Add an engine or element by file

```md
<!-- data/engines/research/engine.md -->
---
title: Research
kind: engine
order: 3
model: claude-cli   # a slug from models/, an inline {connector, id, …}, or omit for the desk default
---
Reads the workspace and answers questions about it.
```

```md
<!-- data/engines/models/claude-cli.md  (the desk's model library; desk.md names the default) -->
---
title: Claude (CLI)
config: { connector: claude-cli, id: sonnet, context: 400000 }
---
```

```md
<!-- data/engines/research/elements/loop.md -->
---
title: Loop
kind: loop
config: { max_steps: 8, refocus: 0.9, keep: 2 }
---
```

```md
<!-- data/engines/research/elements/tools.md -->
---
title: Tools
kind: tools
config: { list: [files.read, note.write] }
---
```

## Phases, modes and workflows

A phase is the unit: an entry of the phases element (`data/engines/askk/elements/phases.md`):

```yaml
config: { list: [{id: research, title: Research, icon: "🔎", tools: [files.read, clock.now, help.ask],
                  instructions: "Find out before answering …"}, …] }
```

The phase you select is the **mode**: its tools are what the loop may call and its instructions go under the
prompt's `# PHASE` section; the model, loop history and memory stay. A **workflow** runs phases in a fixed order —
`elements/workflows.md`: `config: { list: [{id: study, phases: [research, build]}] }` — each answer the next
phase's input, then the engine returns to the mode you had.

## The composer

The dashboard and canvas page trees end in a `Composer` (contract §6): Enter sends the text to the default
engine's loop (`run {input}`), Shift+Enter is a newline, the phase chips switch the mode, Stop cancels a run, and open
asks show above it as reply chips; Run workflow runs the text through a workflow. The page tree's `default: "askk"`
names the engine it talks to and the one the dashboard centres on.

## Card sizes

Cards are widgets on a grid of square cells: icon 1×1, small 2×2, medium 4×2, large 4×4. A card keeps its
footprint; long content scrolls inside it.

Every object has an avatar: set `icon: 🧭` in any `.md` (one emoji, or `/ui/assets/<image>`), else its kind's default.

Element kinds: `note`, `counter`, `status`, `meter`, `timer`, `model`, `loop`, `phases`, `tools`,
`memory`, `workflows` (table in `docs/contract.md` §4). Leave out `tools` and the engine has none. The same can be
done from the UI: Unlock → + Element / + Engine / Edit / Remove (forms built from each kind's config).

## A real model

Set the model element's `config`:

- Claude through its CLI (uses your logged-in `claude`):
  `{ connector: claude-cli, id: sonnet, context: 400000 }`
- An OpenAI-compatible server: `{ connector: openai, id: gpt-4o-mini, base_url: "https://api.openai.com/v1", key_env: OPENAI_API_KEY, context: 400000 }`
- Anthropic API: `{ connector: anthropic, id: claude-sonnet-4-5, key_env: ANTHROPIC_API_KEY }`

`key_env` is the **name** of an environment variable; the key is read at call time and never stored
in files, state, views or prompts. Export it before `bun run start`. The model's **Test** action makes
one short call; its card shows the connector, budget, whether the key is set and the last call.

## Sandbox

`sandbox/` holds Seatbelt profiles and `sandbox/run.sh` for running jobs (e.g. MLX) confined to a
workspace; see `docs/sandbox-exec.md`.

## Docs

- `docs/contract.md` — the one agreement: folder, objects, wire format, kinds, primitives, view rules
- `docs/design.md` — why: lifecycle, storage, async model, the loop and refocus (§7)
- `docs/design-rules.md` — the look: tokens, glass, typography, accessibility
- `docs/translation.md` — owner decisions

## Desktop

`src-tauri/` builds (`cargo build -p askk`) but is not wired further yet.

## Engine configurations

The server picks its engines folder in this order (the first one that applies wins; the boot line says which):

1. `--engines <dir>`, a command-line flag
2. `ASKK_ENGINES=<dir>`, an environment variable
3. `./engines/`: yours, gitignored, used when it holds at least one `<id>/engine.md`
4. `<data>/engines/`: if it is empty, it is first filled with a copy of `./defaults/engines/` (committed, never written to), or with the built-in seed if that is missing too

To try different setups, keep one folder per configuration and point at it:

```sh
ASKK_ENGINES=engines/research bun run start   # engines/research/<id>/engine.md …
cargo run -p askk-server -- --data data --engines path/to/config
```

Writes made from the UI (adding elements, notes) go to the chosen folder. State always stays under `<data>/state`.
