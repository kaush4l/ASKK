//! Reading what came back off the wire, and the one thing we must read out of
//! what went onto it. Split from `model.rs` so that file stays inside the
//! 200-line rule (I12); no policy lives here, only bytes → values.

use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use kernel::{ModelError, ModelReply};

/// The catalogue key the core asked for, out of the request body it wrote.
pub(crate) fn asked_model(body_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body_json)
        .ok()
        .and_then(|v| v.get("model")?.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// A JS exception in one readable sentence: `{:?}` on a `JsValue` prints the
/// whole wasm stack trace, which is noise in a message a person must read.
pub(crate) fn js_message(value: &JsValue) -> String {
    // A rejected promise carries whatever was thrown. A Worker rejects with a
    // plain STRING — the sub-agent's own sentence — and `{:?}` wrapped it in
    // `JsValue("…")`, which put debug syntax in front of the one sentence the
    // reader needs (`ux-walker`, increment 07).
    if let Some(text) = value.as_string() {
        return text;
    }
    value
        .dyn_ref::<js_sys::Error>()
        .map(|e| String::from(e.message()))
        .unwrap_or_else(|| format!("{value:?}"))
}

/// `fetch()` from whatever global this code is running in. `web_sys::window()`
/// is `None` inside a Worker, and since increment 06 every agent runs in one —
/// so reaching for the window here would mean a sub-agent could never call a
/// model at all. Reflected off `globalThis`, which both contexts have.
pub(crate) fn global_fetch(request: &web_sys::Request) -> Result<js_sys::Promise, ModelError> {
    // The ADDRESS rides the typed error: what a person must fix about an
    // unreachable endpoint depends on whether it is on their own machine.
    let url = request.url();
    let transport = |m: String| ModelError::Transport { message: m, url: url.clone() };
    let global = js_sys::global();
    let f: js_sys::Function = js_sys::Reflect::get(&global, &"fetch".into())
        .map_err(|e| transport(format!("no fetch here: {}", js_message(&e))))?
        .dyn_into()
        .map_err(|_| transport("fetch is not callable here".into()))?;
    f.call1(&global, request)
        .map_err(|e| transport(js_message(&e)))?
        .dyn_into()
        .map_err(|_| transport("fetch did not return a promise".into()))
}

/// Non-2xx is the provider's own words — never smoothed into a reply.
pub(crate) async fn read_reply(resp: web_sys::Response) -> Result<ModelReply, ModelError> {
    let url = resp.url();
    let transport = |m: String| ModelError::Transport { message: m, url: url.clone() };
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
        usage: None,
        body_json: text,
    })
}
