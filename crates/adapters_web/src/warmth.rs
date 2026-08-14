//! The workspace's boot state, as the PAGE sees it: a value it can render
//! every frame, and the call that starts the machine before anybody asks for
//! it. Split from `cheerpx.rs`, which owns the CheerpX binding itself, so both
//! hold the 200-line rule (I12).
//!
//! IT ANSWERS FOR WHICHEVER ENGINE IS SELECTED (increment 18). There are two,
//! and their boots do not look alike: CheerpX has one wait (a disk starts
//! streaming), container2wasm has three (load the engine, mount the image,
//! reach a shell) and the first load of it moves ~48 MB. A pill that said
//! `starting…` for a minute and a half would be true and useless, so `Booting`
//! carries the phase, and the pill prints it.

use crate::c2w::{c2w_boot, c2w_state, BASE};
use crate::cheerpx::{cx_boot, cx_state, CACHE, DISK, ENGINE};
use crate::engine::{engine, Engine};

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
    /// STOPPED WAITING, STILL OCCUPIED (R12-1). CheerpX can abandon a command
    /// and cannot kill one, so "you stopped waiting" and "the workspace is
    /// free again" are two different facts and the pill used to report the
    /// second on the strength of the first: green `ready`, with the abandoned
    /// command still holding the one console and the next command queued
    /// behind it reading `running for 230s…`.
    Occupied,
    Failed(String),
}

// Whether the boot has been ASKED FOR in this page (R12-7). `prewarm` spawns
// the boot, and the engine does not record `booting` until that task is first
// polled — a microtask later. The pill polls twice a second, so on a warm
// CheerpX the whole `booting` phase can fall between two reads and the header
// goes grey `idle` straight to green: three cold boots, no amber, and a
// legend that defines amber as the boot state. The request is a fact this
// side already has, so it is the one that answers.
thread_local! {
    static ASKED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Read the workspace's boot state. Cheap: a string off a JS module global.
pub fn warmth() -> Warmth {
    let raw = match engine() {
        Engine::Cheerpx => cx_state(),
        Engine::C2w => c2w_state(),
    };
    match raw.as_str() {
        // Asked for and not yet recorded: STARTING, which is what it is.
        "idle" if ASKED.with(std::cell::Cell::get) => Warmth::Booting("starting…".into()),
        "idle" => Warmth::Idle,
        "ready" => Warmth::Ready,
        "busy" => Warmth::Busy,
        "occupied" => Warmth::Occupied,
        // `booting` alone (CheerpX) has no phase to report; `booting:<phase>`
        // (c2w) does. Both render as one word or phrase after the dot.
        "booting" => Warmth::Booting("starting…".into()),
        other => match other.split_once(':') {
            Some(("booting", phase)) => Warmth::Booting(format!("{phase}…")),
            _ => Warmth::Failed(other.strip_prefix("error:").unwrap_or(other).to_string()),
        },
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
    ASKED.with(|asked| asked.set(true));
    match engine() {
        Engine::Cheerpx => wasm_bindgen_futures::spawn_local(async {
            let _ = cx_boot(ENGINE, DISK, CACHE).await;
        }),
        Engine::C2w => wasm_bindgen_futures::spawn_local(async {
            let _ = c2w_boot(BASE).await;
        }),
    }
}
