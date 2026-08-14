//! WHICH Linux this page runs (increment 18). One bit, stored the way
//! `ui/src/skin.rs` stores the theme: in `localStorage`, in its own key
//! namespace, because a choice about this device's engine is not app data
//! (I2 — it never leaves either).
//!
//! It is read in exactly two places: the composition root, which builds the
//! port, and `warmth.rs`, which asks that engine how far it has got. Nothing
//! else may branch on it — if a third caller appears, the engines have stopped
//! being interchangeable and the port has stopped being a seam.
//!
//! CHANGING IT TAKES EFFECT ON RELOAD, deliberately. The port is injected once
//! at `WebApp::boot` and handed to the core; swapping it live would mean a
//! running turn holding a workspace the page no longer believes in, and the
//! other engine would still have to boot from cold anyway. The setting says so
//! in the UI, and this module does not pretend otherwise.

/// The engines that exist. Two, and there is no `Other`: a build ships the
/// implementations it has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    /// `cheerpx.rs` — JIT x86, disk streamed from Leaning Tech's CDN, writes
    /// kept in IndexedDB.
    Cheerpx,
    /// `c2w.rs` — container2wasm, an image this project hosts itself, nothing
    /// kept across a reload.
    C2w,
}

impl Engine {
    /// The stored form, and the value `check-layout.sh`-style tooling would
    /// have to type. Short and stable: it is in a person's browser storage.
    pub fn key(self) -> &'static str {
        match self {
            Engine::Cheerpx => "cheerpx",
            Engine::C2w => "c2w",
        }
    }

    /// Whether what is written in the workspace is still there after a reload.
    /// `WorkspacePort::durable` answers this for the engine that is RUNNING;
    /// this answers it for one that has only been chosen, which is what a
    /// warning before a reload has to be about (R10-4).
    pub fn keeps_files(self) -> bool {
        matches!(self, Engine::Cheerpx)
    }

    /// What to call it on screen.
    pub fn label(self) -> &'static str {
        match self {
            Engine::Cheerpx => "CheerpX",
            Engine::C2w => "container2wasm",
        }
    }
}

/// Its own key namespace, alongside `askk.skin`.
const KEY: &str = "askk.engine";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// What is SAVED — which is not the same question as what is running.
///
/// Absent, unreadable, or storage denied all mean CheerpX: it is what every
/// build before this one ran, so a browser that cannot answer gets the
/// behaviour it already had (I11 — a release is reachable by refresh, without
/// data loss, and CheerpX is where the data is).
pub fn stored() -> Engine {
    match storage().and_then(|s| s.get_item(KEY).ok().flatten()).as_deref() {
        Some("c2w") => Engine::C2w,
        _ => Engine::Cheerpx,
    }
}

thread_local! {
    static RUNNING: std::cell::OnceCell<Engine> = const { std::cell::OnceCell::new() };
}

/// What this PAGE is running, fixed on first read and never moving again.
///
/// The memo is the whole point, not an optimisation. The port is built once at
/// `WebApp::boot`; if this re-read storage, then the moment somebody changed
/// the setting the header pill would start reporting the OTHER engine's boot
/// state while the old one was still the thing running commands — a status
/// lying about the machine it names, which is the exact defect the workspace
/// pill exists to avoid. Saved and running are two facts, and Settings shows
/// both when they differ.
pub fn engine() -> Engine {
    RUNNING.with(|cell| *cell.get_or_init(stored))
}

/// Store the choice. Storage only: `engine()` is already fixed for this page,
/// so this takes effect on the next load — see the module note.
pub fn set_engine(chosen: Engine) {
    if let Some(s) = storage() {
        let _ = s.set_item(KEY, chosen.key());
    }
}
