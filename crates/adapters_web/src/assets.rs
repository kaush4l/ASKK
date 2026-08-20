//! Same-origin static assets: the `public/agents/` tree and the `public/stages/`
//! briefs, fetched at boot.
//!
//! Not `NetPort`: that port is the brokered, allowlisted outside world
//! (I2/I6). These are the app's own files, served beside `index.html` — the
//! reason an agent can be edited and redeployed with no rebuild. Paths are
//! RELATIVE, because the site lives under a repo subpath.
//!
//! A static host cannot list a directory, so `agents/index.json` IS the
//! listing: an agent folder that is not named there is never fetched.

use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

/// One same-origin asset as text. `None` for anything that did not arrive
/// with a 2xx — a missing file costs its agent, never the boot.
async fn fetch_text(path: &str) -> Option<String> {
    let window = web_sys::window()?;
    // `no-cache` = revalidate, never serve blind from the HTTP cache. GitHub
    // Pages stamps assets with a ten-minute max-age, so without this an agent
    // edited and redeployed would keep answering with yesterday's prompt for
    // ten minutes — the whole point of the file being data is that a reload
    // after a deploy shows the edit.
    let init = web_sys::RequestInit::new();
    init.set_cache(web_sys::RequestCache::NoCache);
    let response: web_sys::Response = JsFuture::from(window.fetch_with_str_and_init(path, &init))
        .await
        .ok()?
        .dyn_into()
        .ok()?;
    if !response.ok() {
        return None;
    }
    JsFuture::from(response.text().ok()?).await.ok()?.as_string()
}

/// The model catalogue, `public/models.json` (increment 04). Same file as the
/// Python project's, same no-cache rule as the agents: it is editable data
/// redeployed without a rebuild, so a stale copy is a wrong endpoint.
pub async fn fetch_models() -> Option<String> {
    let raw = fetch_text("models.json").await;
    if raw.is_none() {
        web_sys::console::warn_1(&"models.json not found; no model catalogue".into());
    }
    raw
}

/// Every agent file the manifest names, as `(folder, text)` pairs in
/// manifest order. An unreadable manifest means no project agents — the
/// compiled-in built-ins still load, so the app still runs.
pub async fn fetch_agents() -> Vec<(String, String)> {
    let Some(raw) = fetch_text("agents/index.json").await else {
        web_sys::console::warn_1(&"agents/index.json not found; built-ins only".into());
        return Vec::new();
    };
    let names: Vec<String> = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("agents").cloned())
        .and_then(|a| serde_json::from_value(a).ok())
        .unwrap_or_default();

    let mut files = Vec::new();
    for name in names {
        match fetch_text(&format!("agents/{name}/agent.md")).await {
            Some(text) => files.push((name, text)),
            None => web_sys::console::warn_1(
                &format!("agents/{name}/agent.md not found; skipping that agent").into(),
            ),
        }
    }
    files
}

/// THE WORDS EVERY STAGE ENTERS WITH (`agent::brief`), one file per key. No
/// manifest: the keys are a CLOSED list in Rust, because a stage name is a word
/// the machine reasons about — so this asks for exactly the five it knows.
///
/// A MISSING FILE IS NOT SKIPPED THE WAY AN AGENT IS. A skipped agent costs
/// that agent; a skipped brief would cost the first turn that reached its
/// stage, silently. So nothing is pushed for it and `core::install_briefs`
/// refuses the set downstream, which is the one place the sentence is written.
pub async fn fetch_briefs() -> Vec<(String, String)> {
    let mut files = Vec::new();
    for key in core::BRIEF_KEYS {
        match fetch_text(&format!("stages/{key}.md")).await {
            Some(text) => files.push((key.to_string(), text)),
            None => web_sys::console::warn_1(
                &format!("stages/{key}.md not found; the {key} stage will refuse to run").into(),
            ),
        }
    }
    files
}
