//! `FetchTransport`: the browser impl of the askk-inference `Transport`
//! seam (ADR-009) over the fetch API. Non-2xx statuses are returned as
//! responses — adapters own status mapping; only network-level failure is
//! a `TransportError`.

#[cfg(target_arch = "wasm32")]
pub use imp::FetchTransport;

#[cfg(target_arch = "wasm32")]
mod imp {
    use std::future::Future;
    use std::pin::Pin;

    use askk_inference::{HttpRequest, HttpResponse, Transport, TransportError};
    use js_sys::Array;
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    fn js_msg(e: &JsValue) -> String {
        e.as_string().unwrap_or_else(|| format!("{e:?}"))
    }

    fn connect(ctx: &str, e: JsValue) -> TransportError {
        TransportError::Connect(format!("{ctx}: {}", js_msg(&e)))
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
                let headers = web_sys::Headers::new().map_err(|e| connect("headers", e))?;
                for (name, value) in &req.headers {
                    headers
                        .append(name, value)
                        .map_err(|e| connect("header", e))?;
                }
                let init = web_sys::RequestInit::new();
                init.set_method(&req.method);
                init.set_headers(headers.as_ref());
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

                let body = JsFuture::from(response.text().map_err(|e| connect("body", e))?)
                    .await
                    .map_err(|e| connect("body", e))?
                    .as_string()
                    .unwrap_or_default();
                Ok(HttpResponse {
                    status: response.status(),
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
