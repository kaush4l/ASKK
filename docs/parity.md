# Parity with the archived build (archive/docs)

| archived feature | new build | status |
| --- | --- | --- |
| Engines folder → objects at boot | `core/boot.rs` scan/init, boot at process start | done |
| Element kinds with config + state, saved each step | `core::Component`, `elements/*` | done (8 kinds) |
| Restart resumes; crash → `interrupted` | save hook + `init` | done |
| Models file, default model, runtime switch | `infer/`, `data/models.json` | done |
| Connectors: openai, responses, anthropic, CLI, echo | `infer/connectors.rs` (generic `cli`) | done |
| Discover models from a URL | Models page *Find models* | done |
| Tools trait + registry | `core/tool.rs`, shared tools in `api.rs` | done |
| TOON / JSON reply, several calls per reply | `elements/response.rs` | done |
| Phases steer focus and gate tools | `elements/phase.rs` | done |
| Sub-engines | folders; engine is a tool | done |
| UI from object views, primitives only | `compose::Render`, `view()` | done |
| Glass design (wall → pane → glass) | `assets/styling/glass.css` | done (tokens in CSS, not yet editable) |
| Live artifacts, alerts, scripts | `elements/artifact|alert|script.rs` | new |
| Non-blocking calls | all calls of a reply start together; `await: any` continues after the first (rest cancelled) | done |
| Refocus at 90% context | tokens: engine override, else model `context`, else discovered from runtime; model summarises essentials + lessons; history keeps summary + last 4 turns | done |
| Stop a running engine | `stop()` before next step, status `stopped`; Stop button | done |
| Live updates | long-poll `wait_change` on a per-engine change counter | done |
| Theme editing from the UI | `data/theme.json` → `:root` vars; Theme page | done; layout too: `data/layout.json` (columns, engine order, hidden kinds), Layout page |
| sandbox-exec for the server | `sandbox/server.sb`, `scripts/sandboxed.sh` | done (boot, pages, HTTPS quotes, claude CLI call verified) |
| Desktop | `dx serve --platform desktop` builds Askk.app; server boots | built + launched; window check skipped by owner (web is the target for now) |
| Folder routing | `data/routes/**/page.json`, `[param]`, `[...rest]`, nav from pages; `create_view` tool | done |
| Max tokens 32k | `models.json max_tokens` → `{max_tokens}` in bodies | done |
| Real model | default `claude` (cli runtime) answers live: askk ran create_view, set_phase, stamp script against it | done |
