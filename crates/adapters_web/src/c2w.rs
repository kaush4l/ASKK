//! `WorkspacePort` over container2wasm — THE Linux, and the only one.
//!
//! Why this one. It is an image we build, gzip and serve from our own
//! `web/c2w/` — no CDN, no licence, no third-party disk, nothing streamed from
//! infrastructure this project does not control. It costs ~48 MB shipped and a
//! guest that is one permanently interpreted Bochs thread, which is 13–15x
//! slower on compute than a JIT would be. That cost was measured and accepted:
//! sovereignty over the thing the agent actually runs in is the point, so
//! there is no second engine and no setting to pick one.
//!
//! The JS in `c2w.js` is BINDING, not logic (I5). What is worth knowing here:
//!
//! - **c2w has no `run(argv)`.** It has a PTY with a container behind it. So
//!   `/bin/sh` is booted once and every command is written into that one shell
//!   between two RANDOM sentinels. Random per call, not fixed: a fixed
//!   sentinel is an exit status a model could print for itself.
//! - **The watchdog is not optional.** One malformed command (`echo a; (echo`)
//!   wedges the shell permanently, and every later command with it — one shell
//!   serves every agent, so that is shared fate. A timeout writes `0x03`, then
//!   proves the shell answers again.
//! - **A TIMEOUT IS AN EXECUTION, NOT A `Failed`.** The interrupt kills the
//!   trailing sentinel, but the command ran and what it printed is in the
//!   buffer. That output used to be DROPPED, which is not a wording problem:
//!   `WorkspaceError` has nowhere to put one, so choosing it was choosing to
//!   throw it away — a 179-second build that printed 4 MB then wedged reported
//!   "no answer in 180s" and nothing else. It now comes back as `Execution {
//!   status: 130, .. }` — 128 + SIGINT, what every shell gives a command the
//!   watchdog's own signal killed — carrying the partial output and a closing
//!   `[PARTIAL: …]` note, so it cannot read as whole. A STOP is still an error.
//! - **The model is TOLD about the ceiling**, because a limit nobody states is
//!   one it plans as if absent (I16). The seconds and the `[PARTIAL:` mark are
//!   declared once in `agent::environment::deadline` and asserted against
//!   `RUN_MS` by `crates/agent/tests/environment.rs`.
//! - **NOTHING WRITTEN HERE SURVIVES A RELOAD.** The container's root is
//!   `overlay … upperdir=/run/rootfs-upper` — tmpfs, i.e. guest RAM. It is the
//!   one thing about this Linux a person can feel, it is now unconditionally
//!   true of the product, and it is a fact the port states (`durable`) rather
//!   than a surprise.
//! - **The boot state is a VALUE, not an await.** `Warmth` at the foot of this
//!   file is what the page renders every frame, and it CARRIES THE PHASE:
//!   booting is three steps (load the engine, mount the image, reach a shell)
//!   and the first of them moves ~48 MB, so a pill that said `starting…` for a
//!   minute and a half would be true and useless.

use kernel::{BoxFuture, Execution, WorkspaceError, WorkspacePort};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/c2w.js")]
extern "C" {
    #[wasm_bindgen(catch)]
    pub(crate) async fn c2w_boot(base: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn c2w_exec(base: &str, command: String) -> Result<JsValue, JsValue>;
    pub(crate) fn c2w_state() -> String;
    fn c2w_stop() -> bool;
}

/// Where the vendored runtime lives, relative to the page. Resolved against
/// `document.baseURI` in JS, so it is correct under the `/ASKK/` subpath and
/// in the dev server's root alike — an origin-absolute path white-pages
/// production and `publish.sh` gates on it.
pub(crate) const BASE: &str = "c2w/";

/// The browser's other workspace. Holds no state: the container lives in the
/// JS module, because a PTY and a Worker cannot cross into Wasm.
#[derive(Debug, Default)]
pub struct C2wWorkspace;

fn why(e: JsValue) -> String {
    e.as_string()
        .or_else(|| js_sys::Reflect::get(&e, &"message".into()).ok().and_then(|m| m.as_string()))
        .unwrap_or_else(|| format!("{e:?}"))
}

impl WorkspacePort for C2wWorkspace {
    /// Run `command` in `cwd`, creating `cwd` first — the contract every
    /// caller above this already had: the six process tools and the four file
    /// ones are unchanged code, because they only ever knew the port.
    fn exec<'a>(
        &'a self,
        cwd: &'a str,
        command: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        let at = kernel::shell_quote(cwd);
        let script = format!("mkdir -p -- {at} && cd {at} && ( {command} )");
        Box::pin(async move {
            c2w_boot(BASE)
                .await
                .map_err(|e| WorkspaceError::Unavailable { reason: why(e) })?;
            let raw = c2w_exec(BASE, script)
                .await
                .map_err(|e| WorkspaceError::Failed { message: why(e) })?;
            let json = raw.as_string().unwrap_or_default();
            serde_json::from_str::<Execution>(&json).map_err(|e| WorkspaceError::Failed {
                message: format!("unreadable result from the workspace: {e}"),
            })
        })
    }

    /// No. The root is an overlay on tmpfs; a reload is a fresh container.
    fn durable(&self) -> bool {
        false
    }

    /// KILL, really (R11-1b). One shared PTY with a container behind it means
    /// `0x03` reaches the foreground process group and the command dies — the
    /// primitive the 180s watchdog has always used, now offered to the person
    /// watching instead of only to the clock. `Interrupt` is how the button
    /// knows a stop here really stops something.
    fn interrupt(&self) -> kernel::Interrupt {
        kernel::Interrupt::Kill
    }

    fn stop(&self) -> BoxFuture<'_, Result<(), WorkspaceError>> {
        Box::pin(async {
            match c2w_stop() {
                true => Ok(()),
                false => Err(WorkspaceError::Failed {
                    message: "nothing is running in the workspace to stop".into(),
                }),
            }
        })
    }
}

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
/// came to type one sentence into a chat, so the CALLER decides: `ui/terminal/mod.rs`
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
