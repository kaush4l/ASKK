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

    /// Streaming send: raw body chunks hit `on_chunk` as they arrive; the
    /// complete response (status + full body) is still the return value.
    /// Default = buffered `send` delivered as one chunk, so every transport
    /// keeps working; fetch overrides with a real ReadableStream reader.
    fn send_stream<'a>(
        &'a self,
        req: HttpRequest,
        on_chunk: &'a mut dyn FnMut(&str),
    ) -> LocalBoxFuture<'a, Result<HttpResponse, TransportError>> {
        Box::pin(async move {
            let resp = self.send(req).await?;
            on_chunk(&resp.body);
            Ok(resp)
        })
    }
}

/// Chunk-boundary-safe SSE assembly: buffers partial events across `feed`
/// calls and yields only complete (blank-line-terminated) events. `finish`
/// flushes a trailing event that never got its blank line.
#[derive(Default)]
pub struct SseAssembler {
    buffer: String,
}

impl SseAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();
        while let Some(end) = find_blank_line(&self.buffer) {
            let block: String = self.buffer.drain(..end).collect();
            events.extend(parse_sse_lines(&block));
        }
        events
    }

    pub fn finish(&mut self) -> Vec<SseEvent> {
        let rest = std::mem::take(&mut self.buffer);
        parse_sse_lines(&rest)
    }
}

/// Index just past the first blank line (`\n\n` or `\n\r\n`), if any.
fn find_blank_line(buf: &str) -> Option<usize> {
    let lf = buf.find("\n\n").map(|i| i + 2);
    let crlf = buf.find("\n\r\n").map(|i| i + 3);
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

/// Incremental UTF-8 decoding for byte streams: holds an incomplete trailing
/// multi-byte sequence for the next `feed`; genuinely invalid bytes become
/// U+FFFD instead of stalling the stream.
#[derive(Default)]
pub struct Utf8Accumulator {
    pending: Vec<u8>,
}

impl Utf8Accumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    // `valid` is a UTF-8 boundary from `valid_up_to()`, so this
                    // slice always decodes; use a non-panicking form regardless
                    // so a malformed stream can never panic the decoder (ADR-042).
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match e.error_len() {
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + bad);
                        }
                        None => {
                            // Incomplete tail: hold it for the next chunk.
                            self.pending.drain(..valid);
                            break;
                        }
                    }
                }
            }
        }
        out
    }
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
    fn assembler_yields_events_across_chunk_boundaries() {
        let mut assembler = SseAssembler::new();
        assert!(assembler.feed("data: hel").is_empty());
        assert!(assembler.feed("lo\n").is_empty()); // event not terminated yet
        let events = assembler.feed("\ndata: world\n\ndata: tail");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "hello");
        assert_eq!(events[1].data, "world");
        let tail = assembler.finish();
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].data, "tail");
        assert!(assembler.finish().is_empty());
    }

    #[test]
    fn assembler_handles_crlf_blank_lines() {
        let mut assembler = SseAssembler::new();
        let events = assembler.feed("data: a\r\n\r\ndata: b\r\n\r\n");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "a");
        assert_eq!(events[1].data, "b");
    }

    #[test]
    fn utf8_accumulator_holds_split_multibyte_and_replaces_invalid() {
        let mut acc = Utf8Accumulator::new();
        let euro = "€".as_bytes(); // 3 bytes
        assert_eq!(acc.feed(&euro[..1]), "");
        assert_eq!(acc.feed(&euro[1..]), "€");
        assert_eq!(acc.feed(b"ok"), "ok");
        assert_eq!(acc.feed(&[0xFF, b'x']), "\u{FFFD}x");
    }

    #[test]
    fn utf8_accumulator_decodes_valid_prefix_before_invalid_byte() {
        // valid_up_to()=1 ("a"), then an invalid byte (→ U+FFFD), then "b":
        // the non-empty valid prefix must decode without a panic (ADR-042).
        let mut acc = Utf8Accumulator::new();
        assert_eq!(acc.feed(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }

    #[test]
    fn default_send_stream_delivers_one_chunk() {
        let transport = MockTransport::new();
        transport.push_ok(200, "whole body");
        let mut chunks = Vec::new();
        let req = HttpRequest {
            method: "GET".into(),
            url: "http://x".into(),
            headers: vec![],
            body: String::new(),
        };
        let resp =
            block_on(transport.send_stream(req, &mut |c| chunks.push(c.to_string()))).unwrap();
        assert_eq!(chunks, vec!["whole body"]);
        assert_eq!(resp.body, "whole body");
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
