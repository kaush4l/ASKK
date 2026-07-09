//! Browser glue the UI may not touch directly (ADR-013 keeps `web_sys` out
//! of `ui/`): hash routing, the `data-theme` attribute, wall-clock time, and
//! a UI-tick sleep. Host builds get inert stubs so the smoke binary and unit
//! tests compile without a DOM.

#[cfg(target_arch = "wasm32")]
mod imp {
    use wasm_bindgen_futures::JsFuture;

    /// `#/Chat` → `Some("Chat")`.
    pub fn read_hash() -> Option<String> {
        let hash = web_sys::window()?.location().hash().ok()?;
        let key = hash.trim_start_matches('#').trim_start_matches('/');
        (!key.is_empty()).then(|| key.to_string())
    }

    /// Mirror the stage into the URL (`#/Chat`) so views are linkable.
    pub fn write_hash(key: &str) {
        if let Some(window) = web_sys::window() {
            let _ = window.location().set_hash(&format!("/{key}"));
        }
    }

    /// Set `data-theme` on `<html>`; the `[data-theme]` CSS blocks recolor.
    pub fn apply_theme(id: &str) {
        let doc = web_sys::window().and_then(|w| w.document());
        if let Some(root) = doc.and_then(|d| d.document_element()) {
            let _ = root.set_attribute("data-theme", id);
        }
    }

    pub fn now_ms() -> u64 {
        js_sys::Date::now() as u64
    }

    /// `setTimeout` as a future — drives the elapsed-clock tick loop.
    pub async fn sleep_ms(ms: u64) {
        let promise = js_sys::Promise::new(&mut |resolve, _reject| {
            if let Some(window) = web_sys::window() {
                let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                    &resolve,
                    i32::try_from(ms).unwrap_or(i32::MAX),
                );
            }
        });
        let _ = JsFuture::from(promise).await;
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    pub fn read_hash() -> Option<String> {
        None
    }

    pub fn write_hash(_key: &str) {}

    pub fn apply_theme(_id: &str) {}

    pub fn now_ms() -> u64 {
        0
    }

    /// Never resolves on the host: the tick loop that awaits this simply
    /// parks instead of spinning (the UI is not launched on host anyway).
    pub async fn sleep_ms(_ms: u64) {
        std::future::pending::<()>().await;
    }
}

pub use imp::*;
