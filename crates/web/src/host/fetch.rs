//! `FetchTransport`: the browser impl of the askk-inference `Transport`
//! seam (ADR-009) over the fetch API. Non-2xx statuses are returned as
//! responses — adapters own status mapping; only network-level failure is
//! a `TransportError`.

#[cfg(target_arch = "wasm32")]
pub use imp::{fetch_text, FetchTransport};

#[cfg(target_arch = "wasm32")]
mod imp {
    use std::future::Future;
    use std::pin::Pin;

    use askk_inference::{HttpRequest, HttpResponse, Transport, TransportError, Utf8Accumulator};
    use js_sys::Array;
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    fn js_msg(e: &JsValue) -> String {
        e.as_string().unwrap_or_else(|| format!("{e:?}"))
    }

    fn connect(ctx: &str, e: JsValue) -> TransportError {
        TransportError::Connect(format!("{ctx}: {}", js_msg(&e)))
    }

    /// Abort the browser fetch if the request future is dropped mid-flight
    /// (run cancel, GAPS 17); disarmed once the body is fully consumed.
    struct AbortOnDrop(Option<web_sys::AbortController>);

    impl AbortOnDrop {
        fn new() -> Self {
            // ponytail: a missing AbortController (None) just means no abort
            // hook — the fetch itself still works.
            Self(web_sys::AbortController::new().ok())
        }

        fn signal(&self) -> Option<web_sys::AbortSignal> {
            self.0.as_ref().map(|c| c.signal())
        }

        fn disarm(&mut self) {
            self.0 = None;
        }
    }

    impl Drop for AbortOnDrop {
        fn drop(&mut self) {
            if let Some(controller) = self.0.take() {
                controller.abort();
            }
        }
    }

    /// Fetch + header extraction shared by the buffered and streaming paths.
    async fn do_fetch(
        req: &HttpRequest,
        signal: Option<&web_sys::AbortSignal>,
    ) -> Result<(web_sys::Response, Vec<(String, String)>), TransportError> {
        let headers = web_sys::Headers::new().map_err(|e| connect("headers", e))?;
        for (name, value) in &req.headers {
            headers
                .append(name, value)
                .map_err(|e| connect("header", e))?;
        }
        let init = web_sys::RequestInit::new();
        init.set_method(&req.method);
        init.set_headers(headers.as_ref());
        init.set_signal(signal);
        if !req.body.is_empty() {
            init.set_body(&JsValue::from_str(&req.body));
        }
        let request = web_sys::Request::new_with_str_and_init(&req.url, &init)
            .map_err(|e| connect("bad request", e))?;
        let window =
            web_sys::window().ok_or_else(|| TransportError::Connect("no window".into()))?;
        let response = JsFuture::from(window.fetch_with_request(&request))
            .await
            .map_err(|e| connect("fetch failed (network, DNS, or CORS preflight)", e))?;
        let response: web_sys::Response = response.unchecked_into();

        // Headers is a sync iterable of [name, value] pairs.
        let mut out_headers = Vec::new();
        if let Ok(Some(entries)) = js_sys::try_iter(response.headers().as_ref()) {
            for entry in entries.flatten() {
                let pair = Array::from(&entry);
                out_headers.push((
                    pair.get(0).as_string().unwrap_or_default(),
                    pair.get(1).as_string().unwrap_or_default(),
                ));
            }
        }
        Ok((response, out_headers))
    }

    async fn read_text(response: &web_sys::Response) -> Result<String, TransportError> {
        Ok(
            JsFuture::from(response.text().map_err(|e| connect("body", e))?)
                .await
                .map_err(|e| connect("body", e))?
                .as_string()
                .unwrap_or_default(),
        )
    }

    /// Plain same-origin GET → body text; non-2xx is an error. Used by boot
    /// to fetch runtime config (agents/manifest.json + agent files).
    pub async fn fetch_text(url: &str) -> Result<String, String> {
        let req = HttpRequest {
            method: "GET".into(),
            url: url.into(),
            headers: Vec::new(),
            body: String::new(),
        };
        let (response, _) = do_fetch(&req, None).await.map_err(|e| format!("{e:?}"))?;
        if !(200..300).contains(&response.status()) {
            return Err(format!("GET {url}: status {}", response.status()));
        }
        read_text(&response).await.map_err(|e| format!("{e:?}"))
    }

    #[derive(Default)]
    pub struct FetchTransport;

    impl FetchTransport {
        pub fn new() -> Self {
            Self
        }
    }

    impl Transport for FetchTransport {
        fn send(
            &self,
            req: HttpRequest,
        ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + '_>> {
            Box::pin(async move {
                let mut abort = AbortOnDrop::new();
                let (response, out_headers) = do_fetch(&req, abort.signal().as_ref()).await?;
                let body = read_text(&response).await?;
                abort.disarm(); // fully consumed; nothing left to abort
                Ok(HttpResponse {
                    status: response.status(),
                    headers: out_headers,
                    body,
                })
            })
        }

        /// Real streaming: body chunks come off the fetch ReadableStream and
        /// hit `on_chunk` as they arrive; the full body is still returned so
        /// error mapping and non-SSE fallbacks keep working.
        fn send_stream<'a>(
            &'a self,
            req: HttpRequest,
            on_chunk: &'a mut dyn FnMut(&str),
        ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + 'a>> {
            Box::pin(async move {
                let mut abort = AbortOnDrop::new();
                let (response, out_headers) = do_fetch(&req, abort.signal().as_ref()).await?;
                let status = response.status();
                let Some(stream) = response.body() else {
                    let body = read_text(&response).await?;
                    on_chunk(&body);
                    abort.disarm();
                    return Ok(HttpResponse {
                        status,
                        headers: out_headers,
                        body,
                    });
                };
                let reader: web_sys::ReadableStreamDefaultReader =
                    stream.get_reader().unchecked_into();
                let mut decoder = Utf8Accumulator::new();
                let mut body = String::new();
                loop {
                    let result = JsFuture::from(reader.read())
                        .await
                        .map_err(|e| connect("stream read", e))?;
                    let done = js_sys::Reflect::get(&result, &JsValue::from_str("done"))
                        .ok()
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    if done {
                        break;
                    }
                    let value = js_sys::Reflect::get(&result, &JsValue::from_str("value"))
                        .map_err(|e| connect("stream chunk", e))?;
                    let text = decoder.feed(&js_sys::Uint8Array::new(&value).to_vec());
                    if !text.is_empty() {
                        on_chunk(&text);
                        body.push_str(&text);
                    }
                }
                abort.disarm(); // stream done; error paths stay armed on purpose
                Ok(HttpResponse {
                    status,
                    headers: out_headers,
                    body,
                })
            })
        }
    }
}

/// Host stub so the crate host-compiles; host runs inject `MockTransport`.
#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code)]
#[derive(Default)]
pub struct FetchTransport;

#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code)]
impl FetchTransport {
    pub fn new() -> Self {
        panic!("FetchTransport is wasm-only (fetch API); host runs use MockTransport")
    }
}
