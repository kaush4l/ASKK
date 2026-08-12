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
//! The JS below is BINDING, not logic (I5): it is the `await` sequence from
//! WebVM's own `WebVM.svelte`, which has no Rust equivalent because CheerpX
//! is a JS API. Every decision — what to run, where, what to do with the
//! result — is in `core::workspace`.

use kernel::{BoxFuture, Execution, WorkspaceError, WorkspacePort};
use wasm_bindgen::prelude::*;

/// The Alpine image WebVM publishes. Alpine, not their Debian: it is the
/// smaller image and busybox gives a complete userland in one binary, so the
/// first `sh -c` needs fewer blocks streamed. Their own config boots it via
/// `/sbin/init` and wants a display; nothing here does — every command is a
/// direct `cx.run("/bin/sh", ["-c", …])`, so there is no init, no display and
/// no login to wait for. That is the fastest path to a shell.
const DISK: &str = "wss://disks.webvm.io/alpine_20251007.ext2";

/// The IndexedDB database holding the overlay's written blocks. Fixed name:
/// it is the same workspace across reloads, which is the whole point.
const CACHE: &str = "askk-workspace";

#[wasm_bindgen(inline_js = r#"
let linux = null, booting = null, queue = Promise.resolve(), out = [];
// What the page can say about the workspace without waiting for it. The boot
// is a promise nobody may block on, so its outcome has to be readable as a
// value: idle → booting → ready, or error with the reason attached.
let state = "idle", reason = "";

function load(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("could not load the CheerpX engine from " + src));
    document.head.appendChild(el);
  });
}

async function bootOnce(engine, disk, cache) {
  if (typeof document === "undefined")
    throw new Error("the workspace runs in the page, not in an agent's Worker");
  if (!self.crossOriginIsolated)
    throw new Error("this page is not cross-origin isolated, so SharedArrayBuffer is unavailable");
  if (!self.CheerpX) await load(engine);
  const base = await CheerpX.CloudDevice.create(disk);
  const cached = await CheerpX.IDBDevice.create(cache);
  const overlay = await CheerpX.OverlayDevice.create(base, cached);
  const cx = await CheerpX.Linux.create({ mounts: [
    { type: "ext2", dev: overlay, path: "/" },
    { type: "devs", path: "/dev" },
    { type: "devpts", path: "/dev/pts" },
    { type: "proc", path: "/proc" },
    { type: "sys", path: "/sys" },
  ]});
  const decoder = new TextDecoder();
  cx.setCustomConsole((data) => {
    out.push(typeof data === "number" ? String.fromCharCode(data) : decoder.decode(data, { stream: true }));
  }, 120, 40);
  linux = cx;
}

export function cx_boot(engine, disk, cache) {
  if (!booting) {
    state = "booting"; reason = "";
    booting = bootOnce(engine, disk, cache).then(
      () => { state = "ready"; },
      (e) => {
        // A failed boot is retryable: the next command tries again, which is
        // what makes a boot that raced the service worker's isolation reload
        // recoverable without a page reload.
        booting = null; state = "error"; reason = (e && e.message) || String(e);
        throw e;
      },
    );
  }
  return booting;
}

export function cx_state() { return state === "error" ? "error:" + reason : state; }

// One command at a time: a second cx.run while the first is live would
// interleave two commands' output in one console.
export function cx_exec(command) {
  const run = queue.then(async () => {
    out = [];
    const status = await linux.run("/bin/sh", ["-c", command], {
      env: ["HOME=/root", "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "TERM=dumb"],
      cwd: "/root", uid: 0, gid: 0,
    });
    // The console is a terminal: it carries escape sequences and CRLF that
    // belong to a screen, not to a captured result.
    const text = out.join("")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
      .replace(/\r\n/g, "\n");
    const code = typeof status === "number" ? status : (status && status.status) | 0;
    return JSON.stringify({ status: code, output: text });
  });
  queue = run.catch(() => {});
  return run;
}
"#)]
extern "C" {
    #[wasm_bindgen(catch)]
    async fn cx_boot(engine: &str, disk: &str, cache: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn cx_exec(command: String) -> Result<JsValue, JsValue>;
    fn cx_state() -> String;
}

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

/// The engine, from Leaning Tech's CDN (see the module note on the licence).
///
/// 1.3.1, NOT the 1.2.8 the research quoted: with 1.2.8 and this Alpine image
/// `CheerpX.Linux.create` never resolves — measured, twice, at a 120 s timeout
/// with no error and no console output. 1.3.1 mounts the same image in 2.2 s.
/// The engine and the disk are published separately and this one is from
/// October 2025, so the pair has to be pinned together, not each to "latest".
const ENGINE: &str = "https://cxrtnc.leaningtech.com/1.3.1/cx.js";

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
}
