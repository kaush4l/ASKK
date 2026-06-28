//! Geolocation, clipboard, notifications, and speech synthesis (wasm-only;
//! host builds get stubs). Shared by the Capabilities page's live tests and the
//! `geolocate` / `clipboard_*` / `notify_user` / `speak_text` tools.

use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, closure::Closure};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;

/// A geolocation fix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoFix {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: f64,
}

/// Resolve the device's current position (prompts on first use).
#[cfg(target_arch = "wasm32")]
pub async fn current_position(timeout_ms: u32) -> Result<GeoFix, String> {
    // `GeolocationPosition`/`GeolocationCoordinates` are still unstable-gated in
    // web-sys 0.3.100 (`--cfg=web_sys_unstable_apis`); `Position`/`Coordinates`
    // are the stable bindings for the same browser objects.
    use web_sys::{Position, PositionError, PositionOptions};

    let geolocation = web_sys::window()
        .ok_or_else(|| "no window: geolocation must run on the page thread".to_string())?
        .navigator()
        .geolocation()
        .map_err(|err| format!("geolocation unavailable: {err:?}"))?;

    let (tx, rx) = futures_channel::oneshot::channel::<Result<GeoFix, String>>();
    let tx = std::rc::Rc::new(std::cell::RefCell::new(Some(tx)));

    let tx_ok = std::rc::Rc::clone(&tx);
    let on_success = Closure::<dyn FnMut(Position)>::new(move |position: Position| {
        let coords = position.coords();
        if let Some(tx) = tx_ok.borrow_mut().take() {
            let _ = tx.send(Ok(GeoFix {
                latitude: coords.latitude(),
                longitude: coords.longitude(),
                accuracy_m: coords.accuracy(),
            }));
        }
    });
    let tx_err = std::rc::Rc::clone(&tx);
    let on_error = Closure::<dyn FnMut(PositionError)>::new(move |err: PositionError| {
        if let Some(tx) = tx_err.borrow_mut().take() {
            let _ = tx.send(Err(format!(
                "geolocation failed (code {}): {}",
                err.code(),
                err.message()
            )));
        }
    });

    let options = PositionOptions::new();
    options.set_timeout(timeout_ms.clamp(1_000, 60_000));
    geolocation
        .get_current_position_with_error_callback_and_options(
            on_success.as_ref().unchecked_ref(),
            Some(on_error.as_ref().unchecked_ref()),
            &options,
        )
        .map_err(|err| format!("geolocation request rejected: {err:?}"))?;

    rx.await
        .map_err(|_| "geolocation callbacks never fired".to_string())?
}

/// Read the clipboard's text content (browser prompts per read).
#[cfg(target_arch = "wasm32")]
pub async fn clipboard_read_text() -> Result<String, String> {
    let clipboard = web_sys::window()
        .ok_or_else(|| "no window: clipboard must run on the page thread".to_string())?
        .navigator()
        .clipboard();
    JsFuture::from(clipboard.read_text())
        .await
        .map_err(|err| format!("clipboard read denied: {err:?}"))?
        .as_string()
        .ok_or_else(|| "clipboard returned non-text".to_string())
}

/// Replace the clipboard's content with `text`.
#[cfg(target_arch = "wasm32")]
pub async fn clipboard_write_text(text: &str) -> Result<(), String> {
    let clipboard = web_sys::window()
        .ok_or_else(|| "no window: clipboard must run on the page thread".to_string())?
        .navigator()
        .clipboard();
    JsFuture::from(clipboard.write_text(text))
        .await
        .map(|_| ())
        .map_err(|err| format!("clipboard write denied: {err:?}"))
}

/// Show a system notification, requesting permission first if needed.
#[cfg(target_arch = "wasm32")]
pub async fn show_notification(title: &str, body: &str) -> Result<(), String> {
    use web_sys::{Notification, NotificationOptions, NotificationPermission};

    let mut permission = Notification::permission();
    if permission == NotificationPermission::Default {
        let promise = Notification::request_permission()
            .map_err(|err| format!("notification permission request failed: {err:?}"))?;
        let _ = JsFuture::from(promise).await;
        permission = Notification::permission();
    }
    if permission != NotificationPermission::Granted {
        return Err("notification permission not granted".to_string());
    }
    let options = NotificationOptions::new();
    options.set_body(body);
    Notification::new_with_options(title, &options)
        .map(|_| ())
        .map_err(|err| format!("notification failed: {err:?}"))
}

/// Speak `text` aloud with the browser's speech synthesis. Fire-and-forget:
/// returns once the utterance is queued, not when speech finishes.
#[cfg(target_arch = "wasm32")]
pub fn speak_text(text: &str) -> Result<(), String> {
    use web_sys::SpeechSynthesisUtterance;

    let synthesis = web_sys::window()
        .ok_or_else(|| "no window: speech must run on the page thread".to_string())?
        .speech_synthesis()
        .map_err(|err| format!("speech synthesis unavailable: {err:?}"))?;
    let utterance = SpeechSynthesisUtterance::new_with_text(text)
        .map_err(|err| format!("utterance rejected: {err:?}"))?;
    synthesis.speak(&utterance);
    Ok(())
}

// ── Host stubs: keep `cargo test` compiling without a browser. ─────────────

#[cfg(not(target_arch = "wasm32"))]
pub async fn current_position(_timeout_ms: u32) -> Result<GeoFix, String> {
    Err("geolocation requires the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn clipboard_read_text() -> Result<String, String> {
    Err("clipboard requires the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn clipboard_write_text(_text: &str) -> Result<(), String> {
    Err("clipboard requires the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn show_notification(_title: &str, _body: &str) -> Result<(), String> {
    Err("notifications require the browser build".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn speak_text(_text: &str) -> Result<(), String> {
    Err("speech synthesis requires the browser build".to_string())
}
