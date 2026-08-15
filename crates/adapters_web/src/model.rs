//! `ModelPort` over fetch, and the ADR-006 credential broker. The configured
//! endpoint lives HERE and nowhere upstream: `core`, the agent, the Document
//! and the event log all speak the symbolic name "model", and this is the one
//! file that knows a base URL, attaches an `Authorization` header, and touches
//! the network (I6, I13). A key cannot reach a module, an event, or a prompt —
//! there is no code path.

use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply, MODEL_ENDPOINT};

/// A page that cannot reach its endpoint must SAY so, not hang: a call the
/// browser refuses (COEP, Chrome 142+ Local Network Access) can hang forever.
///
/// Five minutes, not thirty seconds. Thirty was chosen when a turn was one
/// short completion; a local 12B asked for a plan, or any reasoning model,
/// routinely runs longer than that, and aborting mid-generation looks exactly
/// like an unreachable endpoint while being the opposite. The ceiling is still
/// there — it is the difference between slow and hung — it is just no longer
/// tighter than the work.
/// …AND THE BUDGET IS PUBLIC, because the page has to say it while it waits
/// (R12-2b). `waiting for the model — 98s` says nothing about what the wait is
/// waiting out; the number it is counting towards is this one.
pub const TIMEOUT_SECS: u32 = 300;
const TIMEOUT_MS: f64 = TIMEOUT_SECS as f64 * 1000.0;

/// What SETTINGS asks of this broker — the choice of endpoint, as against the
/// wire below (I12).
mod asked;

use crate::endpoint::Endpoint;
use crate::overrides::stamp_model;
use crate::wire::{asked_model, read_reply};

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

    /// One request with THAT ENTRY's credential attached: the last stop before
    /// the wire. `entry` is the catalogue entry this URL belongs to, so a key
    /// saved for one entry can never ride a call to another's origin.
    fn request(&self, url: &str, body: &str, entry: &str) -> Result<web_sys::Request, ModelError> {
        let transport = |m: String| ModelError::Transport {
            message: m,
            url: url.to_string(),
        };
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
            if endpoint.0 != MODEL_ENDPOINT {
                return Err(ModelError::EndpointUnknown {
                    endpoint: endpoint.0.clone(),
                });
            }
            // The core speaks the SYMBOLIC name (the agent's `model:` key);
            // the catalogue turns it into an endpoint and a model id here.
            let (body, url, name, model) = {
                let e = self.endpoint.borrow();
                let entry = e.resolve(&asked_model(body_json))?;
                (
                    stamp_model(body_json, &entry.model),
                    entry.chat_url()?,
                    entry.name,
                    entry.model,
                )
            };
            let request = self.request(&url, &body, &name)?;
            // Read from the SAME store `request` took the key from, so the two
            // cannot disagree about whether one was sent (22).
            let keyed = self.endpoint.borrow().has_key(&name);
            // `global_fetch`, not `window.fetch`: a sub-agent's turn runs
            // inside its own Worker, where there is no window (increment 06).
            let resp = JsFuture::from(crate::wire::global_fetch(&request)?)
                .await
                .map_err(|e| crate::wire::call_failed(&url, &e, TIMEOUT_SECS))?;
            read_reply(resp.unchecked_into(), &model, keyed).await
        })
    }

    /// The same line `call` resolves by, one step short of the wire, so the
    /// card cannot say one thing while the request does another. `resolve` is
    /// where the Settings pick outranks the agent's `model:` key — the fact the
    /// card was missing (21).
    fn resolves(&self, asked: &str) -> Option<(String, String)> {
        let entry = self.endpoint.borrow().resolve(asked).ok()?;
        Some((entry.name, entry.model))
    }
}
