//! Spike A — the seam (PROMPT.md §3).
//!
//! The whole application behind one pure function: HTTP-shaped in, HTML-shaped
//! out. No I/O, no browser, no wasm-bindgen in this file — it tests natively.

#[cfg(target_arch = "wasm32")]
mod wasm;

/// HTTP-shaped input. Exists so the core never sees a browser type.
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Request {
    /// Shorthand used by tests and transports for the common case.
    pub fn get(path: &str) -> Self {
        Request {
            method: "GET".into(),
            path: path.into(),
            headers: Vec::new(),
            body: String::new(),
        }
    }
}

/// HTML-shaped output. Body is a fragment htmx can swap directly.
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

fn html(status: u16, body: String) -> Response {
    Response {
        status,
        headers: vec![("content-type".into(), "text/html; charset=utf-8".into())],
        body,
    }
}

/// The whole application. Everything else in the system is downstream of
/// protecting this one signature (invariant I4).
pub fn handle(req: Request) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/panel") => html(
            200,
            "<div id=\"panel\"><h2>Panel</h2>\
             <p>Hello from the Rust core.</p></div>"
                .into(),
        ),
        ("GET", "/about") => html(
            200,
            "<div id=\"about\"><h2>About</h2>\
             <p>HARNESS spike A: htmx in, Rust core out, one seam.</p></div>"
                .into(),
        ),
        ("GET", p) if p.starts_with("/stream/") => stream_chunk(&p["/stream/".len()..]),
        _ => html(
            404,
            format!("<div class=\"error\">no route: {}</div>", escape(&req.path)),
        ),
    }
}

/// Minimal HTML escape for text interpolated into fragments. The request path
/// is caller-controlled; echoing it raw would make the seam an injection vector.
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Streaming proof: each chunk ends with an htmx self-triggering placeholder
/// that pulls the next chunk, so the fragment arrives in 3 visible steps.
/// Chosen over the SSE extension: zero extra JS, the chain lives in the core.
fn stream_chunk(n: &str) -> Response {
    let n: u32 = match n.parse() {
        Ok(v) if v <= 2 => v,
        _ => return html(404, "<div class=\"error\">no such chunk</div>".into()),
    };
    let mut body = format!("<p class=\"chunk\">chunk {} of 3</p>", n + 1);
    if n < 2 {
        // The placeholder outerHTML-swaps itself for the next chunk, so
        // earlier chunks stay visible and the stream accumulates.
        body.push_str(&format!(
            "<div hx-get=\"/stream/{}\" hx-trigger=\"load delay:250ms\" \
             hx-swap=\"outerHTML\"></div>",
            n + 1
        ));
    }
    html(200, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_returns_fragment() {
        let res = handle(Request::get("/panel"));
        assert_eq!(res.status, 200);
        assert!(res.body.contains("Hello from the Rust core."));
        assert!(res.body.starts_with("<div id=\"panel\">"));
    }

    #[test]
    fn about_returns_fragment() {
        let res = handle(Request::get("/about"));
        assert_eq!(res.status, 200);
        assert!(res.body.contains("one seam"));
    }

    #[test]
    fn unknown_route_is_404_fragment() {
        let res = handle(Request::get("/nope"));
        assert_eq!(res.status, 404);
        assert!(res.body.contains("no route: /nope"));
    }

    #[test]
    fn echoed_path_is_html_escaped() {
        let res = handle(Request::get("/<img src=x onerror=alert(1)>"));
        assert_eq!(res.status, 404);
        assert!(!res.body.contains("<img"));
        assert!(res.body.contains("&lt;img src=x onerror=alert(1)&gt;"));
    }

    #[test]
    fn stream_chunks_chain_then_terminate() {
        let c0 = handle(Request::get("/stream/0"));
        assert!(c0.body.contains("chunk 1 of 3"));
        assert!(c0.body.contains("hx-get=\"/stream/1\""));
        let c1 = handle(Request::get("/stream/1"));
        assert!(c1.body.contains("hx-get=\"/stream/2\""));
        let c2 = handle(Request::get("/stream/2"));
        assert!(c2.body.contains("chunk 3 of 3"));
        assert!(!c2.body.contains("hx-get")); // chain terminates
        assert_eq!(handle(Request::get("/stream/9")).status, 404);
    }

    #[test]
    fn responses_declare_html_content_type() {
        let res = handle(Request::get("/panel"));
        assert!(res
            .headers
            .iter()
            .any(|(k, v)| k == "content-type" && v.starts_with("text/html")));
    }
}
