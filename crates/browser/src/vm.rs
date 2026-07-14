//! The `shell` tool's browser executor: runs commands in the persistent
//! in-browser guest over its serial line. Two engines share the console
//! (see `ui::vm::VmConsole`): v86 (`window.AskkV86`) and container2wasm
//! (`window.AskkC2W`) — the executor routes to whichever one currently has
//! a ready shell. The VM boots once at
//! app load (see `ui::vm::VmConsole`), so by the time an agent calls `shell`
//! the guest is usually already at a prompt; the executor still waits (bounded)
//! for `shellReady` so a command issued right after load doesn't race the boot.

/// The DOM id of the persistent serial console (shared with `ui::vm` + the
/// v86 bundle's VM registry). Read only from the wasm executor.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const SERIAL_HOST: &str = "askk-v86-serial";

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

    /// Whichever engine currently has a ready shell (c2w checked first —
    /// only one owns the console at a time, so order is cosmetic).
    fn api() -> Option<JsValue> {
        ["AskkC2W", "AskkV86"]
            .iter()
            .filter_map(|n| global(n))
            .find(ready)
    }

    fn call(obj: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, String> {
        let func: Function = Reflect::get(obj, &JsValue::from_str(name))
            .map_err(|_| format!("AskkV86.{name} missing"))?
            .dyn_into()
            .map_err(|_| format!("AskkV86.{name} is not a function"))?;
        let array = js_sys::Array::new();
        for arg in args {
            array.push(arg);
        }
        Reflect::apply(&func, obj, &array).map_err(|e| format!("AskkV86.{name}: {e:?}"))
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
