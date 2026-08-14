//! `WorkspacePort` over container2wasm — the SECOND Linux (increment 18), and
//! the one this project builds and hosts itself.
//!
//! Why a second one at all. `cheerpx.rs` streams its ext2 disk from Leaning
//! Tech's CDN and loads their engine from their CDN under a Community Licence.
//! That is three dependencies on somebody else's infrastructure for the thing
//! the agent actually runs in. c2w is an image we build, gzip and serve from
//! our own `web/c2w/` — no CDN, no licence, no third-party disk. It costs
//! ~48 MB shipped and a guest that is one permanently interpreted Bochs
//! thread; CheerpX JITs. The owner picks on measurements, so BOTH ship and the
//! engine is a setting (`engine.rs`).
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
//!   proves the shell answers again; the interrupted call is resolved as a
//!   typed error here, because the interrupt also kills the trailing sentinel
//!   that would otherwise have closed it.
//! - **NOTHING WRITTEN HERE SURVIVES A RELOAD.** The container's root is
//!   `overlay … upperdir=/run/rootfs-upper` — tmpfs, i.e. guest RAM. That is
//!   the one behavioural difference the two engines have that a person can
//!   feel, so it is a fact the port states (`durable`) rather than a surprise.

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
    /// Run `command` in `cwd`, creating `cwd` first — the same contract, and
    /// the same script, `cheerpx.rs` runs. That is the acceptance test: the
    /// six process tools and the four file ones are unchanged code above this.
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
    /// watching instead of only to the clock. This is the engine that can make
    /// the stronger promise, and `Interrupt` is how the button knows to.
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
