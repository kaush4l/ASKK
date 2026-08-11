//! Same-origin static assets: the `public/agents/` tree, fetched at boot.
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
