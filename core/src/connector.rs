//! Model connectors: how a `model` element reaches a model. Core holds the trait, the registry
//! (on the Hub) and the offline `echo` connector; the server adds the real ones (claude-cli,
//! openai, anthropic). A connector reads its key from the environment variable the model names
//! (`key_env`) at call time; the key never enters state, twins, prompts or logs.

use anyhow::Result;
use serde_json::{Map, Value};
use std::{future::Future, pin::Pin};

/// What a call is for: one loop step, the refocus workflow, or the model's own `test`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Step,
    Refocus,
    Test,
}

/// A model element's config, as a connector reads it.
#[derive(Debug, Clone, Default)]
pub struct ModelSpec {
    pub connector: String,
    pub id: String,
    pub base_url: Option<String>,
    /// The NAME of the environment variable holding the key, never the key.
    pub key_env: Option<String>,
    /// The context budget, in characters.
    pub context: usize,
}

/// The default context budget (characters) when a model names none.
pub const DEFAULT_CONTEXT: usize = 120_000;

impl ModelSpec {
    pub fn from_config(c: &Map<String, Value>) -> Self {
        let s = |k: &str| c.get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(String::from);
        ModelSpec {
            connector: s("connector").unwrap_or_else(|| "echo".into()),
            id: s("id").unwrap_or_default(),
            base_url: s("base_url"),
            key_env: s("key_env"),
            context: c.get("context").and_then(Value::as_f64).filter(|v| *v > 0.0).map(|v| v as usize).unwrap_or(DEFAULT_CONTEXT),
        }
    }
    /// The key, read now from the environment variable the model names.
    pub fn key(&self) -> Option<String> {
        self.key_env.as_ref().and_then(|k| std::env::var(k).ok()).filter(|v| !v.is_empty())
    }
}

/// One model call. `prompt` is exactly what is sent; the other fields let an offline connector
/// (echo) answer without parsing the prompt.
#[derive(Debug, Clone)]
pub struct ModelCall {
    pub purpose: Purpose,
    pub prompt: String,
    /// The run's current input.
    pub input: String,
    /// The tools offered on this step (empty: none).
    pub tools: Vec<String>,
    /// Tool results since the current input.
    pub results: usize,
    /// The loop's messages (refocus reads them).
    pub messages: Vec<Value>,
}

pub type ReplyFuture = Pin<Box<dyn Future<Output = Result<String>> + Send>>;

pub trait Connector: Send + Sync {
    fn call(&self, model: ModelSpec, call: ModelCall) -> ReplyFuture;
}

/// The deterministic offline model: it answers in the loop's reply format from the call alone.
/// - a step with tools and no result yet: calls the tools the input asks for (`wait` → two
///   `clock.wait` at once, `ask: …` → `help.ask`, `read <path>` → `files.read`), else `clock.now`
///   and `note.write` when offered;
/// - otherwise: `answer: echo: <input>` (with the number of results it saw);
/// - refocus: the deterministic essentials of `run::fallback_refocus`.
pub struct Echo;

pub fn echo_reply(call: &ModelCall) -> String {
    match call.purpose {
        Purpose::Test => "answer: pong".into(),
        Purpose::Refocus => crate::run::fallback_refocus(&call.messages),
        Purpose::Step => {
            let has = |t: &str| call.tools.iter().any(|x| x == t);
            let input = call.input.trim();
            if !call.tools.is_empty() && call.results == 0 {
                let mut rows: Vec<String> = vec![];
                if input.contains("wait") && has("clock.wait") {
                    rows.push("clock.wait,{\"ms\":300}".into());
                    rows.push("clock.wait,{\"ms\":300}".into());
                }
                if let Some(q) = input.strip_prefix("ask:")
                    && has("help.ask")
                {
                    rows.push(format!("help.ask,{}", serde_json::json!({ "question": q.trim() })));
                }
                if let Some(p) = input.strip_prefix("read ")
                    && has("files.read")
                {
                    rows.push(format!("files.read,{}", serde_json::json!({ "path": p.trim() })));
                }
                if rows.is_empty() {
                    if has("clock.now") {
                        rows.push("clock.now,{}".into());
                    }
                    if has("note.write") {
                        rows.push(format!("note.write,{}", serde_json::json!({ "text": format!("echo saw: {input}") })));
                    }
                }
                if !rows.is_empty() {
                    let mut out = format!("thought: use the tools for \"{}\"\ncalls[{}]{{tool,args}}:\n", one_line(input), rows.len());
                    for r in rows {
                        out.push_str(&format!("  {r}\n"));
                    }
                    return out;
                }
            }
            let seen = if call.results > 0 { format!(" (after {} tool result(s))", call.results) } else { String::new() };
            format!("thought: answer directly\nanswer: echo: {input}{seen}")
        }
    }
}

fn one_line(s: &str) -> String {
    s.replace(['\n', '"'], " ").chars().take(60).collect()
}

impl Connector for Echo {
    fn call(&self, _model: ModelSpec, call: ModelCall) -> ReplyFuture {
        let reply = echo_reply(&call);
        Box::pin(async move { Ok(reply) })
    }
}
