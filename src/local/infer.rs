//! Inference from inside the tab.
//!
//! The engine's futures are `Send` ([`crate::core::Fut`]); a browser `fetch` is not. So the
//! request runs on the tab's own loop and only its result crosses, over a channel
//! ([`super::on_tab`]). No trait in the core changes.
//!
//! Where to ask is set on the page ([`set`]) and held in memory only: a token typed here is
//! never written to the store. With no address set, [`Tab`] answers itself (`echo`), so the
//! engine loop can be seen working without any model.
use super::on_tab;
use crate::core::{Fut, Sampling};
use serde_json::{json, Value};

/// Where the tab asks: core's [`Reach`](crate::core::models::Reach), set in the window's
/// settings and held in memory only.
pub use crate::core::models::Reach as Target;

pub fn set(t: Target) {
    crate::core::models::set_reach(t);
}

/// Ask an askk server (`base` ends in `/ask`): it resolves the model by name with its own
/// connectors and keys, so nothing secret is typed into the tab.
async fn ask_service(t: Target, engine_model: String, prompt: String) -> Result<String, String> {
    let body = json!({"model": if t.model.is_empty() { engine_model } else { t.model.clone() }, "prompt": prompt});
    let res = reqwest::Client::new().post(format!("{}/infer", t.base.trim_end_matches('/'))).json(&body).send().await.map_err(|e| {
        format!("the askk server at {} did not answer ({e}). It must be running, and must be told to let this page ask (see `origins` in core/places.rs)", t.base)
    })?;
    let v: Value = res.json().await.map_err(|e| format!("the askk server's reply could not be read: {e}"))?;
    match (v["ok"].as_str(), v["error"].as_str()) {
        (Some(text), _) => Ok(text.to_string()),
        (_, Some(e)) => Err(e.to_string()),
        _ => Err(format!("the askk server's reply has no text: {v}")),
    }
}

async fn ask(t: Target, engine_model: String, prompt: String, s: Sampling) -> Result<String, String> {
    if t.base.trim_end_matches('/').ends_with("/ask") {
        return ask_service(t, engine_model, prompt).await;
    }
    let mut body = json!({
        "model": if t.model.is_empty() { engine_model } else { t.model.clone() },
        "messages": [{"role": "user", "content": prompt}],
    });
    if let Some(v) = s.temperature {
        body["temperature"] = json!(v);
    }
    if let Some(v) = s.top_p {
        body["top_p"] = json!(v);
    }
    let mut req = reqwest::Client::new().post(format!("{}/chat/completions", t.base.trim_end_matches('/'))).json(&body);
    if !t.token.is_empty() {
        req = req.bearer_auth(&t.token);
    }
    let res = req.send().await.map_err(|e| format!("fetch: {e}"))?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| format!("reply ({status}): {e}"))?;
    v.pointer("/choices/0/message/content").and_then(Value::as_str).map(str::to_string).ok_or_else(|| format!("reply ({status}) has no text: {v}"))
}

pub struct Tab;

impl crate::core::Infer for Tab {
    fn complete(&self, model: &str, prompt: String, sampling: Sampling) -> Fut<Result<String, String>> {
        let t = crate::core::models::reach();
        if t.base.is_empty() {
            let words = prompt.split_whitespace().count();
            return Box::pin(async move { Ok(format!("echo: the engine ran in this tab and sent a prompt of {} characters ({words} words).", prompt.len())) });
        }
        on_tab(ask(t, model.to_string(), prompt, sampling))
    }
}
