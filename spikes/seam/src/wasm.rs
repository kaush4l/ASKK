//! Thin wasm-bindgen wrapper around the pure seam. This is the ONLY file in
//! the crate that knows Wasm exists; the transport (web/transport.js) is its
//! only caller.

use crate::{handle, Request};
use wasm_bindgen::prelude::*;

/// JS-visible mirror of `Response`. A struct with getters keeps the boundary
/// dependency-free (no serde) — the transport only needs status + body.
#[wasm_bindgen]
pub struct WasmResponse {
    status: u16,
    headers: String,
    body: String,
}

#[wasm_bindgen]
impl WasmResponse {
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> u16 {
        self.status
    }

    /// Headers as "name: value" lines — enough for a spike, no JSON dep.
    #[wasm_bindgen(getter)]
    pub fn headers(&self) -> String {
        self.headers.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn body(&self) -> String {
        self.body.clone()
    }
}

/// The seam, exported. `headers` uses the same "name: value" line format.
#[wasm_bindgen]
pub fn wasm_handle(method: &str, path: &str, headers: &str, body: &str) -> WasmResponse {
    let req = Request {
        method: method.to_string(),
        path: path.to_string(),
        headers: parse_header_lines(headers),
        body: body.to_string(),
    };
    let res = handle(req);
    WasmResponse {
        status: res.status,
        headers: res
            .headers
            .iter()
            .map(|(k, v)| format!("{}: {}", k, v))
            .collect::<Vec<_>>()
            .join("\n"),
        body: res.body,
    }
}

fn parse_header_lines(lines: &str) -> Vec<(String, String)> {
    lines
        .lines()
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}
