//! Server-only transports. Dispatch on `model.connector`, so a new model needs no code.
use super::Model;
use serde_json::{json, Value};

fn key(m: &Model) -> Option<String> {
    (!m.key_env.is_empty()).then(|| std::env::var(&m.key_env).ok()).flatten()
}

fn base(m: &Model, fallback: &str) -> String {
    let b = if m.base_url.is_empty() { fallback } else { &m.base_url };
    b.trim_end_matches('/').to_string()
}

async fn post(url: String, m: &Model, body: Value, anthropic: bool) -> Result<Value, String> {
    let mut req = reqwest::Client::new().post(&url).json(&body);
    if let Some(k) = key(m) {
        req = if anthropic { req.header("x-api-key", k).header("anthropic-version", "2023-06-01") } else { req.bearer_auth(k) };
    }
    let res = req.send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {v}"));
    }
    Ok(v)
}

/// Any command-line model: fill `{prompt}` / `{model}` in `command`; no `{prompt}` = stdin.
async fn cli(m: &Model, prompt: &str) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    let (prog, args) = m.command.split_first().ok_or("cli model needs a command")?;
    let fill = |a: &String| a.replace("{prompt}", prompt).replace("{model}", &m.name);
    let stdin = !m.command.iter().any(|a| a.contains("{prompt}"));
    let mut child = tokio::process::Command::new(prog)
        .args(args.iter().map(fill))
        .stdin(if stdin { std::process::Stdio::piped() } else { std::process::Stdio::null() })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("{prog}: {e}"))?;
    if stdin {
        let mut i = child.stdin.take().unwrap();
        i.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("{prog}: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub async fn complete(m: &Model, prompt: &str) -> Result<String, String> {
    match m.connector.as_str() {
        "echo" => Ok(prompt.to_string()),
        "openai" => {
            let v = post(format!("{}/chat/completions", base(m, "https://api.openai.com/v1")), m,
                json!({"model": m.name, "messages": [{"role": "user", "content": prompt}]}), false).await?;
            v["choices"][0]["message"]["content"].as_str().map(String::from).ok_or_else(|| format!("no content: {v}"))
        }
        "openai-responses" => {
            let v = post(format!("{}/responses", base(m, "https://api.openai.com/v1")), m,
                json!({"model": m.name, "input": prompt}), false).await?;
            if let Some(t) = v["output_text"].as_str() {
                return Ok(t.to_string());
            }
            let text: String = v["output"].as_array().into_iter().flatten()
                .flat_map(|o| o["content"].as_array().cloned().unwrap_or_default())
                .filter_map(|c| c["text"].as_str().map(String::from)).collect();
            if text.is_empty() { Err(format!("no output: {v}")) } else { Ok(text) }
        }
        "anthropic" => {
            let v = post(format!("{}/v1/messages", base(m, "https://api.anthropic.com")), m,
                json!({"model": m.name, "max_tokens": 4096, "messages": [{"role": "user", "content": prompt}]}), true).await?;
            v["content"][0]["text"].as_str().map(String::from).ok_or_else(|| format!("no content: {v}"))
        }
        "cli" => cli(m, prompt).await,
        other => Err(format!("unknown connector '{other}'")),
    }
}

pub async fn discover(m: &Model) -> Result<Vec<String>, String> {
    let (url, anthropic) = match m.connector.as_str() {
        "echo" => return Ok(vec!["echo".into()]),
        "cli" => return Ok(vec![]),
        "anthropic" => (format!("{}/v1/models", base(m, "https://api.anthropic.com")), true),
        _ => (format!("{}/models", base(m, "https://api.openai.com/v1")), false),
    };
    let mut req = reqwest::Client::new().get(&url);
    if let Some(k) = key(m) {
        req = if anthropic { req.header("x-api-key", k).header("anthropic-version", "2023-06-01") } else { req.bearer_auth(k) };
    }
    let v: Value = req.send().await.map_err(|e| format!("{url}: {e}"))?.json().await.map_err(|e| e.to_string())?;
    Ok(v["data"].as_array().into_iter().flatten().filter_map(|x| x["id"].as_str().map(String::from)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn echo_returns_prompt() {
        let m = Model { name: "e".into(), connector: "echo".into(), ..Default::default() };
        assert_eq!(complete(&m, "hi").await.unwrap(), "hi");
    }
    #[tokio::test]
    async fn any_cli_is_a_runtime() {
        let m = |c: &[&str]| Model { name: "m1".into(), connector: "cli".into(), command: c.iter().map(|s| s.to_string()).collect(), ..Default::default() };
        assert_eq!(complete(&m(&["echo", "{model}:{prompt}"]), "hi").await.unwrap(), "m1:hi");
        assert_eq!(complete(&m(&["cat"]), "via stdin").await.unwrap(), "via stdin");
        assert!(complete(&m(&["false"]), "x").await.is_err());
        assert!(complete(&m(&[]), "x").await.is_err());
    }

    #[tokio::test]
    async fn unknown_connector_fails() {
        let m = Model { name: "x".into(), connector: "nope".into(), ..Default::default() };
        assert!(complete(&m, "hi").await.is_err());
    }
}
