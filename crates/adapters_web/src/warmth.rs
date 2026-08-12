//! The workspace's boot state, as the PAGE sees it: a value it can render
//! every frame, and the call that starts the machine before anybody asks for
//! it. Split from `cheerpx.rs`, which owns the CheerpX binding itself, so both
//! hold the 200-line rule (I12).

use crate::cheerpx::{cx_boot, cx_state, CACHE, DISK, ENGINE};

/// How far the workspace has got, as a value the UI can render every frame
/// without awaiting anything: `idle`, `booting`, `ready`, or `error:<reason>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Warmth {
    Idle,
    Booting,
    Ready,
    Failed(String),
}

/// Read the workspace's boot state. Cheap: a string off a JS module global.
pub fn warmth() -> Warmth {
    let raw = cx_state();
    match raw.as_str() {
        "idle" => Warmth::Idle,
        "booting" => Warmth::Booting,
        "ready" => Warmth::Ready,
        other => Warmth::Failed(other.strip_prefix("error:").unwrap_or(other).to_string()),
    }
}

/// Start the VM in the background, now, and never block on it.
///
/// This REVERSES the lazy boot this module was built with. The reason is the
/// product's: the environment is meant to be already packaged, so the first
/// command a person runs should meet a booted machine, not a two-second wait
/// for a disk to start streaming. The cost is the engine and the first blocks
/// on every page load; the guard is that nothing awaits this — the page is
/// interactive throughout and `warmth()` is the only thing that can even tell.
pub fn prewarm() {
    if web_sys::window().is_none() {
        return; // an agent's Worker has no page to boot a VM in
    }
    wasm_bindgen_futures::spawn_local(async {
        let _ = cx_boot(ENGINE, DISK, CACHE).await;
    });
}

