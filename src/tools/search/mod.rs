//! Swappable web-search engines for the browser-direct `web_search` backend.
//!
//! Each engine is one file implementing [`SearchEngine`]; [`resolve_browser_engine`]
//! is the single place that maps the user's configured provider to an engine
//! instance. Adding another engine (a different metasearch, a CORS-friendly provider,
//! …) is one new module plus one match arm here — the `web_search` tool and the agent
//! loop never change. This mirrors the tool registry's one-impl-plus-one-registration
//! idiom in [`crate::tools`].
//!
//! Engines return [`SearchHit`]s, which drop straight into the existing key-free merge
//! via [`SearchHit::into_tuple`], so a SearXNG result set and the key-free fan-out
//! share one shape and one envelope.

use crate::state::{AppResult, WebSearchProvider, WebSearchToolConfig};
use std::future::Future;
use std::pin::Pin;

mod searxng;

pub(crate) use searxng::SearxngEngine;

/// One search result: the shared `(title, url, description)` triple every browser
/// source produces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SearchHit {
    pub title: String,
    pub url: String,
    pub description: String,
}

impl SearchHit {
    /// Convert into the `(title, url, description)` tuple the key-free merge consumes.
    pub(crate) fn into_tuple(self) -> (String, String, String) {
        (self.title, self.url, self.description)
    }
}

/// Per-call search options distilled from the tool args plus configured defaults.
/// Pure data, so an engine's URL builder stays host-testable with no I/O.
#[derive(Clone, Debug, Default)]
pub(crate) struct SearchOptions {
    /// Preferred result language (e.g. `en`, `en-US`); empty when unset.
    pub language: String,
    /// Recency hint (`day` / `week` / `month` / `year` and common aliases); empty
    /// when unset.
    pub freshness: String,
}

/// Boxed future a search engine returns. Pinned + boxed to mirror the crate's
/// `ToolFuture` style (the codebase deliberately avoids `async-trait`).
pub(crate) type SearchFuture<'a> = Pin<Box<dyn Future<Output = AppResult<Vec<SearchHit>>> + 'a>>;

/// A pluggable web-search engine for the browser-direct backend. One `impl` per
/// engine module; the loop and the `web_search` tool never match on the concrete
/// type — they ask [`resolve_browser_engine`] for one and call [`SearchEngine::search`].
pub(crate) trait SearchEngine {
    /// Stable identifier, surfaced in the result envelope's `backend` field
    /// (e.g. `searxng` → `"browser+searxng"`).
    fn id(&self) -> &'static str;

    /// Run the query, returning ordered hits (already relevance-ranked by the engine).
    fn search<'a>(
        &'a self,
        query: &'a str,
        count: usize,
        opts: &'a SearchOptions,
    ) -> SearchFuture<'a>;
}

/// Map the configured provider to a browser-direct engine, or `None` when the browser
/// backend should use its key-free fan-out instead.
///
/// SearXNG is selected when the user picked it explicitly, or under `Auto` whenever a
/// `searxng_url` is configured (true by default — the app ships a public instance), so
/// "use SearXNG for the search engine" holds out of the box while the key-free sources
/// remain the automatic fallback. To add an engine: implement [`SearchEngine`] in a new
/// module and extend this match.
pub(crate) fn resolve_browser_engine(
    config: &WebSearchToolConfig,
) -> Option<Box<dyn SearchEngine>> {
    let searxng_url = config.searxng_url.trim();
    match config.provider {
        WebSearchProvider::SearXng | WebSearchProvider::Auto if !searxng_url.is_empty() => {
            Some(Box::new(SearxngEngine::new(searxng_url)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(provider: WebSearchProvider, searxng_url: &str) -> WebSearchToolConfig {
        WebSearchToolConfig {
            provider,
            searxng_url: searxng_url.to_string(),
            ..WebSearchToolConfig::default()
        }
    }

    #[test]
    fn into_tuple_preserves_field_order() {
        let hit = SearchHit {
            title: "t".to_string(),
            url: "u".to_string(),
            description: "d".to_string(),
        };
        assert_eq!(
            hit.into_tuple(),
            ("t".to_string(), "u".to_string(), "d".to_string())
        );
    }

    #[test]
    fn auto_with_searxng_url_selects_searxng() {
        let config = config_with(WebSearchProvider::Auto, "https://searx.example");
        let engine = resolve_browser_engine(&config).expect("engine");
        assert_eq!(engine.id(), "searxng");
    }

    #[test]
    fn explicit_searxng_selects_searxng() {
        let config = config_with(WebSearchProvider::SearXng, "https://searx.example");
        assert_eq!(resolve_browser_engine(&config).unwrap().id(), "searxng");
    }

    #[test]
    fn auto_without_url_uses_key_free_fan_out() {
        let config = config_with(WebSearchProvider::Auto, "   ");
        assert!(resolve_browser_engine(&config).is_none());
    }

    #[test]
    fn explicit_other_provider_skips_browser_engine() {
        // Tavily / Brave / DuckDuckGo run via their own paths, not a browser engine.
        let config = config_with(WebSearchProvider::Tavily, "https://searx.example");
        assert!(resolve_browser_engine(&config).is_none());
    }
}
