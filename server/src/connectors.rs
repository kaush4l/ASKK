//! The real model connectors, added to the Hub at start. Each reads its key (when it needs one)
//! from the environment variable the model element names in `key_env`, at call time, and never
//! puts it in an error, a log or a reply.

use anyhow::{Context, Result, anyhow, bail};
use askk_core::connector::{Connector, ModelCall, ModelSpec, ReplyFuture};
use askk_core::Hub;
use serde_json::{Value, json};
use std::{process::Stdio, sync::Arc, time::Duration};
use tokio::io::AsyncWriteExt;

/// How long one model call may take.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(600);

pub fn register(hub: &Hub) {
    let http = reqwest::Client::builder().timeout(CALL_TIMEOUT).build().expect("http client");
    hub.add_connector("claude-cli", Arc::new(ClaudeCli));
    hub.add_connector("openai", Arc::new(OpenAi(http.clone())));
    hub.add_connector("anthropic", Arc::new(Anthropic(http)));
}

fn key(spec: &ModelSpec) -> Result<String> {
    match &spec.key_env {
        None => bail!("this connector needs key_env: the name of the environment variable holding the key"),
        Some(name) => spec.key().ok_or_else(|| anyhow!("environment variable {name} is not set")),
    }
}

/// The Claude CLI: `claude -p`, prompt on stdin, in an empty temp folder, with a scrubbed
/// environment (HOME, PATH, USER, LANG, TMPDIR only); in print mode it asks no permission, so it runs no tool that needs one.
pub struct ClaudeCli;

impl Connector for ClaudeCli {
    fn call(&self, spec: ModelSpec, call: ModelCall) -> ReplyFuture {
        Box::pin(async move {
            let dir = std::env::temp_dir().join(format!("askk-claude-{}-{}", std::process::id(), askk_core::now()));
            std::fs::create_dir_all(&dir)?;
            let mut cmd = tokio::process::Command::new("claude");
            cmd.arg("-p").arg("--output-format").arg("text");
            if !spec.id.is_empty() {
                cmd.arg("--model").arg(&spec.id);
            }
            cmd.env_clear();
            for k in ["HOME", "PATH", "USER", "LANG", "TMPDIR"] {
                if let Ok(v) = std::env::var(k) {
                    cmd.env(k, v);
                }
            }
            cmd.current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
            let mut child = cmd.spawn().context("claude CLI not found on PATH")?;
            let mut stdin = child.stdin.take().expect("piped");
            stdin.write_all(call.prompt.as_bytes()).await?;
            drop(stdin);
            let out = tokio::time::timeout(CALL_TIMEOUT, child.wait_with_output()).await.map_err(|_| anyhow!("claude CLI timed out"))??;
            let _ = std::fs::remove_dir_all(&dir);
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                bail!("claude CLI exited {}: {}", out.status, err.lines().last().unwrap_or("").chars().take(300).collect::<String>());
            }
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        })
    }
}

/// An OpenAI-compatible server: POST <base_url>/chat/completions.
pub struct OpenAi(reqwest::Client);

impl Connector for OpenAi {
    fn call(&self, spec: ModelSpec, call: ModelCall) -> ReplyFuture {
        let http = self.0.clone();
        Box::pin(async move {
            let base = spec.base_url.clone().unwrap_or_else(|| "https://api.openai.com/v1".into());
            let mut req = http.post(format!("{}/chat/completions", base.trim_end_matches('/'))).json(&json!({
                "model": spec.id,
                "messages": [{ "role": "user", "content": call.prompt }],
            }));
            // a local server may need no key: only send one when key_env is named
            if spec.key_env.is_some() {
                req = req.bearer_auth(key(&spec)?);
            }
            let res = req.send().await.map_err(|e| anyhow!("request failed: {}", e.without_url()))?;
            let status = res.status();
            let body: Value = res.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                bail!("{status}: {}", body["error"]["message"].as_str().unwrap_or(""));
            }
            body["choices"][0]["message"]["content"].as_str().map(String::from).ok_or_else(|| anyhow!("no content in the reply"))
        })
    }
}

/// Anthropic's Messages API: POST <base_url>/v1/messages.
pub struct Anthropic(reqwest::Client);

impl Connector for Anthropic {
    fn call(&self, spec: ModelSpec, call: ModelCall) -> ReplyFuture {
        let http = self.0.clone();
        Box::pin(async move {
            let base = spec.base_url.clone().unwrap_or_else(|| "https://api.anthropic.com".into());
            let res = http
                .post(format!("{}/v1/messages", base.trim_end_matches('/')))
                .header("x-api-key", key(&spec)?)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": spec.id,
                    "max_tokens": 4096,
                    "messages": [{ "role": "user", "content": call.prompt }],
                }))
                .send()
                .await
                .map_err(|e| anyhow!("request failed: {}", e.without_url()))?;
            let status = res.status();
            let body: Value = res.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                bail!("{status}: {}", body["error"]["message"].as_str().unwrap_or(""));
            }
            let text: String = body["content"].as_array().map(|a| a.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("")).unwrap_or_default();
            if text.is_empty() {
                bail!("no text in the reply");
            }
            Ok(text)
        })
    }
}
