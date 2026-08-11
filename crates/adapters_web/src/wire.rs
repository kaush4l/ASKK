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
    value
        .dyn_ref::<js_sys::Error>()
        .map(|e| String::from(e.message()))
        .unwrap_or_else(|| format!("{value:?}"))
}

/// Non-2xx is the provider's own words — never smoothed into a reply.
pub(crate) async fn read_reply(resp: web_sys::Response) -> Result<ModelReply, ModelError> {
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
