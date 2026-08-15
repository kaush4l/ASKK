//! Browser port implementations: brokered net, clock, rng, and the one
//! timer the UI needs. The model broker lives in `model.rs`; IndexedDB
//! storage in `idb.rs` (200-line rule).

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use kernel::{
    BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, ModelError, NetError,
    NetPort, RngPort, Timestamp,
};

/// A search is not a generation: nothing about it is worth waiting five
/// minutes for, and a model waiting on one is a turn nobody can steer.
const SEARCH_TIMEOUT_MS: f64 = 20_000.0;

/// `NetPort` over fetch with the user-configured allowlist (I2, ADR-006).
///
/// The allowlist IS the address book: a name with no entry cannot be called,
/// and there is no way to hand this broker a URL — the core names `search` and
/// this file is the only place that knows where that is. An empty list (the
/// shipped state) therefore denies everything, which is the default-deny
/// posture stated as data rather than as a rule someone has to remember.
#[derive(Default)]
pub struct FetchNet {
    /// Endpoint name → base URL. `RefCell` because a save in Settings must
    /// reach the broker the core is already holding: the model broker repoints
    /// the same way, and a page that had to reload to search would be a page
    /// that says a setting applied before it does.
    allowlist: std::cell::RefCell<Vec<(EndpointName, String)>>,
}

impl FetchNet {
    /// EMPTY, always: a broker is born denying everything and gets its
    /// destinations from `allow`, which the composition root calls with what
    /// the user saved. There is no constructor that takes a list, because
    /// there is no caller that has one before reading the settings (ADR-006:
    /// an allowlist is a user action, never a module grant).
    pub fn new() -> FetchNet {
        FetchNet {
            allowlist: std::cell::RefCell::new(Vec::new()),
        }
    }

    /// Point one name at one base URL, or REMOVE it when the URL is blank —
    /// clearing the setting has to take the destination off the list, not
    /// leave an empty base every path would be appended to.
    pub fn allow(&self, endpoint: &str, base_url: &str) {
        let name = EndpointName(endpoint.to_string());
        let mut list = self.allowlist.borrow_mut();
        list.retain(|(n, _)| *n != name);
        let base = base_url.trim().trim_end_matches('/');
        if !base.is_empty() {
            list.push((name, base.to_string()));
        }
    }

    fn base_of(&self, endpoint: &EndpointName) -> Option<String> {
        self.allowlist
            .borrow()
            .iter()
            .find(|(name, _)| name == endpoint)
            .map(|(_, base)| base.clone())
    }
}

/// A transport failure from the shared `global_fetch`, retyped. Same event,
/// different port: `wire` speaks `ModelError` because the model path is its
/// first caller, and the message inside it is the part that matters.
fn transport(e: ModelError) -> NetError {
    NetError::Transport {
        message: match e {
            ModelError::Transport { message, .. } => message,
            other => format!("{other:?}"),
        },
    }
}

impl NetPort for FetchNet {
    fn fetch<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>> {
        let base = self.base_of(endpoint);
        Box::pin(async move {
            let Some(base) = base else {
                return Err(NetError::Denied {
                    endpoint: endpoint.0.clone(),
                });
            };
            if req.body.is_some() {
                return Err(NetError::Transport {
                    message: "this broker sends no request body; nothing asks it to".into(),
                });
            }
            let url = format!("{base}{}", req.path);
            let init = web_sys::RequestInit::new();
            init.set_method(&req.method);
            init.set_signal(Some(&web_sys::AbortSignal::timeout_with_f64(
                SEARCH_TIMEOUT_MS,
            )));
            let request = web_sys::Request::new_with_str_and_init(&url, &init)
                .map_err(|e| NetError::Transport {
                    message: format!("request build: {e:?}"),
                })?;
            let promise = crate::wire::global_fetch(&request).map_err(transport)?;
            let resp: web_sys::Response = JsFuture::from(promise)
                .await
                .map_err(|e| {
                    transport(crate::wire::call_failed(
                        &url,
                        &e,
                        (SEARCH_TIMEOUT_MS / 1000.0) as u32,
                    ))
                })?
                .unchecked_into();
            let status = resp.status();
            // Text, not bytes: every brokered endpoint this build has is a JSON
            // API, and `arrayBuffer` would only add a conversion on the way to
            // the same string. The port's type stays bytes because the port is
            // not the one deciding that.
            let text = JsFuture::from(resp.text().map_err(|e| NetError::Transport {
                message: format!("text(): {e:?}"),
            })?)
            .await
            .map_err(|e| NetError::Transport {
                message: format!("body read: {e:?}"),
            })?
            .as_string()
            .unwrap_or_default();
            Ok(BrokeredResponse {
                status,
                body: text.into_bytes(),
            })
        })
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
