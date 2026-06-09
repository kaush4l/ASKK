//! SearXNG metasearch, called browser-direct via its JSON API.
//!
//! Browser-direct use needs an instance with `format=json` enabled **and** permissive
//! CORS (`Access-Control-Allow-Origin`). A user's own instance is ideal; some public
//! instances allow it. When an instance blocks the JSON API or CORS, the call errors
//! and `web_search` falls back to its key-free sources — the browser never routes the
//! query through a third-party proxy, which is the point of running SearXNG. (The
//! local bridge offers the same provider server-side with no CORS constraint.)

use super::{SearchEngine, SearchFuture, SearchHit, SearchOptions};
use crate::tools::http::{encode_component, http_get_json};
use serde_json::Value;

/// A SearXNG instance addressed by its base URL (e.g. `https://search.example`).
pub(crate) struct SearxngEngine {
    base_url: String,
}

impl SearxngEngine {
    /// Build from a base URL, trimming whitespace and any trailing slashes so the
    /// `/search` path joins cleanly.
    pub(crate) fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim().trim_end_matches('/').to_string(),
        }
    }

    /// Compose the JSON search URL:
    /// `{base}/search?q=…&format=json&safesearch=1[&language=…][&time_range=…]`.
    fn request_url(&self, query: &str, opts: &SearchOptions) -> String {
        let mut url = format!(
            "{}/search?q={}&format=json&safesearch=1",
            self.base_url,
            encode_component(query),
        );
        let language = opts.language.trim();
        if !language.is_empty() {
            url.push_str("&language=");
            url.push_str(&encode_component(language));
        }
        if let Some(range) = time_range(&opts.freshness) {
            url.push_str("&time_range=");
            url.push_str(range);
        }
        url
    }
}

impl SearchEngine for SearxngEngine {
    fn id(&self) -> &'static str {
        "searxng"
    }

    fn search<'a>(
        &'a self,
        query: &'a str,
        count: usize,
        opts: &'a SearchOptions,
    ) -> SearchFuture<'a> {
        Box::pin(async move {
            let url = self.request_url(query, opts);
            let value = http_get_json(&url).await?;
            Ok(parse_searxng_results(&value, count))
        })
    }
}

/// Parse a SearXNG `{ "results": [...] }` body into ordered hits, capped to `count`.
/// Mirrors the bridge's `normalizeSearxngSearch`: `title` / `url` /
/// `content`→`snippet`→`description` for the description. Skips entries missing a
/// title or URL. Pure and host-testable (no network).
fn parse_searxng_results(value: &Value, count: usize) -> Vec<SearchHit> {
    let Some(results) = value.get("results").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for result in results {
        let title = result
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let url = result
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if title.is_empty() || url.is_empty() {
            continue;
        }
        let description = result
            .get("content")
            .or_else(|| result.get("snippet"))
            .or_else(|| result.get("description"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        out.push(SearchHit {
            title: title.to_string(),
            url: url.to_string(),
            description,
        });
        if out.len() >= count {
            break;
        }
    }
    out
}

/// Map a freshness hint to a SearXNG `time_range` (`day` / `week` / `month` / `year`),
/// or `None` when unset or unrecognized (no recency filter).
fn time_range(freshness: &str) -> Option<&'static str> {
    match freshness.trim().to_lowercase().as_str() {
        "day" | "24h" | "past_day" => Some("day"),
        "week" | "7d" | "past_week" => Some("week"),
        "month" | "past_month" => Some("month"),
        "year" | "past_year" => Some("year"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(language: &str, freshness: &str) -> SearchOptions {
        SearchOptions {
            language: language.to_string(),
            freshness: freshness.to_string(),
        }
    }

    #[test]
    fn request_url_has_query_and_json_format() {
        let engine = SearxngEngine::new("https://search.example/");
        let url = engine.request_url("rust lang", &opts("", ""));
        // trailing slash trimmed, query percent-encoded, JSON format requested.
        assert_eq!(
            url,
            "https://search.example/search?q=rust%20lang&format=json&safesearch=1"
        );
    }

    #[test]
    fn request_url_adds_language_and_time_range() {
        let engine = SearxngEngine::new("https://search.example");
        let url = engine.request_url("news", &opts("en-US", "week"));
        assert!(url.contains("&language=en-US"));
        assert!(url.contains("&time_range=week"));
    }

    #[test]
    fn time_range_maps_known_aliases_and_ignores_unknown() {
        assert_eq!(time_range("day"), Some("day"));
        assert_eq!(time_range("PAST_WEEK"), Some("week"));
        assert_eq!(time_range("month"), Some("month"));
        assert_eq!(time_range("year"), Some("year"));
        assert_eq!(time_range(""), None);
        assert_eq!(time_range("decade"), None);
    }

    #[test]
    fn parse_results_maps_fields_and_caps_count() {
        let value = json!({
            "results": [
                { "title": "Rust", "url": "https://rust-lang.org", "content": "A language." },
                { "title": "Crates", "url": "https://crates.io", "snippet": "Registry." },
                { "title": "No URL", "content": "skip me" },
                { "url": "https://no-title.example", "content": "skip me too" },
                { "title": "Third", "url": "https://example.com/3", "description": "desc field" }
            ]
        });
        let hits = parse_searxng_results(&value, 2);
        assert_eq!(hits.len(), 2); // capped to count
        assert_eq!(hits[0].title, "Rust");
        assert_eq!(hits[0].url, "https://rust-lang.org");
        assert_eq!(hits[0].description, "A language.");
        // second uses `snippet` for the description.
        assert_eq!(hits[1].description, "Registry.");
    }

    #[test]
    fn parse_results_skips_entries_missing_title_or_url() {
        let value = json!({
            "results": [
                { "title": "", "url": "https://example.com/empty-title" },
                { "title": "No URL", "url": "" },
                { "title": "Good", "url": "https://example.com/good" }
            ]
        });
        let hits = parse_searxng_results(&value, 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://example.com/good");
        assert_eq!(hits[0].description, ""); // no content/snippet/description → empty
    }

    #[test]
    fn parse_results_tolerates_missing_results_array() {
        assert!(parse_searxng_results(&json!({}), 5).is_empty());
        assert!(parse_searxng_results(&json!({ "results": "nope" }), 5).is_empty());
    }
}
