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

use crate::endpoint::Endpoint;
use crate::overrides::stamp_model;
use crate::wire::{asked_model, js_message, read_reply};

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

    /// Whether THAT entry has a key of its own — keys are per entry, so the
    /// question only makes sense with a name attached.
    pub fn entry_has_key(&self, name: &str) -> bool {
        self.endpoint.borrow().has_key(name)
    }

    /// Why this build cannot call that entry, if it cannot — asked when the
    /// entry is PICKED, so the pane refuses at selection rather than promising
    /// a call that fails one send later (`ux-walker`, increment 04).
    pub fn entry_problem(&self, name: &str) -> Option<String> {
        let c = self.endpoint.borrow().catalogue();
        match c.resolve(name)?.chat_url() {
            Ok(_) => None,
            Err(kernel::ModelError::Unsupported { detail }) => Some(detail),
            Err(e) => Some(format!("{e:?}")),
        }
    }

    /// Forget the pick, the overrides and every saved key.
    pub fn reset(&self) {
        self.endpoint.borrow_mut().reset();
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

    /// One request with THAT ENTRY's credential attached: the last stop before
    /// the wire. `entry` is the catalogue entry this URL belongs to, so a key
    /// saved for one entry can never ride a call to another's origin.
    fn request(&self, url: &str, body: &str, entry: &str) -> Result<web_sys::Request, ModelError> {
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
        let key = self.endpoint.borrow().api_key_for(entry).to_string();
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
            let (body, url, name) = {
                let e = self.endpoint.borrow();
                let entry = e.resolve(&asked_model(body_json))?;
                (
                    stamp_model(body_json, &entry.model),
                    entry.chat_url()?,
                    entry.name,
                )
            };
            let request = self.request(&url, &body, &name)?;
            let resp = JsFuture::from(window.fetch_with_request(&request))
                .await
                .map_err(|e| ModelError::Transport {
                    message: format!("{url} unreachable: {}", js_message(&e)),
                })?;
            read_reply(resp.unchecked_into()).await
        })
    }
}
