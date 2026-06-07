//! Configuration for the web-facing tools: which backend runs `web_search` /
//! `web_fetch` (the in-page browser backend or the local bridge), and the search
//! provider settings.

use serde::{Deserialize, Serialize};

/// Where web_search / web_fetch actually run. `Browser` calls CORS-open public
/// endpoints directly from the page (works on the hosted HTTPS site, no bridge).
/// `Bridge` routes through the local ASKK bridge (richer providers, localhost only).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchBackend {
    #[default]
    Browser,
    Bridge,
}

impl SearchBackend {
    pub fn from_form_value(value: &str) -> Self {
        match value {
            "bridge" => Self::Bridge,
            _ => Self::Browser,
        }
    }

    pub fn as_form_value(self) -> &'static str {
        match self {
            Self::Browser => "browser",
            Self::Bridge => "bridge",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum WebSearchProvider {
    #[default]
    Auto,
    #[serde(rename = "duckduckgo")]
    DuckDuckGo,
    #[serde(rename = "searxng")]
    SearXng,
    Brave,
    Tavily,
}

impl WebSearchProvider {
    pub fn from_form_value(value: &str) -> Self {
        match value {
            "duckduckgo" => Self::DuckDuckGo,
            "searxng" => Self::SearXng,
            "brave" => Self::Brave,
            "tavily" => Self::Tavily,
            _ => Self::Auto,
        }
    }

    pub fn as_form_value(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::DuckDuckGo => "duckduckgo",
            Self::SearXng => "searxng",
            Self::Brave => "brave",
            Self::Tavily => "tavily",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WebSearchToolConfig {
    #[serde(default)]
    pub backend: SearchBackend,
    #[serde(default = "default_bridge_tools_url")]
    pub bridge_tools_url: String,
    #[serde(default)]
    pub provider: WebSearchProvider,
    #[serde(default = "default_web_search_count")]
    pub default_count: u32,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub freshness: String,
    #[serde(default)]
    pub searxng_url: String,
    #[serde(default)]
    pub brave_api_key: String,
    #[serde(default)]
    pub tavily_api_key: String,
    #[serde(default)]
    pub persist_api_keys: bool,
}

impl Default for WebSearchToolConfig {
    fn default() -> Self {
        Self {
            backend: SearchBackend::Browser,
            bridge_tools_url: default_bridge_tools_url(),
            provider: WebSearchProvider::Auto,
            default_count: default_web_search_count(),
            country: String::new(),
            language: String::new(),
            freshness: String::new(),
            searxng_url: String::new(),
            brave_api_key: String::new(),
            tavily_api_key: String::new(),
            persist_api_keys: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct ToolConfig {
    #[serde(default)]
    pub web_search: WebSearchToolConfig,
}

pub fn default_bridge_tools_url() -> String {
    "http://127.0.0.1:8874/askk/tools".to_string()
}

fn default_web_search_count() -> u32 {
    5
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn web_search_tool_config_deserializes_defaults() {
        let config = serde_json::from_value::<ToolConfig>(json!({
            "web_search": {
                "provider": "duckduckgo"
            }
        }))
        .unwrap();

        assert_eq!(config.web_search.provider, WebSearchProvider::DuckDuckGo);
        assert_eq!(
            config.web_search.bridge_tools_url,
            default_bridge_tools_url()
        );
        assert_eq!(config.web_search.default_count, 5);
        assert!(!config.web_search.persist_api_keys);
    }
}
