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

/// POST a JSON body to a URL (with an optional bearer token) and parse the JSON
/// response. Used for browser-direct, CORS-allowed BYOK search providers such as
/// Tavily, so a real general-web search works from the hosted site with no bridge.
pub(crate) async fn http_post_json(
    url: &str,
    body: &Value,
    bearer_token: Option<&str>,
) -> AppResult<Value> {
    let payload = serde_json::to_string(body)
        .map_err(|err| format!("Unable to encode request body: {err}"))?;
    let mut builder = Request::post(url).header("Content-Type", "application/json");
    if let Some(token) = bearer_token {
        builder = builder.header("Authorization", &format!("Bearer {token}"));
    }
    let request = builder
        .body(payload)
        .map_err(|err| format!("Unable to build request to {url}: {err:?}"))?;
    let response = request
        .send()
        .await
        .map_err(|err| format!("Browser request to {url} failed (network or CORS): {err:?}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Unable to read response from {url}: {err:?}"))?;
    if !(200..300).contains(&status) {
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("{url} returned HTTP {status}: {snippet}"));
    }
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

/// Turn a full HTML page into readable text: drop the heavy non-content blocks
/// (`script`/`style`/`head`/`noscript`/`svg`/`template`), then strip the remaining
/// tags and decode entities via [`strip_html`]. This is a best-effort cleaner for the
/// non-Jina `web_fetch` fallbacks (direct fetch / CORS proxy), which return raw HTML;
/// it is not a full main-content extractor (nav/footer text may remain). Pure and
/// host-testable.
pub(crate) fn html_to_readable_text(html: &str) -> String {
    let mut cleaned = html.to_string();
    // The `regex` crate has no backreferences, so remove each block type separately.
    // (?is) = case-insensitive + dot-matches-newline; the lazy `.*?` stops at the
    // first matching close tag.
    for tag in ["script", "style", "head", "noscript", "svg", "template"] {
        let pattern = format!(r"(?is)<{tag}\b[^>]*>.*?</{tag}>");
        if let Ok(re) = regex::Regex::new(&pattern) {
            cleaned = re.replace_all(&cleaned, " ").into_owned();
        }
    }
    strip_html(&cleaned)
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

    #[test]
    fn html_to_readable_text_drops_script_style_and_head() {
        let html = "<html><head><title>Title</title></head><body>\
            <script>var a = 1; alert('x');</script>\
            <style>.x { color: red; }</style>\
            <p>Hello <b>world</b> &amp; all.</p></body></html>";
        let text = html_to_readable_text(html);
        assert!(text.contains("Hello world & all."));
        assert!(!text.contains("var a"));
        assert!(!text.contains("color: red"));
        assert!(!text.contains("Title")); // inside <head>, dropped
    }
}
