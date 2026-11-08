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
