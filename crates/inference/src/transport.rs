//! The injected HTTP/SSE seam (ADR-009). Mocked in tests; fetch in `web`.

use std::cell::RefCell;
use std::collections::VecDeque;

use futures::future::LocalBoxFuture;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl HttpResponse {
    pub fn ok(body: impl Into<String>) -> Self {
        Self {
            status: 200,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// Could not connect at all (DNS, refused, CORS preflight).
    Connect(String),
    Timeout,
}

/// Dyn-safe, local-future transport. Browser is single-threaded: no Send.
pub trait Transport {
    fn send(&self, req: HttpRequest) -> LocalBoxFuture<'_, Result<HttpResponse, TransportError>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// Pure SSE splitter: blank-line-separated events; multiple `data:` lines
/// join with `\n`; comment (`:`) and unknown fields are ignored.
pub fn parse_sse_lines(body: &str) -> Vec<SseEvent> {
    let mut events = Vec::new();
    let mut event: Option<String> = None;
    let mut data: Vec<String> = Vec::new();
    let mut flush = |event: &mut Option<String>, data: &mut Vec<String>| {
        if event.is_some() || !data.is_empty() {
            events.push(SseEvent {
                event: event.take(),
                data: data.join("\n"),
            });
            data.clear();
        }
    };
    for line in body.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            flush(&mut event, &mut data);
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.strip_prefix(' ').unwrap_or(value).to_string());
        } else if let Some(value) = line.strip_prefix("event:") {
            event = Some(value.trim().to_string());
        }
    }
    flush(&mut event, &mut data);
    events
}

type ScriptedResponses = RefCell<VecDeque<Result<HttpResponse, TransportError>>>;

/// Scripted transport for adapter tests: pops one response per send and
/// records every request for assertions. Zero network.
#[derive(Debug, Default)]
pub struct MockTransport {
    responses: ScriptedResponses,
    pub requests: RefCell<Vec<HttpRequest>>,
}

impl MockTransport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, response: Result<HttpResponse, TransportError>) {
        self.responses.borrow_mut().push_back(response);
    }

    pub fn push_ok(&self, status: u16, body: &str) {
        self.push(Ok(HttpResponse {
            status,
            headers: Vec::new(),
            body: body.into(),
        }));
    }
}

impl Transport for MockTransport {
    fn send(&self, req: HttpRequest) -> LocalBoxFuture<'_, Result<HttpResponse, TransportError>> {
        self.requests.borrow_mut().push(req);
        let next = self.responses.borrow_mut().pop_front();
        Box::pin(async move {
            next.unwrap_or_else(|| Err(TransportError::Connect("mock script exhausted".into())))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;

    #[test]
    fn sse_splits_events_and_joins_data_lines() {
        let body = "event: message\ndata: hello\ndata: world\n\ndata: [DONE]\n\n";
        let events = parse_sse_lines(body);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].data, "hello\nworld");
        assert_eq!(events[1].data, "[DONE]");
    }

    #[test]
    fn sse_ignores_comments_and_handles_missing_trailing_blank() {
        let events = parse_sse_lines(": keepalive\ndata: x");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "x");
        assert!(parse_sse_lines("").is_empty());
    }

    #[test]
    fn mock_transport_pops_script_and_records_requests() {
        let transport = MockTransport::new();
        transport.push_ok(200, "one");
        let req = HttpRequest {
            method: "POST".into(),
            url: "http://x".into(),
            headers: vec![],
            body: "{}".into(),
        };
        let resp = block_on(transport.send(req.clone())).unwrap();
        assert_eq!(resp.body, "one");
        assert_eq!(transport.requests.borrow().len(), 1);
        // Script exhausted → connect error, not a panic.
        let err = block_on(transport.send(req)).unwrap_err();
        assert!(matches!(err, TransportError::Connect(_)));
    }

    #[test]
    fn response_header_lookup_is_case_insensitive() {
        let resp = HttpResponse {
            status: 429,
            headers: vec![("Retry-After".into(), "2".into())],
            body: String::new(),
        };
        assert_eq!(resp.header("retry-after"), Some("2"));
        assert_eq!(resp.header("missing"), None);
    }
}
