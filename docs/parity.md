# Parity with the archived build (archive/docs)

| archived feature | new build | status |
| --- | --- | --- |
| Engines folder → objects at boot | `core/boot.rs` scan/init, boot at process start | done |
| Element kinds with config + state, saved each step | `core::Component`, `elements/*` | done (8 kinds) |
| Restart resumes; crash → `interrupted` | save hook + `init` | done |
| Models file, default model, runtime switch | `host/infer/`, `data/models.json` | done |
| Methods: openai (any compatible server, base url + token env), cli | `host/infer/connectors.rs` | done |
| Sampling presets per engine / phase, switch tool | `elements/sampling.rs` | done |
| Discover models from a URL | Models page *Find models* | done |
| Tools trait + registry | `core/tool.rs`, shared tools in `host/tools.rs` | done |
| TOON / JSON reply, several calls per reply | `elements/handoff.rs` | done |
| Phases steer focus and gate tools | `elements/phase.rs` | done |
| Sub-engines | folders; engine is a tool | done |
| UI from object views, primitives only | `ui::render::Render`, `view()` | done |
| Glass design (wall → pane → glass) | `assets/styling/glass.css` | done (tokens in CSS, not yet editable) |
| Live artifacts, alerts, scripts | `elements/artifact|alert|script.rs` | new |
| Non-blocking calls | all calls of a reply start together; `await: any` continues after the first (rest cancelled) | done |
| Refocus at 90% context | tokens: engine override, else model `context`, else discovered from the server listing; model summarises essentials + lessons; history keeps summary + last 4 turns; refocus at 90% of input budget, prompt/history shares observed (context − max_tokens), refocus prompt keeps notes/phase/state/history only | done |
| Stop a running engine | `stop()` before next step, status `stopped`; Stop button | done |
| Live updates | long-poll `wait_change` on a per-engine change counter | done |
| Theme editing from the UI | `data/theme.json` → `:root` vars; Theme page | done; layout too: `data/layout.json` (columns, engine order, hidden kinds), Layout page |
| sandbox-exec for the server | `sandbox/server.sb`, `scripts/sandboxed.sh` | done (boot, pages, HTTPS quotes, claude CLI call verified) |
| Desktop | `dx serve --platform desktop` builds Askk.app; server boots | built + launched; window check skipped by owner (web is the target for now) |
| Folder routing | `data/routes/**/page.json`, `[param]`, `[...rest]`, nav from pages; `create_view` tool | done |
| Max tokens 32k | `models.json max_tokens` → `{max_tokens}` in bodies | done |
| Real model | default `claude` (cli runtime) answers live: askk ran create_view, set_phase, stamp script against it | done |
| Prompt order | `core::Slot`: purpose → knowledge → tools → format → position → world → conversation → other → input → nudge (`Component::nudge`; config `nudge`, "off" = none); each element picks its slot, by name within; `Engine::sections` | done |
| Phases as focus | `phase`: ordered phases with focus, instructions, expect (outcomes), goal, tools?, elements?; `phase_done {met}` advances one step only with evidence; `repeat`; separate `focus` note retired | done |
| Default developer tools | `src/host/workspace.rs`: read_file, write_file, list_dir, run, spawn/jobs/stop, alarm, create_script, parallel; rooted at `ASKK_WORKSPACE` | done; askk ran parallel(list_dir, run), spawn → jobs → stop live via claude CLI |
| Load another desk | `--desk <dir>` (or `ASKK_DATA`) points engines, models, routes and theme at another folder | done |
| Chat dashboard | `/` = `view chat`: askk chat beside its current prompt (colour per section kind, token bar, sections, full text); old dashboard at `/engines` | done |
| Engine state files | `notes` element + `config.file`: goal.md, focus.md, learning.md (sections via `learn`) | done; askk set focus.md and learnt into learning.md live |
| TOON replies | `handoff` default `toon`; tolerant parser; JSON fallback | done; claude CLI replied in TOON live |
| Object views + live activity | `render(size)` icon/small/medium/large on every component and engine; engine activity idle/thinking/calling/refocusing/stopped/error with CSS effects; catalog by category | done; chat header showed idle → thinking → calling run → thinking → idle live |
| Responsive glass shell | panel / icon rail / phone routes button + sheet; collapse lives in the panel header; nav icons from page.json; design rules (AAA contrast, 44px targets, focus ring, motion) | done; checked at 1440, 1000, 390px |
| Sizes small/medium/large on archive design rules | live icon with orb, 6×4 card with ability icons, full state view; Amarante; long-press layout edit; Home/Chat/PRs/Components/Settings | done; checked in browser |
| Short history (last 25 inputs/replies, tool results shown once) + list notes (`note`/`done`) | `elements/history.rs`, `elements/notes.rs` | done |
| Configurable reply fields (plan first, custom `{name, about}`) | `elements/handoff.rs` | done |
| Core free of kind names; engine templates | `Component::category/icon/slot` + roles; `create_engine` copies `data/templates/<name>`; see architecture.md | done |
