//! Browser-direct HTTP and URL helpers shared by the key-free `web_search` and
//! `web_fetch` backends. These call CORS-open public endpoints straight from the
//! page, so research works on the hosted HTTPS site with no bridge.

use crate::state::AppResult;
use gloo_net::http::Request;
use serde_json::Value;

/// GET a URL and return its body as text, mapping network/CORS and non-2xx
/// failures to readable errors.
pub(crate) async fn http_get_text(url: &str) -> AppResult<String> {
    let response = Request::get(url)
        .send()
        .await
        .map_err(|err| format!("Browser request to {url} failed (network or CORS): {err:?}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read response from {url}: {err:?}"))?;
    if !(200..300).contains(&status) {
        return Err(format!("{url} returned HTTP {status}"));
    }
    Ok(text)
}

/// GET a URL and parse the body as JSON.
pub(crate) async fn http_get_json(url: &str) -> AppResult<Value> {
    let text = http_get_text(url).await?;
    serde_json::from_str::<Value>(&text).map_err(|err| format!("{url} returned non-JSON: {err}"))
}

/// Percent-encode a string for use as a URL query component (RFC 3986 unreserved
/// set kept). Pure and host-testable so it does not depend on `js_sys`.
pub(crate) fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

/// Strip HTML tags and decode the common entities from a search snippet, collapsing
/// whitespace to a single space.
pub(crate) fn strip_html(value: &str) -> String {
    let without_tags = regex::Regex::new("<[^>]+>")
        .map(|re| re.replace_all(value, "").into_owned())
        .unwrap_or_else(|_| value.to_string());
    without_tags
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_component_escapes_reserved_characters() {
        assert_eq!(encode_component("a b&c"), "a%20b%26c");
        assert_eq!(encode_component("rust-lang_2.0~x"), "rust-lang_2.0~x");
    }

    #[test]
    fn strip_html_removes_tags_and_decodes_entities() {
        assert_eq!(
            strip_html("<span class=\"x\">Bun</span> &amp; Node"),
            "Bun & Node"
        );
    }
}
