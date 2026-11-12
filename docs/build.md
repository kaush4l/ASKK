# How askk builds and runs (Dioxus 0.7)

One crate, one `src/`. Cargo **features** pick the target; `dx` builds each target with the right feature.

| feature | built for | contains |
| --- | --- | --- |
| `web` | `wasm32-unknown-unknown` | UI only (runs in the browser) |
| `server` | native (aarch64-apple-darwin) | UI (for server rendering) + `#[server]` function bodies, connectors, file I/O |
| `desktop` / `mobile` | native app / iOS | UI in a native webview; server functions still call the server |

Code that must never reach the browser (HTTP to models, reading `models.json`, spawning `claude`) sits
behind `#[cfg(feature = "server")]` or inside a `#[server]` function body.

## `dx serve` step by step

1. **Read config**: `Cargo.toml` (features, `default = ["web"]`) and `Dioxus.toml` (title, assets).
2. **Client build**: `cargo build --target wasm32-unknown-unknown --features web`.
   - `#[server]` functions compile to *stubs*: a `fetch` POST to `/api/<name>` with serialized args.
3. **wasm-bindgen** (CLI version must equal the crate's `wasm-bindgen`; `dx` CLI must equal `dioxus`)
   turns the `.wasm` into `wasm/askk_bg.wasm` + JS glue. Optional `wasm-opt` in release.
4. **Assets**: every `asset!("/assets/…")` is collected at link time (manganis), hashed, minified,
   copied to `public/assets/`. `index.html` is generated from `Dioxus.toml`.
   Output: `target/dx/askk/debug/web/public/`.
5. **Server build**: `cargo build --features server` (native). Real bodies of `#[server]` functions
   are compiled in and registered as axum routes. Output: `target/dx/askk/debug/web/server`.
6. **Run**: `dx` launches the server binary, which serves `public/`, renders the first HTML of a route
   on the server (SSR), and answers `/api/*`. `dx` proxies it on `--port` (8080).
7. **Browser**: loads HTML → loads wasm → *hydrates* (attaches to the server HTML) → router takes over.
   Clicking "Save" calls the stub → POST `/api/…` → server body runs → result returns as JSON.
8. **Watch loop**: rsx/CSS edits hot-reload without rebuild; Rust edits rebuild (hot-patch when possible).

## Other commands

- `dx serve --platform desktop` — native window; same components.
- `dx bundle --platform web --release` — `public/` + `server` for deploy; `--platform macos|ios` for apps.
- `cargo check --features server` and `cargo check --features web --target wasm32-unknown-unknown`
  check both halves without `dx`.

## Data

`ASKK_DATA` (default `./data`) holds runtime files. `data/models.json` is written by the Models view.

## Shells, capabilities and presets

Three things decide a build, and each is chosen apart from the others:

| what | chosen by | the choices |
| --- | --- | --- |
| the **shell**: what the build is | one Cargo feature | `server` (the host), `web` (its page), `desktop` (the Mac window), `local` (the whole app in a tab), `mobile` (no shell yet) |
| the **capabilities**: what a host can do besides the base | more Cargo features, each `["server", …]` | `terminals` (the service holds real terminals: the multiplexer), `sandbox` (their programs are confined: `sandbox-exec` on macOS, Landlock on Linux) |
| the **target**: which machine | `--target` | this one, or one of the six CI builds the host for |

Cargo's own profiles (`dev`, `release`) only say how hard the compiler works; they never
change what is in a build.

A capability that is left out is not an error: `capabilities()` (`core/caps.rs`) says what the
build does without it, and a window hides what it cannot do. The base feature keeps the name
`server` because Dioxus's `#[server]` looks for a feature of that name.

**Presets** are named sets of these, in `builds.toml`, built by `scripts/build.sh`:

| preset | shell | capabilities | for |
| --- | --- | --- | --- |
| `full` | web | terminals, sandbox | what `scripts/run.sh` builds and runs (`PRESET=` picks another) |
| `lean` | web | none | engines and agents' sessions only, no process held |
| `open-terminals` | web | terminals | terminals where the system's sandbox gets in the way; each box says it is not confined |
| `mac` | desktop | none | the Mac window, asking a service started by `askk start` |
| `tab` | local | none | the app in one browser tab (`scripts/local.sh`, published to Pages) |

```sh
./scripts/build.sh                 # the presets
./scripts/build.sh full            # build one as released
./scripts/build.sh all --check     # compile every preset (a step of scripts/check.sh)
```

With dx, only the host gets the capabilities, and each half names its platform, or dx builds
the host for the browser too:
`dx build --release @client --platform web @server --platform server --features terminals,sandbox`.

A test (`every_preset_names_what_there_is`, `src/structure.rs`) holds the presets to Cargo.toml,
to the capabilities the core knows, and CI's host build to `full`.

## Screens of every build type

`./scripts/shots.sh` (or `./scripts/check.sh --shots`) starts the built app on a fresh home and
takes the screens of each UI, so each can be judged and improved on its own. It writes
`target/shots/index.html`, one section per type:

| type | how | what |
| --- | --- | --- |
| `web` | headless Chrome (`scripts/shots/page.mjs`) | canvas, every box, pill, palette, an engine box, a terminal box, settings; phone 375, tablet 900, wide 1440; dark and light; and less motion, no glass, more contrast |
| `terminal` | `askk terminal` under a pseudo-terminal (`scripts/shots/tui.py`), and piped | the full screen step by step (first screen, keys, boxes, a box, a new tab, a split, a zoom), and the lines |
| `tab` | headless Chrome, when `./scripts/build.sh tab` has built it | the tab's page at each size and theme |
| `mac` | `--mac`: the Mac window, by `screencapture` | the window. macOS refuses the picture until the terminal running it is allowed under Privacy & Security, Screen Recording |

Frames are named `<type>--<screen>--<size>-<theme>`; nothing in `target/` is kept in git.
