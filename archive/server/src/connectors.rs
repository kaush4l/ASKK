//! The real model connectors, added to the Hub at start. Each reads its key (when it needs one)
//! from the environment variable the model element names in `key_env`, at call time, and never
//! puts it in an error, a log or a reply.

use anyhow::{Context, Result, anyhow, bail};
use askk_core::connector::{Connector, ModelCall, ModelSpec, NamesFuture, ReplyFuture};
use askk_core::Hub;
use serde_json::{Value, json};
use std::{process::Stdio, sync::Arc, time::Duration};
use tokio::io::AsyncWriteExt;

/// How long one model call may take.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(600);
/// How long listing a server's models may take.
pub const DISCOVER_TIMEOUT: Duration = Duration::from_secs(10);
pub const OPENAI_BASE: &str = "https://api.openai.com/v1";
/// The names the claude CLI's `--model` accepts (`default`: no flag, the CLI's own).
pub const CLAUDE_CLI_MODELS: [&str; 7] = ["default", "sonnet", "opus", "haiku", "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

pub fn register(hub: &Hub) {
    let http = reqwest::Client::builder().timeout(CALL_TIMEOUT).build().expect("http client");
    hub.add_connector("claude-cli", Arc::new(ClaudeCli));
    hub.add_connector("openai", Arc::new(OpenAi(http.clone())));
    hub.add_connector("openai-responses", Arc::new(OpenAiResponses(http.clone())));
    hub.add_connector("anthropic", Arc::new(Anthropic(http)));
}

/// Turn a failed list request into a clear error (never with the key, nor the URL's query).
fn list_error(status: reqwest::StatusCode, spec: &ModelSpec, body: &Value) -> anyhow::Error {
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return match &spec.key_env {
            Some(k) => anyhow!("{status}: the server refused the key; check key_env {k}"),
            None => anyhow!("{status}: the server needs a key; name its environment variable in key_env"),
        };
    }
    let msg = body["error"]["message"].as_str().or_else(|| body["error"].as_str()).unwrap_or("");
    anyhow!("{status}: {}", msg.chars().take(300).collect::<String>())
}

/// `data[].id` of a `/models` listing.
pub fn parse_model_list(body: &Value) -> Result<Vec<String>> {
    let a = body["data"].as_array().ok_or_else(|| anyhow!("the reply has no data[] list of models"))?;
    Ok(a.iter().filter_map(|m| m["id"].as_str()).map(String::from).collect())
}

/// GET <url> with the given headers; `data[].id`.
async fn list_models(http: &reqwest::Client, url: String, spec: &ModelSpec, req: impl FnOnce(reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder>) -> Result<Vec<String>> {
    let res = req(http.get(&url).timeout(DISCOVER_TIMEOUT))?.send().await.map_err(|e| {
        if e.is_timeout() { anyhow!("no answer from {url} within 10 s") } else { anyhow!("cannot reach {url}: {}", e.without_url()) }
    })?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(list_error(status, spec, &body));
    }
    parse_model_list(&body)
}

/// OpenAI-style discovery: GET <base_url>/models, a Bearer key when key_env is named.
fn openai_discover(http: reqwest::Client, spec: ModelSpec) -> NamesFuture {
    Box::pin(async move {
        let base = spec.base_url.clone().unwrap_or_else(|| OPENAI_BASE.into());
        let url = format!("{}/models", base.trim_end_matches('/'));
        list_models(&http, url, &spec, |r| Ok(if spec.key_env.is_some() { r.bearer_auth(key(&spec)?) } else { r })).await
    })
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
    fn discover(&self, _spec: ModelSpec) -> NamesFuture {
        Box::pin(async { Ok(CLAUDE_CLI_MODELS.iter().map(|s| s.to_string()).collect()) })
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
    fn discover(&self, spec: ModelSpec) -> NamesFuture {
        openai_discover(self.0.clone(), spec)
    }
}

/// OpenAI's Responses API: POST <base_url>/responses with {model, input}.
pub struct OpenAiResponses(reqwest::Client);

/// The text of a Responses reply: `output_text` when present, else every `output[].content[]`
/// part of type `output_text`, joined.
pub fn responses_text(body: &Value) -> Result<String> {
    if let Some(t) = body["output_text"].as_str().filter(|t| !t.is_empty()) {
        return Ok(t.to_string());
    }
    let mut text = String::new();
    for item in body["output"].as_array().into_iter().flatten() {
        for part in item["content"].as_array().into_iter().flatten() {
            if part["type"] == "output_text"
                && let Some(t) = part["text"].as_str()
            {
                text.push_str(t);
            }
        }
    }
    if text.is_empty() {
        bail!("no output_text in the reply");
    }
    Ok(text)
}

impl Connector for OpenAiResponses {
    fn call(&self, spec: ModelSpec, call: ModelCall) -> ReplyFuture {
        let http = self.0.clone();
        Box::pin(async move {
            let base = spec.base_url.clone().unwrap_or_else(|| OPENAI_BASE.into());
            let mut req = http.post(format!("{}/responses", base.trim_end_matches('/'))).json(&json!({ "model": spec.id, "input": call.prompt }));
            if spec.key_env.is_some() {
                req = req.bearer_auth(key(&spec)?);
            }
            let res = req.send().await.map_err(|e| anyhow!("request failed: {}", e.without_url()))?;
            let status = res.status();
            let body: Value = res.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                bail!("{status}: {}", body["error"]["message"].as_str().unwrap_or(""));
            }
            responses_text(&body)
        })
    }
    fn discover(&self, spec: ModelSpec) -> NamesFuture {
        openai_discover(self.0.clone(), spec)
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
    fn discover(&self, spec: ModelSpec) -> NamesFuture {
        let http = self.0.clone();
        Box::pin(async move {
            let base = spec.base_url.clone().unwrap_or_else(|| "https://api.anthropic.com".into());
            let url = format!("{}/v1/models", base.trim_end_matches('/'));
            list_models(&http, url, &spec, |r| Ok(r.header("x-api-key", key(&spec)?).header("anthropic-version", "2023-06-01"))).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_reply_text() {
        let body: Value = serde_json::from_str(r#"{
          "id": "resp_1", "object": "response", "status": "completed", "model": "gpt-5.1",
          "output": [
            {"type": "reasoning", "id": "rs_1", "summary": []},
            {"type": "message", "id": "msg_1", "role": "assistant", "content": [
              {"type": "output_text", "text": "answer: ", "annotations": []},
              {"type": "refusal", "refusal": "no"},
              {"type": "output_text", "text": "pong", "annotations": []}
            ]}
          ]
        }"#).unwrap();
        assert_eq!(responses_text(&body).unwrap(), "answer: pong");
        assert_eq!(responses_text(&json!({ "output_text": "hi", "output": [] })).unwrap(), "hi");
        assert!(responses_text(&json!({ "output": [] })).is_err());
    }

    #[test]
    fn model_list_ids() {
        let body = json!({ "object": "list", "data": [{ "id": "qwen3-30b", "object": "model" }, { "id": "llama-4" }] });
        assert_eq!(parse_model_list(&body).unwrap(), vec!["qwen3-30b", "llama-4"]);
        assert!(parse_model_list(&json!({ "models": [] })).is_err());
    }

    #[test]
    fn list_error_names_key_env_not_key() {
        let spec = ModelSpec { connector: "openai".into(), key_env: Some("MY_KEY".into()), ..Default::default() };
        let e = list_error(reqwest::StatusCode::UNAUTHORIZED, &spec, &Value::Null).to_string();
        assert!(e.contains("check key_env MY_KEY"), "{e}");
    }
}
