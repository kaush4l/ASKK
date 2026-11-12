//! Server-only methods: `openai` (the chat-completions API every server speaks; only the base
//! url changes) and `cli` (start a process).
use crate::core::held::Held;
use crate::core::media::Attachment;
use crate::core::models::{Found, Model, INPUTS, OPENAI_URL};
use crate::core::{Said, Sampling};
use serde_json::{json, Value};

/// Context-window fields servers put in a models listing entry.
const CONTEXT_FIELDS: &[&str] = &["/context_length", "/context_window", "/max_model_len", "/max_input_tokens"];

fn token(m: &Model) -> Option<String> {
    crate::core::places::secret(&m.token_env)
}

fn base(m: &Model) -> String {
    let b = if m.base_url.is_empty() { OPENAI_URL } else { &m.base_url };
    b.trim_end_matches('/').to_string()
}

fn auth(m: &Model, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match token(m) {
        Some(t) => req.bearer_auth(t),
        None => req,
    }
}

/// An image as a model is handed it: what it is, its type, its bytes in base64.
#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    pub label: String,
    pub mime: String,
    pub data: String,
}

/// The largest image file sent to a model.
const MAX_IMAGE: u64 = 8 * 1024 * 1024;

/// Read the attachments a model can be shown (images); one that cannot be read is left out.
pub async fn images(media: &[Attachment]) -> Vec<Image> {
    let mut out = vec![];
    for a in media.iter().filter(|a| a.kind == "image") {
        match crate::host::media::bytes(&a.path) {
            Ok(bytes) if bytes.len() as u64 <= MAX_IMAGE => {
                let label = format!("{}{}:", crate::core::media::token(&a.id), if a.label.is_empty() { String::new() } else { format!(" {}", a.label) });
                out.push(Image { label, mime: a.mime.clone(), data: crate::core::media::b64(&bytes) });
            }
            Ok(_) => eprintln!("askk: image {} is too large to show a model", a.path),
            Err(e) => eprintln!("askk: image {}: {e}", a.path),
        }
    }
    out
}

/// The request body: model, one user message, the reply cap, and only the sampling knobs set.
pub fn body(m: &Model, prompt: &str, s: &Sampling) -> Value {
    body_with(m, prompt, s, &[])
}

/// The same with images: each named by its label, then the prompt.
pub fn body_with(m: &Model, prompt: &str, s: &Sampling, images: &[Image]) -> Value {
    let content = if images.is_empty() {
        json!(prompt)
    } else {
        let mut parts: Vec<Value> = images.iter().flat_map(|i| [json!({"type": "text", "text": i.label}), json!({"type": "image_url", "image_url": {"url": format!("data:{};base64,{}", i.mime, i.data)}})]).collect();
        parts.push(json!({"type": "text", "text": prompt}));
        json!(parts)
    };
    let mut b = json!({"model": m.name, "messages": [{"role": "user", "content": content}], "max_tokens": m.max_tokens});
    if let Some(t) = s.temperature { b["temperature"] = json!(t); }
    if let Some(p) = s.top_p { b["top_p"] = json!(p); }
    b
}

/// One user message in Claude Code's stream form: each image named by its label, then the prompt.
pub fn stream_message(prompt: &str, images: &[Image]) -> Value {
    let mut parts: Vec<Value> = images.iter().flat_map(|i| [json!({"type": "text", "text": i.label}), json!({"type": "image", "source": {"type": "base64", "media_type": i.mime, "data": i.data}})]).collect();
    parts.push(json!({"type": "text", "text": prompt}));
    json!({"type": "user", "message": {"role": "user", "content": parts}})
}

/// The reply in a stream of JSON lines: the `result` line's text (an error when it says so).
pub fn stream_result(printed: &str) -> Result<String, String> {
    let last = printed.lines().filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok()).filter(|v| v["type"] == "result").last();
    match last {
        Some(v) if v["is_error"] == true => Err(v["result"].as_str().unwrap_or("the model reported an error").to_string()),
        Some(v) => v["result"].as_str().map(|s| s.trim().to_string()).ok_or_else(|| format!("the result has no text: {v}")),
        None => Err(format!("no result in the stream: {}", printed.trim().chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect::<String>())),
    }
}

