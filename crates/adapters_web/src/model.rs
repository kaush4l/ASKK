//! `ModelPort` over fetch, and the ADR-006 credential broker. The configured
//! endpoint lives HERE and nowhere upstream: `core`, the agent, the Document
//! and the event log all speak the symbolic name "model", and this is the one
//! file that knows a base URL, attaches an `Authorization` header, and touches
//! the network (I6, I13). A key cannot reach a module, an event, or a prompt —
//! there is no code path.

use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply};

/// A page that cannot reach its endpoint must SAY so, not hang: a call the
/// browser refuses (COEP, Chrome 142+ Local Network Access) can hang forever.
const TIMEOUT_MS: f64 = 30_000.0;

use crate::endpoint::{stamp_model, Endpoint};

pub struct FetchModel {
    /// `config/keys/model` (ADR-005 record layout).
    profile_key: String,
    endpoint: std::cell::RefCell<Endpoint>,
}

impl FetchModel {
    /// Build against the `config/keys/*` profile records (ADR-005 schema).
    pub fn new(profiles_key_prefix: &str) -> FetchModel {
        FetchModel {
            profile_key: format!("{profiles_key_prefix}model"),
            endpoint: Default::default(),
        }
    }

    /// The storage key of the profile — the composition root persists there.
    pub fn profile_key(&self) -> &str {
        &self.profile_key
    }

    /// Install `public/models.json` — the shipped catalogue, before the
    /// user's stored layer goes on top of it.
    pub fn set_catalogue(&self, raw: &str) {
        self.endpoint.borrow_mut().set_catalogue(raw);
    }

    /// Pick a catalogue entry and override it. A `None` key keeps the stored
    /// one (`Endpoint::set`), which is what stops Save wiping a secret the
    /// write-only field never held.
    pub fn set_endpoint(&self, entry: &str, base_url: &str, api_key: Option<&str>, model: &str) {
        let mut e = self.endpoint.borrow_mut();
        e.select(entry);
        e.set(base_url, api_key, model);
    }

    /// The catalogue entry names, and which one is current.
    pub fn catalogue_names(&self) -> Vec<String> {
        self.endpoint.borrow().names()
    }

    pub fn current_entry(&self) -> String {
        self.endpoint.borrow().current()
    }

    /// What one named entry resolves to today — `(base_url, model, api_key_env)`,
    /// so Settings can prefill the fields when the selection changes.
    pub fn entry_fields(&self, name: &str) -> (String, String, String) {
        self.endpoint
            .borrow()
            .catalogue()
            .resolve(name)
            .map(|e| (e.base_url, e.model, e.api_key_env))
            .unwrap_or_default()
    }

    pub fn profile_json(&self) -> String {
        self.endpoint.borrow().profile_json()
    }

    pub fn load_profile(&self, raw: &str) {
        self.endpoint.borrow_mut().load_profile(raw);
    }

    /// The base URL, whether a key is set, the model name, and the env var the
    /// Python reads for this entry — never the key itself.
    pub fn endpoint_summary(&self) -> (String, bool, String, String) {
        self.endpoint.borrow().summary()
    }

    /// One request with the credential attached: the last stop before the wire.
    fn request(&self, url: &str, body: &str) -> Result<web_sys::Request, ModelError> {
        let transport = |m: String| ModelError::Transport { message: m };
        let init = web_sys::RequestInit::new();
        init.set_method("POST");
        init.set_signal(Some(&web_sys::AbortSignal::timeout_with_f64(TIMEOUT_MS)));
        init.set_body(&JsValue::from_str(body));
        let req = web_sys::Request::new_with_str_and_init(url, &init)
            .map_err(|e| transport(format!("request build: {e:?}")))?;
        let set = |k: &str, v: &str| {
            req.headers()
                .set(k, v)
                .map_err(|e| transport(format!("headers: {e:?}")))
        };
        set("content-type", "application/json")?;
        let key = self.endpoint.borrow().api_key().to_string();
        if !key.is_empty() {
            set("authorization", &format!("Bearer {key}"))?;
        }
        Ok(req)
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
            // The core speaks the SYMBOLIC name (the agent's `model:` key);
            // the catalogue turns it into an endpoint and a model id here.
            let (body, url) = {
                let e = self.endpoint.borrow();
                let entry = e.resolve(&asked_model(body_json))?;
                (stamp_model(body_json, &entry.model), entry.chat_url()?)
            };
            let request = self.request(&url, &body)?;
            let resp = JsFuture::from(window.fetch_with_request(&request))
                .await
                .map_err(|e| ModelError::Transport {
                    message: format!("{url} unreachable: {}", js_message(&e)),
                })?;
            read_reply(resp.unchecked_into()).await
        })
    }
}

/// The catalogue key the core asked for, out of the request body it wrote.
fn asked_model(body_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body_json)
        .ok()
        .and_then(|v| v.get("model")?.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// A JS exception in one readable sentence: `{:?}` on a `JsValue` prints the
/// whole wasm stack trace, which is noise in a message a person must read.
fn js_message(value: &JsValue) -> String {
    value
        .dyn_ref::<js_sys::Error>()
        .map(|e| String::from(e.message()))
        .unwrap_or_else(|| format!("{value:?}"))
}

/// Non-2xx is the provider's own words — never smoothed into a reply.
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
