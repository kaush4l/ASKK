//! The container2wasm VM engine's host wiring — BOTH halves live here
//! (ADR-045): the console boot glue the frontend's `VmConsole` mounts
//! ([`console_bundle`]/[`console_boot`]/[`console_destroy`]/[`state_label`])
//! and the `shell` tool's browser executor ([`SerialShell`]), which runs
//! commands in the same persistent guest over its serial line.
//!
//! **container2wasm** (`assets/vm/c2w.js`, from `scripts/vm-c2w/`): 64-bit
//! Alpine — the whole container + Bochs x86_64 emulator is ONE WASI module
//! (`alpine64.wasm`) run in a worker, wired to the console via xterm-pty.
//! Wizer pre-boot makes it prompt-ready in ~3 s. Exposes `window.AskkC2W`.
//!
//! Needs cross-origin isolation (SharedArrayBuffer): the console explains and
//! stays "boot failed" on browsers without it (e.g. Safari, which lacks
//! `COEP: credentialless`). The VM boots once at app load, so by the time an
//! agent calls `shell` the guest is usually already at a prompt; the executor
//! still waits (bounded) for `shellReady` so a command issued right after
//! load doesn't race the boot.

use dioxus::document::Eval;
use dioxus::prelude::*;

/// The DOM id of the persistent serial console (shared verbatim with the
/// frontend's `VmConsole` and the c2w bundle). Keeps its legacy
/// `askk-v86-serial` value to avoid churning the id across the eval boundary.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const SERIAL_HOST: &str = "askk-v86-serial";

const C2W_BUNDLE: Asset = asset!("/assets/vm/c2w.js");
const C2W_WASM: Asset = asset!("/assets/vm/alpine64.wasm");
const C2W_WORKER: Asset = asset!("/assets/vm/c2w/worker.js");
const C2W_WORKER_TOOLS: Asset = asset!("/assets/vm/c2w/workerTools.js");
const C2W_WASI_INDEX: Asset = asset!("/assets/vm/c2w/wasi_shim_index.js");
const C2W_WASI_DEFS: Asset = asset!("/assets/vm/c2w/wasi_shim_wasi_defs.js");
const C2W_WORKER_UTIL: Asset = asset!("/assets/vm/c2w/worker-util.js");
const C2W_WASI_UTIL: Asset = asset!("/assets/vm/c2w/wasi-util.js");

