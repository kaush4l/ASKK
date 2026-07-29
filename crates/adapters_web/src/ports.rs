//! Browser port implementations: fetch model broker, brokered net, clock,
//! rng. IndexedDB storage lives in `idb.rs` (200-line rule).

use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use kernel::{
    BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, ModelError, ModelPort,
    ModelReply, NetError, NetPort, RngPort, Timestamp,
};

/// `ModelPort` over fetch. Resolves the symbolic endpoint name and would
/// attach the credential HERE — the last stop before the network, so a key
/// exists nowhere upstream (ADR-006, §4.1). G4/v1: the ONLY profile is
/// "model" → the same-origin `/v1` proxy (serve.py / the hosting reverse
/// proxy), which needs no credential — that is why it is the v1 target;
/// `config/keys/*` profile records (the constructor's prefix) land with the
/// ADR-006 settings module, a HUMAN GATE.
pub struct FetchModel {
    profiles_key_prefix: String,
    /// Discovered upstream model id, cached after the first call.
    /// PROVISIONAL (G4): with no settings module yet, the profile's model
    /// name is "whatever `/v1/models` lists first" — works against
    /// llama.cpp, LM Studio, ollama, vLLM alike. ADR-006 settings replace
    /// this with a user-chosen profile.
    model_id: std::cell::RefCell<Option<String>>,
}

impl FetchModel {
    /// Build against the `config/keys/*` profile records (ADR-005 schema).
    pub fn new(profiles_key_prefix: &str) -> FetchModel {
        FetchModel {
            profiles_key_prefix: profiles_key_prefix.to_string(),
            model_id: std::cell::RefCell::new(None),
        }
    }

    /// First model id the upstream advertises, cached. Failure is fine:
    /// the request goes out with the placeholder and the provider's own
    /// error surfaces (honest, typed) instead of a guessed name.
    async fn discover_model(&self, window: &web_sys::Window) -> Option<String> {
        if let Some(id) = self.model_id.borrow().clone() {
            return Some(id);
        }
        let resp = JsFuture::from(window.fetch_with_str("/v1/models"))
            .await
            .ok()?;
        let resp: web_sys::Response = resp.unchecked_into();
        let text = JsFuture::from(resp.text().ok()?).await.ok()?.as_string()?;
        let v: serde_json::Value = serde_json::from_str(&text).ok()?;
        let id = v.get("data")?.get(0)?.get("id")?.as_str()?.to_string();
        *self.model_id.borrow_mut() = Some(id.clone());
        Some(id)
    }
}

impl ModelPort for FetchModel {
    fn call<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        Box::pin(async move {
            let _ = &self.profiles_key_prefix; // used when profiles exist (G5)
            if endpoint.0 != "model" {
                return Err(ModelError::EndpointUnknown {
                    endpoint: endpoint.0.clone(),
                });
            }
            let window = web_sys::window().ok_or_else(|| ModelError::Transport {
                message: "no window".into(),
            })?;
            // Attach the profile's model name — the adapter's job, exactly
            // like a credential: the core never knows the concrete model.
            let body = match self.discover_model(&window).await {
                Some(id) => serde_json::from_str::<serde_json::Value>(body_json)
                    .map(|mut v| {
                        v["model"] = serde_json::Value::String(id);
                        v.to_string()
                    })
                    .unwrap_or_else(|_| body_json.to_string()),
                None => body_json.to_string(),
            };
            let url = "/v1/chat/completions";
            let init = web_sys::RequestInit::new();
            init.set_method("POST");
            init.set_body(&JsValue::from_str(&body));
            let request = web_sys::Request::new_with_str_and_init(url, &init).map_err(|e| {
                ModelError::Transport {
                    message: format!("request build: {e:?}"),
                }
            })?;
            request
                .headers()
                .set("content-type", "application/json")
                .map_err(|e| ModelError::Transport {
                    message: format!("headers: {e:?}"),
                })?;
            let resp = JsFuture::from(window.fetch_with_request(&request))
                .await
                .map_err(|e| ModelError::Transport {
                    message: format!("fetch: {e:?}"),
                })?;
            let resp: web_sys::Response = resp.unchecked_into();
            let status = resp.status();
            let text = JsFuture::from(resp.text().map_err(|e| ModelError::Transport {
                message: format!("text(): {e:?}"),
            })?)
            .await
            .map_err(|e| ModelError::Transport {
                message: format!("body read: {e:?}"),
            })?
            .as_string()
            .unwrap_or_default();
            if !(200..300).contains(&status) {
                return Err(ModelError::Provider {
                    status,
                    message: text,
                });
            }
            Ok(ModelReply {
                body_json: text,
                usage: None,
            })
        })
    }
}

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
