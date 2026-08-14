//! `WorkspacePort` over CheerpX — a real x86 Linux in the page (ADR-013, and
//! the plan's "CheerpX, not container2wasm": ADR-052 measured the c2w/Bochs
//! guest at one permanently interpreted thread, where CheerpX is "a two-tier
//! emulator … an interpreter and a sophisticated JIT compiler that is able to
//! generate efficient WebAssembly representations for hot code").
//!
//! Three things this file exists to enforce:
//!
//! - **It boots LAZILY.** Nothing is fetched until the first command; a page
//!   load that never runs one pays nothing, and the engine (~a MB) and the
//!   disk (streamed, never downloaded) stay unrequested.
//! - **The overlay IS the workspace.** `CloudDevice` (read-only base image,
//!   streamed over WebSocket) under an `IDBDevice` in an `OverlayDevice`:
//!   every write lands in IndexedDB and is still there after a reload.
//! - **The engine loads from Leaning Tech's CDN.** The Community Licence
//!   covers this use and its action point is "give appropriate credits", so
//!   the page carries a visible credit; self-hosting the runtime would need a
//!   commercial licence. The CDN sends `cross-origin-resource-policy:
//!   cross-origin`, which is what lets it load under COEP at all.
//!
//! The JS in `cheerpx.js` is BINDING, not logic (I5): it is the `await`
//! sequence from WebVM's own `WebVM.svelte`, which has no Rust equivalent
//! because CheerpX is a JS API. Every decision — what to run, where, what to do
//! with the result — is in `core::workspace`.

use kernel::{BoxFuture, Execution, WorkspaceError, WorkspacePort};
use wasm_bindgen::prelude::*;

/// The Alpine image WebVM publishes. Alpine, not their Debian: it is the
/// smaller image and busybox gives a complete userland in one binary, so the
/// first `sh -c` needs fewer blocks streamed. Their own config boots it via
/// `/sbin/init` and wants a display; nothing here does — every command is a
/// direct `cx.run("/bin/sh", ["-c", …])`, so there is no init, no display and
/// no login to wait for. That is the fastest path to a shell.
pub(crate) const DISK: &str = "wss://disks.webvm.io/alpine_20251007.ext2";

/// The engine, from Leaning Tech's CDN (see the module note on the licence).
///
/// 1.3.1, NOT the 1.2.8 the research quoted: with 1.2.8 and this Alpine image
/// `CheerpX.Linux.create` never resolves — measured, twice, at a 120 s timeout
/// with no error and no console output. 1.3.1 mounts the same image in 2.2 s.
/// The engine and the disk are published separately and this one is from
/// October 2025, so the pair has to be pinned together, not each to "latest".
pub(crate) const ENGINE: &str = "https://cxrtnc.leaningtech.com/1.3.1/cx.js";

/// The IndexedDB database holding the overlay's written blocks. Fixed name:
/// it is the same workspace across reloads, which is the whole point.
pub(crate) const CACHE: &str = "askk-workspace";

#[wasm_bindgen(module = "/src/cheerpx.js")]
extern "C" {
    #[wasm_bindgen(catch)]
    pub(crate) async fn cx_boot(engine: &str, disk: &str, cache: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn cx_exec(command: String) -> Result<JsValue, JsValue>;
    pub(crate) fn cx_state() -> String;
    fn cx_stop() -> bool;
}

/// The browser's workspace. Holds no state of its own: the VM lives in the JS
/// module above because CheerpX's objects cannot cross into Wasm.
#[derive(Debug, Default)]
pub struct CheerpxWorkspace;

fn why(e: JsValue) -> String {
    e.as_string()
        .or_else(|| js_sys::Reflect::get(&e, &"message".into()).ok().and_then(|m| m.as_string()))
        .unwrap_or_else(|| format!("{e:?}"))
}

impl WorkspacePort for CheerpxWorkspace {
    /// Run `command` in `cwd`, creating `cwd` first — a grant naming a folder
    /// that does not exist yet is a new space, not an error.
    fn exec<'a>(
        &'a self,
        cwd: &'a str,
        command: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        let at = kernel::shell_quote(cwd);
        let script = format!("mkdir -p -- {at} && cd {at} && ( {command} )");
        Box::pin(async move {
            cx_boot(ENGINE, DISK, CACHE)
                .await
                .map_err(|e| WorkspaceError::Unavailable { reason: why(e) })?;
            let raw = cx_exec(script)
                .await
                .map_err(|e| WorkspaceError::Failed { message: why(e) })?;
            let json = raw.as_string().unwrap_or_default();
            serde_json::from_str::<Execution>(&json).map_err(|e| WorkspaceError::Failed {
                message: format!("unreadable result from the workspace: {e}"),
            })
        })
    }

    /// ABANDON, not kill — and the button says so (R11-1b).
    ///
    /// Measured, not assumed. `cx.run` returns a plain promise: no handle, no
    /// `AbortSignal`, no `kill`, and the whole documented API is `create`,
    /// `run`, the console setters and `registerCallback`. The ONE input channel
    /// is the writer `setCustomConsole` returns, which is not addressed to a
    /// process — it is the console's keyboard. A `while true; do …; done` under
    /// `sh -c` on this console does not take the Ctrl-C: the interrupt is typed,
    /// and the loop goes on appending to `pulse.log`. So the page stops waiting
    /// and says the command is still in there, which is true, instead of
    /// offering the same word c2w's real interrupt earns.
    fn interrupt(&self) -> kernel::Interrupt {
        kernel::Interrupt::Abandon
    }

    fn stop(&self) -> BoxFuture<'_, Result<(), WorkspaceError>> {
        Box::pin(async {
            match cx_stop() {
                true => Ok(()),
                false => Err(WorkspaceError::Failed {
                    message: "nothing is running in the workspace to stop".into(),
                }),
            }
        })
    }
}
