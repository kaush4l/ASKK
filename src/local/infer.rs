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

/// What the built-in echo answers.
fn echo(prompt: &str) -> String {
    let words = prompt.split_whitespace().count();
    format!("echo: the engine ran in this tab and sent a prompt of {} characters ({words} words).", prompt.len())
}

#[wasm_bindgen::prelude::wasm_bindgen(inline_js = "export function later(ms, f) { setTimeout(f, ms); }")]
extern "C" {
    fn later(ms: u32, f: &wasm_bindgen::closure::Closure<dyn FnMut()>);
}

/// Wait `ms` on the tab's own loop.
async fn pause(ms: u32) {
    let (tx, rx) = futures::channel::oneshot::channel::<()>();
    let mut tx = Some(tx);
    let f = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || {
        if let Some(tx) = tx.take() {
            let _ = tx.send(());
        }
    });
    later(ms, &f);
    let _ = rx.await;
    drop(f);
}

impl crate::core::Infer for Tab {
    fn complete(&self, model: &str, prompt: String, sampling: Sampling) -> Fut<Result<String, String>> {
        let t = crate::core::models::reach();
        if t.base.is_empty() {
            return Box::pin(async move { Ok(echo(&prompt)) });
        }
        on_tab(ask(t, model.to_string(), prompt, sampling))
    }
    /// The echo writes its answer word by word, so the tab shows an answer arriving as a
    /// machine does. A model server is asked whole (its stream is not read here yet), and its
    /// answer is said in one piece.
    fn stream(&self, model: &str, prompt: String, sampling: Sampling, _media: Vec<crate::core::media::Attachment>, said: crate::core::Said) -> Fut<Result<String, String>> {
        let t = crate::core::models::reach();
        if t.base.is_empty() {
            return on_tab(async move {
                let whole = echo(&prompt);
                for piece in whole.split_inclusive(' ') {
                    said(piece);
                    pause(40).await;
                }
                Ok(whole)
            });
        }
        let model = model.to_string();
        on_tab(async move {
            let whole = ask(t, model, prompt, sampling).await?;
            said(&whole);
            Ok(whole)
        })
    }
}