async fn openai(m: &Model, prompt: &str, s: &Sampling, images: &[Image], said: Option<&Said>) -> Result<String, String> {
    let url = format!("{}/chat/completions", base(m));
    let mut body = body_with(m, prompt, s, images);
    if said.is_some() {
        body["stream"] = json!(true);
    }
    let mut res = auth(m, reqwest::Client::new().post(&url).json(&body)).send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status();
    let events = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("text/event-stream"));
    let Some(said) = said.filter(|_| events && status.is_success()) else {
        if said.is_some() && !status.is_success() {
            // A server that will not stream is asked again the plain way.
            return Box::pin(openai(m, prompt, s, images, None)).await;
        }
        let v: Value = res.json().await.map_err(|e| format!("{url}: {e}"))?;
        if !status.is_success() {
            return Err(format!("{status}: {v}"));
        }
        let text = v.pointer("/choices/0/message/content").and_then(|x| x.as_str()).map(String::from).ok_or_else(|| format!("no reply: {v}"))?;
        if let Some(said) = said {
            said(&text);
        }
        return Ok(text);
    };
    // Server-sent events: `data: {json}` lines, each with the next piece, then `data: [DONE]`.
    let mut events = Events::default();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("{url}: {e}"))? {
        for piece in events.feed(&chunk) {
            said(&piece);
        }
        if events.done {
            break;
        }
    }
    if events.text.is_empty() && !events.error.is_empty() {
        return Err(events.error);
    }
    Ok(events.text)
}

/// A stream of server-sent events as it arrives, read into the pieces of a reply.
#[derive(Default)]
pub struct Events {
    pending: Vec<u8>,
    pub text: String,
    pub error: String,
    pub done: bool,
}

impl Events {
    /// Take the next bytes; gives the pieces of text in the lines they finished.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(bytes);
        let mut out = vec![];
        while let Some(at) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=at).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else { continue };
            if data == "[DONE]" {
                self.done = true;
                break;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(e) = v.get("error") {
                self.error = e["message"].as_str().map(String::from).unwrap_or_else(|| e.to_string());
            }
            if let Some(piece) = v.pointer("/choices/0/delta/content").and_then(Value::as_str).filter(|p| !p.is_empty()) {
                self.text.push_str(piece);
                out.push(piece.to_string());
            }
        }
        out
    }
}

/// A line of a Claude Code stream, read for the text it adds to the reply.
fn printed_piece(line: &str, partial: &mut bool) -> Option<String> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    match v["type"].as_str()? {
        // With partial messages on, each delta is the next piece.
        "stream_event" => {
            let d = &v["event"]["delta"];
            let t = d["text"].as_str().filter(|_| d["type"] == "text_delta").map(String::from);
            if t.is_some() {
                *partial = true;
            }
            t
        }
        // Without them, each whole message is a piece.
        "assistant" if !*partial => {
            let parts = v["message"]["content"].as_array()?;
            let t: String = parts.iter().filter(|p| p["type"] == "text").filter_map(|p| p["text"].as_str()).collect();
            (!t.is_empty()).then_some(t)
        }
        _ => None,
    }
}

