//! Browser port implementations: brokered net, clock, rng, and the one
//! timer the UI needs. The model broker lives in `model.rs`; IndexedDB
//! storage in `idb.rs` (200-line rule).

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use kernel::{
    BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, NetError, NetPort,
    RngPort, Timestamp,
};

/// `NetPort` over fetch with the user-configured allowlist (I2). No endpoint
/// resolution exists yet (ADR-006 settings, G5), so every request is either
/// off-allowlist (Denied) or unresolvable (Transport) — honestly typed.
pub struct FetchNet {
    allowlist: Vec<EndpointName>,
}

impl FetchNet {
    /// Allowlist comes from settings — a user action, never a module grant
    /// (ADR-006).
    pub fn new(allowlist: Vec<EndpointName>) -> FetchNet {
        FetchNet { allowlist }
    }
}

impl NetPort for FetchNet {
    fn fetch<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        _req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>> {
        let result = if self.allowlist.contains(endpoint) {
            Err(NetError::Transport {
                message: "endpoint resolution lands with ADR-006 settings (G5)".into(),
            })
        } else {
            Err(NetError::Denied {
                endpoint: endpoint.0.clone(),
            })
        };
        Box::pin(std::future::ready(result))
    }
}

/// `ClockPort` over `Date.now()` — the ONE place wall-clock time enters the
/// system; everything downstream receives it as data (I7).
#[derive(Debug, Default)]
pub struct BrowserClock;

impl ClockPort for BrowserClock {
    fn now(&self) -> Timestamp {
        Timestamp(js_sys::Date::now() as i64)
    }
}

/// `RngPort` over `crypto.getRandomValues` — same one-door rationale.
#[derive(Debug, Default)]
pub struct BrowserRng;

impl RngPort for BrowserRng {
    fn fill(&self, buf: &mut [u8]) {
        if let Some(window) = web_sys::window() {
            if let Ok(crypto) = window.crypto() {
                let _ = crypto.get_random_values_with_u8_array(buf);
            }
        }
    }
}

/// Wait, in a browser. Lives here because `adapters_web` is the only crate
/// allowed to know browsers exist — the UI's turn watcher needs a timer and
/// must not grow a timer dependency of its own to get one.
pub async fn sleep(ms: i32) -> Result<(), JsValue> {
    let window = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms);
    });
    JsFuture::from(promise).await.map(|_| ())
}
