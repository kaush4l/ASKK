//! CONSTRUCTION of one agent's Worker: finding this build's bundle and
//! starting the Worker with the JSON it boots from. `workers.rs`, the parent,
//! owns the port and the lifecycle; [`reply`] owns everything the Worker says
//! back.
//!
//! The split is by DIRECTION. This half runs once per Worker and is finished
//! the moment `postMessage` returns; the other half runs for as long as the
//! Worker lives, on a callback, with the app already borrowed. They were one
//! file until the boot payload grew a fourth blob and pushed it over I12.

use js_sys::{Object, Reflect};
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{Worker, WorkerOptions, WorkerType};

mod reply;

pub(crate) use reply::{ask, listen, Activity, Authored, Live, Memory};

/// Where the Worker gets this build's Wasm from. Trunk fingerprints both files
/// and writes them into `index.html` as preload links, so the page reads its
/// own bundle's URLs rather than anyone hardcoding a hash; the snippet links
/// Dioxus adds are skipped by name.
pub(crate) fn bundle_urls() -> Option<(String, String)> {
    let document = web_sys::window()?.document()?;
    let links = document.query_selector_all("link[rel=modulepreload]").ok()?;
    let href = |i| links.item(i)?.dyn_into::<web_sys::Element>().ok()?.get_attribute("href");
    let glue = (0..links.length())
        .filter_map(href)
        .find(|href| !href.contains("/snippets/"))?;
    let wasm = document
        .query_selector("link[type='application/wasm']")
        .ok()??
        .get_attribute("href")?;
    Some((glue, wasm))
}

/// The JSON blobs a sub-agent boots from — named rather than four `&str` in a
/// row, so nobody can pass them in the wrong order. `briefs` is the words every
/// STAGE enters with: a sub-agent walks the same loop the page does, so a
/// Worker booted without them would refuse every stage it reached.
#[derive(Clone)]
pub(crate) struct Boot<'a> {
    pub agents: &'a str,
    pub briefs: &'a str,
    pub models: &'a str,
    pub profile: &'a str,
}

/// Spawn one Worker and send it its boot message — a plain object, because
/// `postMessage` structured-clones it: no Wasm memory, nothing shared (ADR-008).
pub(crate) fn start(
    name: &str,
    glue: &str,
    wasm: &str,
    boot: &Boot<'_>,
) -> Result<Worker, JsValue> {
    let options = WorkerOptions::new();
    options.set_type(WorkerType::Module);
    options.set_name(&format!("agent-{name}"));
    let worker = Worker::new_with_options("agent-worker.js", &options)?;
    let message = Object::new();
    for (key, value) in [
        ("kind", "boot"),
        ("name", name),
        ("glue", glue),
        ("wasm", wasm),
        ("agents", boot.agents),
        ("briefs", boot.briefs),
        ("models", boot.models),
        ("profile", boot.profile),
    ] {
        Reflect::set(&message, &key.into(), &value.into())?;
    }
    worker.post_message(&message)?;
    Ok(worker)
}
