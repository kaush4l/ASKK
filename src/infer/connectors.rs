//! Server-only runtimes. Two are mechanisms in code: `cli` (start a process) and `echo` (tests).
//! Every HTTP runtime is data in `data/runtimes.json` (see [`Runtime`]): endpoint, auth style,
//! body template and where the reply text sits. Adding an HTTP runtime needs no code.
use super::{Model, Runtime};
use serde_json::Value;

fn key(m: &Model) -> Option<String> {
    (!m.key_env.is_empty()).then(|| std::env::var(&m.key_env).ok()).flatten()
}

/// `data/runtimes.json`; empty when missing.
pub fn runtimes() -> Vec<Runtime> {
    std::fs::read_to_string(crate::api::data_dir().join("runtimes.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Replace `{prompt}` / `{model}` in every string of a template. A string that is exactly a
/// placeholder becomes the value itself (so no quoting problems).
pub fn fill(t: &Value, model: &str, prompt: &str) -> Value {
    match t {
        Value::String(s) if s == "{prompt}" => Value::String(prompt.into()),
        Value::String(s) => Value::String(s.replace("{model}", model).replace("{prompt}", prompt)),
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, model, prompt)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), fill(x, model, prompt))).collect()),
        v => v.clone(),
    }
}

/// The first JSON pointer that yields a string.
pub fn pick(v: &Value, pointers: &[String]) -> Option<String> {
    pointers.iter().find_map(|p| v.pointer(p).and_then(|x| x.as_str()).map(String::from))
}

fn request(rt: &Runtime, m: &Model, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    let mut req = req;
    for (h, v) in &rt.headers {
        req = req.header(h, v);
    }
    match (key(m), rt.auth.as_str()) {
        (Some(k), "bearer") => req.bearer_auth(k),
        (Some(k), header) if !header.is_empty() => req.header(header, k),
        _ => req,
    }
}

fn base(rt: &Runtime, m: &Model) -> String {
    let b = if m.base_url.is_empty() { &rt.base_url } else { &m.base_url };
    b.trim_end_matches('/').to_string()
}

pub async fn http(rt: &Runtime, m: &Model, prompt: &str) -> Result<String, String> {
    let url = format!("{}{}", base(rt, m), rt.path);
    let body = fill(&rt.body, &m.name, prompt);
    let res = request(rt, m, reqwest::Client::new().post(&url).json(&body)).send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| format!("{url}: {e}"))?;
    if !status.is_success() {
        return Err(format!("{status}: {v}"));
    }
    pick(&v, &rt.reply).ok_or_else(|| format!("no reply at {:?}: {v}", rt.reply))
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
        "cli" => cli(m, prompt).await,
        name => match runtimes().into_iter().find(|r| r.name == name) {
            Some(rt) => http(&rt, m, prompt).await,
            None => Err(format!("unknown connector '{name}'")),
        },
    }
}

pub async fn discover(m: &Model) -> Result<Vec<String>, String> {
    let rt = match m.connector.as_str() {
        "echo" => return Ok(vec!["echo".into()]),
        "cli" => return Ok(vec![]),
        name => runtimes().into_iter().find(|r| r.name == name).ok_or_else(|| format!("unknown connector '{name}'"))?,
    };
    if rt.models.is_empty() {
        return Ok(vec![]);
    }
    let url = format!("{}{}", base(&rt, m), rt.models);
    let v: Value = request(&rt, m, reqwest::Client::new().get(&url))
        .send()
        .await
        .map_err(|e| format!("{url}: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(v["data"].as_array().into_iter().flatten().filter_map(|x| x["id"].as_str().map(String::from)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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

    #[test]
    fn templates_fill_and_replies_are_picked() {
        let body = json!({"model": "{model}", "messages": [{"role": "user", "content": "{prompt}"}], "note": "for {model}"});
        let f = fill(&body, "m", "say \"hi\"");
        assert_eq!(f, json!({"model": "m", "messages": [{"role": "user", "content": "say \"hi\""}], "note": "for m"}));
        let v = json!({"output": [{"content": [{"text": "deep"}]}]});
        assert_eq!(pick(&v, &["/output_text".into(), "/output/0/content/0/text".into()]).unwrap(), "deep");
        assert!(pick(&v, &["/nope".into()]).is_none());
    }

    /// A configured HTTP runtime against a local stub server: body sent as templated, auth
    /// header set from `key_env`, reply read at the pointer.
    #[tokio::test]
    async fn an_http_runtime_is_pure_config() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = s.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let body = r#"{"choices":[{"message":{"content":"pong"}}]}"#;
            let resp = format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
            req
        });
        std::env::set_var("ASKK_TEST_KEY", "sekret");
        let rt = Runtime {
            name: "chat".into(),
            base_url: format!("http://{addr}/v1"),
            path: "/chat/completions".into(),
            auth: "bearer".into(),
            body: json!({"model": "{model}", "messages": [{"role": "user", "content": "{prompt}"}]}),
            reply: vec!["/choices/0/message/content".into()],
            ..Default::default()
        };
        let m = Model { name: "local-model".into(), connector: "chat".into(), key_env: "ASKK_TEST_KEY".into(), ..Default::default() };
        assert_eq!(http(&rt, &m, "ping").await.unwrap(), "pong");
        let req = server.await.unwrap();
        assert!(req.starts_with("POST /v1/chat/completions"), "{req}");
        assert!(req.to_lowercase().contains("authorization: bearer sekret"));
        assert!(req.contains(r#""model":"local-model""#) && req.contains(r#""content":"ping""#), "{req}");
    }
}
