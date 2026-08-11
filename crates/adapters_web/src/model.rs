//! `ModelPort` over fetch, and the ADR-006 credential broker.
//!
//! The endpoint the user configures lives HERE and nowhere upstream: `core`,
//! the agent, the Document and the event log all speak the symbolic name
//! "model", and this file is the one place that knows a base URL, attaches an
//! `Authorization` header, and touches the network (I6, I13). A key therefore
//! cannot reach a module, an event, or a prompt — there is no code path.

use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply};

/// A page that cannot reach the endpoint must SAY so, not hang: a cross-origin
/// call the browser refuses (COEP, mixed content, Chrome 142+ Local Network
/// Access) can otherwise sit there indefinitely.
const TIMEOUT_MS: f64 = 30_000.0;

/// The same-origin proxy (`serve.py`, or a hosting reverse proxy) — the
/// default so a fresh install works with no configuration at all (I15).
const DEFAULT_BASE: &str = "/v1";

/// One configured model endpoint. `api_key` is the credential; it is written
/// to storage by the composition root and read back into this struct, and it
/// leaves the process only in the `Authorization` header of a call.
#[derive(Clone, Default)]
struct Endpoint {
    base_url: String,
    api_key: String,
}

pub struct FetchModel {
    /// `config/keys/model` (ADR-005 record layout).
    profile_key: String,
    endpoint: std::cell::RefCell<Endpoint>,
    /// Discovered upstream model id, cached per endpoint; cleared on change.
    model_id: std::cell::RefCell<Option<String>>,
}

impl FetchModel {
    /// Build against the `config/keys/*` profile records (ADR-005 schema).
    pub fn new(profiles_key_prefix: &str) -> FetchModel {
        FetchModel {
            profile_key: format!("{profiles_key_prefix}model"),
            endpoint: Default::default(),
            model_id: Default::default(),
        }
    }

    /// The storage key of the profile — the composition root persists there.
    pub fn profile_key(&self) -> &str {
        &self.profile_key
    }

    /// Point the broker at an endpoint (settings, a user action — never a
    /// module grant). Clears the discovered model id: a new endpoint serves
    /// different models.
    pub fn set_endpoint(&self, base_url: &str, api_key: &str) {
        *self.endpoint.borrow_mut() = Endpoint {
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            api_key: api_key.trim().to_string(),
        };
        *self.model_id.borrow_mut() = None;
    }

    /// The profile as the record stored under `profile_key` — the only place
    /// the key is serialized, and it never leaves `adapters_web`.
    pub fn profile_json(&self) -> String {
        let e = self.endpoint.borrow();
        serde_json::json!({ "base_url": e.base_url, "api_key": e.api_key }).to_string()
    }

    /// Load that record back (boot). Unreadable records are ignored: a broken
    /// profile degrades to the same-origin default, it does not fail boot.
    pub fn load_profile(&self, raw: &str) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default();
            self.set_endpoint(s("base_url"), s("api_key"));
        }
    }

    /// What the settings pane shows: the base URL, and whether a key is set —
    /// never the key itself.
    pub fn endpoint_summary(&self) -> (String, bool) {
        let e = self.endpoint.borrow();
        (e.base_url.clone(), !e.api_key.is_empty())
    }

    fn base(&self) -> String {
        let e = self.endpoint.borrow();
        if e.base_url.is_empty() {
            DEFAULT_BASE.to_string()
        } else {
            e.base_url.clone()
        }
    }

    /// Build one request with the credential attached — the last stop before
    /// the network, and the only caller of `set` for `Authorization`.
    fn request(&self, url: &str, body: Option<&str>) -> Result<web_sys::Request, ModelError> {
        let transport = |m: String| ModelError::Transport { message: m };
        let init = web_sys::RequestInit::new();
        init.set_method(if body.is_some() { "POST" } else { "GET" });
        init.set_signal(Some(&web_sys::AbortSignal::timeout_with_f64(TIMEOUT_MS)));
        if let Some(b) = body {
            init.set_body(&JsValue::from_str(b));
        }
        let req = web_sys::Request::new_with_str_and_init(url, &init)
            .map_err(|e| transport(format!("request build: {e:?}")))?;
        let set = |k: &str, v: &str| {
            req.headers()
                .set(k, v)
                .map_err(|e| transport(format!("headers: {e:?}")))
        };
        set("content-type", "application/json")?;
        let key = self.endpoint.borrow().api_key.clone();
        if !key.is_empty() {
            set("authorization", &format!("Bearer {key}"))?;
        }
        Ok(req)
    }

    /// First model id the upstream advertises, cached. Failure is fine: the
    /// request goes out with the placeholder and the provider's own error
    /// surfaces (honest, typed) instead of a guessed name.
    async fn discover_model(&self, window: &web_sys::Window) -> Option<String> {
        if let Some(id) = self.model_id.borrow().clone() {
            return Some(id);
        }
        let req = self.request(&format!("{}/models", self.base()), None).ok()?;
        let resp = JsFuture::from(window.fetch_with_request(&req)).await.ok()?;
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
            let url = format!("{}/chat/completions", self.base());
            let request = self.request(&url, Some(&body))?;
            let resp = JsFuture::from(window.fetch_with_request(&request))
                .await
                .map_err(|e| ModelError::Transport {
                    message: format!("{url} unreachable: {}", js_message(&e)),
                })?;
            read_reply(resp.unchecked_into()).await
        })
    }
}

/// A JS exception in one readable sentence. `{:?}` on a `JsValue` prints the
/// whole wasm stack trace, which is noise in a message a person has to read.
fn js_message(value: &JsValue) -> String {
    value
        .dyn_ref::<js_sys::Error>()
        .map(|e| String::from(e.message()))
        .unwrap_or_else(|| format!("{value:?}"))
}

/// Body in, typed outcome out. Non-2xx is the provider's own words — never
/// smoothed into a reply.
async fn read_reply(resp: web_sys::Response) -> Result<ModelReply, ModelError> {
    let transport = |m: String| ModelError::Transport { message: m };
    let status = resp.status();
    let text = JsFuture::from(resp.text().map_err(|e| transport(format!("text(): {e:?}")))?)
        .await
        .map_err(|e| transport(format!("body read: {e:?}")))?
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
}