/// Any command-line model: fill `{prompt}` / `{model}` in `command`; no `{prompt}` = stdin.
/// With `input: stream-json` the prompt and the images go to stdin as one message, and the
/// reply is the result line of the stream the command prints. What it prints is handed to
/// `said` as it comes (a text model's output itself; a stream's text messages).
async fn cli(m: &Model, prompt: &str, images: &[Image], said: Option<&Said>) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (prog, args) = m.command.split_first().ok_or("cli model needs a command")?;
    if !INPUTS.contains(&m.input.as_str()) {
        return Err(format!("input '{}' is not one of: text (empty), stream-json", m.input));
    }
    let stream = m.input == "stream-json";
    let line = if stream { stream_message(prompt, images).to_string() + "\n" } else { String::new() };
    let fill = |a: &String| a.replace("{prompt}", prompt).replace("{model}", &m.name).replace("{max_tokens}", &m.max_tokens.to_string());
    let stdin = stream || !m.command.iter().any(|a| a.contains("{prompt}"));
    let mut child = tokio::process::Command::new(prog)
        .args(args.iter().map(fill))
        .stdin(if stdin { std::process::Stdio::piped() } else { std::process::Stdio::null() })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("{prog}: {e}"))?;
    if stdin {
        let mut i = child.stdin.take().unwrap();
        i.write_all(if stream { line.as_bytes() } else { prompt.as_bytes() }).await.map_err(|e| e.to_string())?;
    }
    // Standard error is read beside, so a command that writes much there never stalls.
    let mut err_pipe = child.stderr.take().ok_or("no stderr")?;
    let errors = tokio::spawn(async move {
        let mut e = vec![];
        let _ = err_pipe.read_to_end(&mut e).await;
        String::from_utf8_lossy(&e).trim().to_string()
    });
    let mut out_pipe = child.stdout.take().ok_or("no stdout")?;
    let (mut printed, mut buf, mut cut) = (Vec::<u8>::new(), [0u8; 4096], 0usize);
    let mut partial = false;
    loop {
        let n = out_pipe.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        printed.extend_from_slice(&buf[..n]);
        let Some(said) = said else { continue };
        if stream {
            // Whole lines only.
            while let Some(at) = printed[cut..].iter().position(|b| *b == b'\n') {
                let l = String::from_utf8_lossy(&printed[cut..cut + at]).to_string();
                cut += at + 1;
                if let Some(p) = printed_piece(&l, &mut partial) {
                    said(&p);
                }
            }
        } else {
            // Whole characters only: a piece never ends inside one.
            let upto = match std::str::from_utf8(&printed[cut..]) {
                Ok(_) => printed.len(),
                Err(e) => cut + e.valid_up_to(),
            };
            if upto > cut {
                said(&String::from_utf8_lossy(&printed[cut..upto]));
                cut = upto;
            }
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr = errors.await.unwrap_or_default();
    let printed = String::from_utf8_lossy(&printed);
    if stream {
        // The stream says what went wrong better than the exit code does.
        return stream_result(&printed).map_err(|e| if status.success() { e } else { format!("{prog}: {e} {stderr}") });
    }
    if !status.success() {
        return Err(format!("{prog}: {stderr}"));
    }
    Ok(printed.trim().to_string())
}

pub async fn complete(m: &Model, prompt: &str, s: &Sampling) -> Result<String, String> {
    complete_with(m, prompt, s, &[]).await
}

/// Ask a model, showing it `media` when its method can (openai: always; cli: with
/// `input: stream-json`). A model that cannot be shown answers from the prompt alone.
pub async fn complete_with(m: &Model, prompt: &str, s: &Sampling, media: &[Attachment]) -> Result<String, String> {
    stream(m, prompt, s, media, None).await
}

/// The same, handing each piece of the reply to `said` as it arrives (`openai`: the server's
/// event stream; `cli`: what the command prints, as it prints it).
pub async fn stream(m: &Model, prompt: &str, s: &Sampling, media: &[Attachment], said: Option<&Said>) -> Result<String, String> {
    let shows = m.method == "openai" || m.input == "stream-json";
    let images = if shows { images(media).await } else { vec![] };
    match m.method.as_str() {
        "openai" => openai(m, prompt, s, &images, said).await,
        "cli" => cli(m, prompt, &images, said).await,
        other => Err(format!("unknown method '{other}' (openai or cli)")),
    }
}

pub async fn discover(m: &Model) -> Result<Vec<Found>, String> {
    if m.method != "openai" {
        return Ok(vec![]);
    }
    let url = format!("{}/models", base(m));
    let v: Value = auth(m, reqwest::Client::new().get(&url)).send().await.map_err(|e| format!("{url}: {e}"))?.json().await.map_err(|e| e.to_string())?;
    Ok(listed(&v))
}

/// Entries of a models listing (`data[]`, or a bare array), with context windows when reported.
pub fn listed(v: &Value) -> Vec<Found> {
    let entries = v["data"].as_array().or(v.as_array()).into_iter().flatten();
    entries
        .filter_map(|x| {
            let name = x["id"].as_str().or(x["name"].as_str())?.to_string();
            let context = CONTEXT_FIELDS.iter().find_map(|p| x.pointer(p).and_then(|c| c.as_u64())).unwrap_or(0) as u32;
            Some(Found { name, context })
        })
        .collect()
}

static CONTEXTS: std::sync::Mutex<Option<std::collections::HashMap<String, u32>>> = std::sync::Mutex::new(None);

/// A model's context window: its own `context`, else what its runtime lists (asked once, cached).
pub async fn context(m: &Model) -> u32 {
    if m.context > 0 {
        return m.context;
    }
    let key = format!("{}|{}|{}", m.method, m.base_url, m.name);
    if let Some(c) = CONTEXTS.held().get_or_insert_with(Default::default).get(&key) {
        return *c;
    }
    let c = discover(m).await.ok().and_then(|f| f.into_iter().find(|f| f.name == m.name)).map(|f| f.context).unwrap_or(0);
    CONTEXTS.held().get_or_insert_with(Default::default).insert(key, c);
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn complete_cli(m: &Model, p: &str) -> Result<String, String> {
        complete(m, p, &Sampling::default()).await
    }

    #[tokio::test]
    async fn any_cli_is_a_runtime() {
        let m = |c: &[&str]| Model { name: "m1".into(), method: "cli".into(), command: c.iter().map(|s| s.to_string()).collect(), ..Default::default() };
        assert_eq!(complete_cli(&m(&["echo", "{model}:{prompt}"]), "hi").await.unwrap(), "m1:hi");
        assert_eq!(complete_cli(&m(&["cat"]), "via stdin").await.unwrap(), "via stdin");
        assert!(complete_cli(&m(&["false"]), "x").await.is_err());
        assert!(complete_cli(&m(&[]), "x").await.is_err());
    }

    /// A reply is handed on piece by piece: a server's events (a line may arrive cut in two),
    /// a command's output as it prints it, a Claude Code stream's text.
    #[tokio::test]
    async fn a_reply_is_handed_on_as_it_arrives() {
        let mut ev = Events::default();
        assert_eq!(ev.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"con"), ["Hel"]);
        assert_eq!(ev.feed(b"tent\":\"lo\"}}]}\n\ndata: [DONE]\n"), ["lo"]);
        assert!(ev.done && ev.text == "Hello");
        let heard: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
        let h = heard.clone();
        let said: Said = std::sync::Arc::new(move |p: &str| h.held().push(p.to_string()));
        let m = |c: &str, input: &str| Model { name: "m".into(), method: "cli".into(), input: input.into(), command: vec!["/bin/sh".into(), "-c".into(), c.into()], ..Default::default() };
        assert_eq!(stream(&m("printf 'one '; sleep 0.2; printf two", ""), "x", &Sampling::default(), &[], Some(&said)).await.unwrap(), "one two");
        assert_eq!(*heard.held(), ["one ", "two"], "two prints, two pieces");
        heard.held().clear();
        let lines = r#"cat >/dev/null; echo '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"a"}}}'; sleep 0.2; echo '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"b"}}}'; echo '{"type":"assistant","message":{"content":[{"type":"text","text":"ab"}]}}'; echo '{"type":"result","result":"ab"}'"#;
        assert_eq!(stream(&m(lines, "stream-json"), "x", &Sampling::default(), &[], Some(&said)).await.unwrap(), "ab");
        assert_eq!(*heard.held(), ["a", "b"], "deltas once: the whole message after them is not said again");
    }

    #[tokio::test]
    async fn unknown_method_fails() {
        let m = Model { name: "x".into(), method: "nope".into(), ..Default::default() };
        assert!(complete(&m, "hi", &Sampling::default()).await.is_err());
    }

    #[test]
    fn old_model_files_still_load() {
        let m: Model = serde_json::from_value(json!({"name": "q", "connector": "openai", "key_env": "K"})).unwrap();
        assert_eq!((m.method.as_str(), m.token_env.as_str()), ("openai", "K"));
    }

    /// Images reach each method in its own form: content parts for `openai`, one stream
    /// message for a `cli` model that reads `stream-json`; the reply is the stream's result.
    #[tokio::test]
    async fn images_are_shown_in_the_form_each_method_takes() {
        let dir = std::env::temp_dir().join(format!("askk-infer-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.jpg");
        std::fs::write(&file, b"foob").unwrap();
        let att = |path: &str, label: &str| Attachment { id: "ab12".into(), kind: "image".into(), mime: "image/jpeg".into(), path: path.into(), label: label.into() };
        let imgs = images(&[att(&file.to_string_lossy(), "frame at 1.0s"), att("/nowhere.jpg", "")]).await;
        assert_eq!(imgs, vec![Image { label: "[media:ab12] frame at 1.0s:".into(), mime: "image/jpeg".into(), data: "Zm9vYg==".into() }], "an unreadable image is left out");
        let m = Model { name: "m".into(), ..Default::default() };
        let b = body_with(&m, "what is it?", &Sampling::default(), &imgs);
        let parts = b["messages"][0]["content"].as_array().unwrap();
        assert_eq!(parts[1]["image_url"]["url"], "data:image/jpeg;base64,Zm9vYg==");
        assert_eq!(parts.last().unwrap()["text"], "what is it?", "the prompt closes the message");
        let msg = stream_message("what is it?", &imgs);
        assert_eq!(msg["message"]["content"][1]["source"]["data"], "Zm9vYg==");
        assert_eq!(stream_result("{\"type\":\"system\"}\nnoise\n{\"type\":\"result\",\"result\":\" a square \"}\n").unwrap(), "a square");
        assert_eq!(stream_result("{\"type\":\"result\",\"is_error\":true,\"result\":\"over limit\"}").unwrap_err(), "over limit");
        assert!(stream_result("nothing").unwrap_err().contains("no result"));
        // A stream model: the message arrives on stdin; a text model is shown nothing.
        let echo = Model { name: "m".into(), method: "cli".into(), input: "stream-json".into(), command: vec!["/bin/sh".into(), "-c".into(), "read line; case \"$line\" in *Zm9vYg==*) echo '{\"type\":\"result\",\"result\":\"saw it\"}';; *) echo '{\"type\":\"result\",\"result\":\"blind\"}';; esac".into()], ..Default::default() };
        assert_eq!(complete_with(&echo, "look", &Sampling::default(), &[att(&file.to_string_lossy(), "")]).await.unwrap(), "saw it");
        assert_eq!(complete_with(&echo, "look", &Sampling::default(), &[]).await.unwrap(), "blind");
        let bad = Model { input: "morse".into(), ..echo.clone() };
        assert!(complete(&bad, "x", &Sampling::default()).await.unwrap_err().contains("not one of"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sampling_is_sent_only_when_set() {
        let m = Model { name: "m".into(), ..Default::default() };
        let plain = body(&m, "hi", &Sampling::default());
        assert!(plain.get("temperature").is_none() && plain.get("top_p").is_none());
        let hot = body(&m, "hi", &Sampling { temperature: Some(0.2), top_p: Some(0.9) });
        assert_eq!(hot["temperature"], json!(0.2f32));
        assert_eq!(hot["top_p"], json!(0.9f32));
        assert_eq!(hot["max_tokens"], json!(32000));
    }

    #[tokio::test]
    async fn context_window_is_the_models_own_or_read_from_the_listing() {
        let anthropic = json!({"data": [{"id": "claude-x", "max_input_tokens": 200000}, {"id": "bare"}]});
        assert_eq!(listed(&anthropic), vec![Found { name: "claude-x".into(), context: 200000 }, Found { name: "bare".into(), context: 0 }]);
        assert_eq!(listed(&json!([{"name": "qwen", "context_length": 32768}]))[0].context, 32768);
        let own = Model { name: "m".into(), context: 1234, ..Default::default() };
        assert_eq!(context(&own).await, 1234);
    }

    /// The openai method against a local stub server: base url + /chat/completions, bearer token
    /// from `token_env`, sampling in the body, reply read from choices.
    #[tokio::test]
    async fn openai_is_just_a_base_url_and_token() {
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
        std::env::set_var("ASKK_TEST_TOKEN", "sekret");
        let m = Model { name: "local-model".into(), base_url: format!("http://{addr}/v1/"), token_env: "ASKK_TEST_TOKEN".into(), ..Default::default() };
        assert_eq!(complete(&m, "ping", &Sampling { temperature: Some(0.5), top_p: None }).await.unwrap(), "pong");
        let req = server.await.unwrap();
        assert!(req.starts_with("POST /v1/chat/completions"), "{req}");
        assert!(req.to_lowercase().contains("authorization: bearer sekret"));
        assert!(req.contains(r#""model":"local-model""#) && req.contains(r#""content":"ping""#) && req.contains(r#""temperature":0.5"#), "{req}");
    }
}