/// Glue executed via `document::eval`: waits for the c2w bundle global + host
/// element, boots Alpine, tears down on `{cmd:"close"}`. Token-guarded
/// teardown against remount races (bundle-owned). The JS-side `SERIAL_HOST`
/// mirrors [`SERIAL_HOST`] verbatim.
const VM_GLUE: &str = r#"
const SERIAL_HOST = "askk-v86-serial";
while (!(window.AskkC2W && document.getElementById(SERIAL_HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const engine = window.AskkC2W;
const token = engine.boot(SERIAL_HOST, {
    serialHostId: SERIAL_HOST,
    wasmUrl: "__C2W_WASM__",
    workerUrl: "__C2W_WORKER__",
    supportUrls: {
        workerTools: "__C2W_WORKER_TOOLS__",
        wasiShimIndex: "__C2W_WASI_INDEX__",
        wasiDefs: "__C2W_WASI_DEFS__",
        workerUtil: "__C2W_WORKER_UTIL__",
        wasiUtil: "__C2W_WASI_UTIL__",
    },
    onState: (state) => dioxus.send({ state }),
});
for (;;) {
    const msg = await dioxus.recv();
    if (!msg || msg.cmd === "close") break;
}
engine.destroy(SERIAL_HOST, token);
"#;

fn glue() -> String {
    VM_GLUE
        .replace("__C2W_WASM__", &C2W_WASM.to_string())
        .replace("__C2W_WORKER_TOOLS__", &C2W_WORKER_TOOLS.to_string())
        .replace("__C2W_WORKER_UTIL__", &C2W_WORKER_UTIL.to_string())
        .replace("__C2W_WORKER__", &C2W_WORKER.to_string())
        .replace("__C2W_WASI_INDEX__", &C2W_WASI_INDEX.to_string())
        .replace("__C2W_WASI_DEFS__", &C2W_WASI_DEFS.to_string())
        .replace("__C2W_WASI_UTIL__", &C2W_WASI_UTIL.to_string())
}

/// The main-thread engine bundle — the `document::Script` src the console
/// component renders.
pub fn console_bundle() -> Asset {
    C2W_BUNDLE
}

/// Boot the guest into the mounted serial host element. The returned channel
/// reports `{state}` lifecycle messages (`recv`) and accepts `{cmd:"close"}`
/// (`send`, see [`console_destroy`]).
pub fn console_boot() -> Eval {
    dioxus::document::eval(&glue())
}

/// Tear the guest down. Remount-safe: the glue's token guard ignores stale
/// closes.
pub fn console_destroy(eval: &Eval) {
    let _ = eval.send(serde_json::json!({ "cmd": "close" }));
}

/// Human label for the `{state}` lifecycle messages the glue reports.
pub fn state_label(state: &str) -> &'static str {
    match state {
        "downloading" => "downloading image…",
        "booting" => "booting guest…",
        "ready" => "shell ready",
        "error" => "boot failed",
        _ => "starting…",
    }
}

#[cfg(target_arch = "wasm32")]
pub use imp::SerialShell;

#[cfg(target_arch = "wasm32")]
mod imp {
    use askk_engine::state::LocalBoxFuture;
    use askk_engine::tools::ShellExec;
    use js_sys::{Function, Promise, Reflect};
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    use super::SERIAL_HOST;

    /// Boot can take ~30 s (Alpine); wait up to this for the first command.
    const READY_TIMEOUT_MS: u32 = 60_000;
    /// Per-command wall clock handed to the JS side.
    const EXEC_TIMEOUT_MS: u32 = 30_000;

    pub struct SerialShell;

    impl SerialShell {
        pub fn new() -> Self {
            Self
        }
    }

    fn global(name: &str) -> Option<JsValue> {
        let v = Reflect::get(&web_sys::window()?.into(), &JsValue::from_str(name)).ok()?;
        (!v.is_undefined() && !v.is_null()).then_some(v)
    }

    fn ready(api: &JsValue) -> bool {
        call(api, "shellReady", &[JsValue::from_str(SERIAL_HOST)])
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    /// The c2w engine, once its shell is ready.
    fn api() -> Option<JsValue> {
        global("AskkC2W").filter(ready)
    }

    fn call(obj: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, String> {
        let func: Function = Reflect::get(obj, &JsValue::from_str(name))
            .map_err(|_| format!("AskkC2W.{name} missing"))?
            .dyn_into()
            .map_err(|_| format!("AskkC2W.{name} is not a function"))?;
        let array = js_sys::Array::new();
        for arg in args {
            array.push(arg);
        }
        Reflect::apply(&func, obj, &array).map_err(|e| format!("AskkC2W.{name}: {e:?}"))
    }

    async fn sleep(ms: i32) {
        let promise = Promise::new(&mut |resolve, _| {
            let _ = web_sys::window()
                .unwrap()
                .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms);
        });
        let _ = JsFuture::from(promise).await;
    }

    async fn await_ready() -> Result<JsValue, String> {
        let mut waited = 0u32;
        loop {
            if let Some(api) = api() {
                return Ok(api);
            }
            if waited >= READY_TIMEOUT_MS {
                return Err("VM is not ready (no shell prompt within timeout)".into());
            }
            sleep(500).await;
            waited += 500;
        }
    }

    impl ShellExec for SerialShell {
        fn exec<'a>(&'a self, command: &'a str) -> LocalBoxFuture<'a, Result<String, String>> {
            Box::pin(async move {
                let api = await_ready().await?;
                let out = call(
                    &api,
                    "exec",
                    &[
                        JsValue::from_str(SERIAL_HOST),
                        JsValue::from_str(command),
                        JsValue::from_f64(EXEC_TIMEOUT_MS as f64),
                    ],
                )?;
                let promise: Promise = out
                    .dyn_into()
                    .map_err(|_| "exec did not return a promise".to_string())?;
                let value = JsFuture::from(promise)
                    .await
                    .map_err(|e| format!("{e:?}"))?;
                Ok(value.as_string().unwrap_or_default())
            })
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use self::stub::SerialShell;

#[cfg(not(target_arch = "wasm32"))]
mod stub {
    use askk_engine::state::LocalBoxFuture;
    use askk_engine::tools::ShellExec;

    #[derive(Default)]
    pub struct SerialShell;

    impl SerialShell {
        pub fn new() -> Self {
            Self
        }
    }

    impl ShellExec for SerialShell {
        fn exec<'a>(&'a self, _command: &'a str) -> LocalBoxFuture<'a, Result<String, String>> {
            Box::pin(async { Err("shell is wasm-only (needs the in-browser VM)".to_string()) })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_label_covers_the_lifecycle() {
        assert_eq!(state_label("downloading"), "downloading image…");
        assert_eq!(state_label("booting"), "booting guest…");
        assert_eq!(state_label("ready"), "shell ready");
        assert_eq!(state_label("error"), "boot failed");
        assert_eq!(state_label("x"), "starting…");
    }

    #[test]
    fn glue_placeholders_all_replaced() {
        assert!(!glue().contains("__"), "unreplaced placeholder remains");
    }

    #[test]
    fn glue_boots_c2w() {
        assert!(VM_GLUE.contains("window.AskkC2W"), "c2w engine not wired");
        assert!(!VM_GLUE.contains("AskkV86"), "stale v86 reference in glue");
    }
}
