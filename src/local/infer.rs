//! Inference from inside the tab.
//!
//! The engine's futures are `Send` ([`crate::core::Fut`]); a browser `fetch` is not. So the
//! request runs on the tab's own loop and only its result crosses, over a channel
//! ([`super::on_tab`]). No trait in the core changes.
//!
//! Where to ask is set on the page ([`set`]) and held in memory only: a token typed here is
//! never written to the store. With no address set, [`Tab`] answers itself (`echo`), so the
//! engine loop can be seen working without any model.
use crate::core::held::Held;
use super::on_tab;
use crate::core::{Fut, Sampling};
use serde_json::{json, Value};
use std::sync::Mutex;

/// An OpenAI-style server (`base` ends before `/chat/completions`). Empty `base` = echo.
#[derive(Clone, Default, PartialEq)]
pub struct Target {
    pub base: String,
    pub model: String,
    pub token: String,
}

static TARGET: Mutex<Target> = Mutex::new(Target { base: String::new(), model: String::new(), token: String::new() });

pub fn set(t: Target) {
    *TARGET.held() = t;
}

async fn ask(t: Target, engine_model: String, prompt: String, s: Sampling) -> Result<String, String> {
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
        let t = TARGET.held().clone();
        if t.base.is_empty() {
            let words = prompt.split_whitespace().count();
            return Box::pin(async move { Ok(format!("echo: the engine ran in this tab and sent a prompt of {} characters ({words} words).", prompt.len())) });
        }
        on_tab(ask(t, model.to_string(), prompt, sampling))
    }
}
