//! The workspace's boot state, as the PAGE sees it: a value it can render
//! every frame, and the call that starts the machine before anybody asks for
//! it. Split from `c2w.rs`, which owns the container2wasm binding itself, so
//! both hold the 200-line rule (I12).
//!
//! IT CARRIES THE PHASE. container2wasm boots in three (load the engine, mount
//! the image, reach a shell) and the first load of it moves ~48 MB. A pill that
//! said `starting…` for a minute and a half would be true and useless, so
//! `Booting` carries the phase, and the pill prints it.

use crate::c2w::{c2w_boot, c2w_state, BASE};

/// How far the workspace has got, as a value the UI can render every frame
/// without awaiting anything.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Warmth {
    Idle,
    /// …and what it is doing. One phrase, already in the words the pill wants.
    Booting(String),
    Ready,
    /// Booted, and RUNNING A COMMAND (R11-1a). It outranks `Ready` because a
    /// person reading this pill while nothing answers is asking about the
    /// command, not about the machine: `● main's workspace · ready`, in
    /// green, held for seven minutes with one command wedged and the only way
    /// out being the browser's reload button.
    Busy,
    Failed(String),
}

// Whether the boot has been ASKED FOR in this page (R12-7). `prewarm` spawns
// the boot, and the engine does not record `booting` until that task is first
// polled — a microtask later. The pill polls twice a second, so the whole
// `booting` phase can fall between two reads and the header goes grey `idle`
// straight to green: three cold boots, no amber, and a legend that defines
// amber as the boot state. The request is a fact this
// side already has, so it is the one that answers.
thread_local! {
    static ASKED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Read the workspace's boot state. Cheap: a string off a JS module global.
pub fn warmth() -> Warmth {
    let raw = c2w_state();
    match raw.as_str() {
        // Asked for and not yet recorded: STARTING, which is what it is.
        "idle" if ASKED.with(std::cell::Cell::get) => Warmth::Booting("starting…".into()),
        "idle" => Warmth::Idle,
        "ready" => Warmth::Ready,
        "busy" => Warmth::Busy,
        // The engine never reports a bare `booting`: `c2w_state` always
        // appends the phase (`booting:<phase>`), so the phase-carrying arm
        // below is the only one there is. A bare `booting` arm used to exist
        // for the OTHER engine, which had no phase to report; that engine is
        // deleted and so is the arm.
        other => match other.split_once(':') {
            Some(("booting", phase)) => Warmth::Booting(format!("{phase}…")),
            _ => Warmth::Failed(other.strip_prefix("error:").unwrap_or(other).to_string()),
        },
    }
}

/// Start the VM in the background, now, and never block on it.
///
/// EAGER WHERE IT IS ASKED FOR, NOT ON EVERY PAGE LOAD (2026-08-18). The
/// environment is meant to be already packaged, so somebody opening the
/// Commands pane should meet a booting machine rather than starting one. That
/// argument was once written as "a two-second wait for a disk to start
/// streaming", which described the deleted engine; what this actually buys now
/// is a head start on 47 MB — `out.wasm.gzip` is 36.6 MB and
/// `imagemounter.wasm.gzip` 7.8 MB — cached per browser by `web/sw.js`, but
/// paid in full on a first visit. That is too much to spend on somebody who
/// came to type one sentence into a chat, so the CALLER decides: `ui/terminal.rs`
/// calls this when its pane mounts, and the header's warmth pill — which is on
/// every view — does not. `exec` boots on demand regardless, so skipping this
/// costs a wait and never a failure.
///
/// Nothing awaits it: the page is interactive throughout and `warmth()` is the
/// only thing that can even tell.
pub fn prewarm() {
    if web_sys::window().is_none() {
        return; // an agent's Worker has no page to boot a VM in
    }
    ASKED.with(|asked| asked.set(true));
    wasm_bindgen_futures::spawn_local(async {
        let _ = c2w_boot(BASE).await;
    });
}
