//! MCP server configuration: the `mcp_servers` pref parses as EITHER a JSON
//! array of `McpServerConfig` objects (name/url/headers/enabled/allow) OR the
//! legacy newline-separated URL list, which maps onto the same struct with
//! defaults. Empty `allow` = every remote tool allowed.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// One remote Streamable-HTTP MCP server as configured by the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Display name; defaults to the URL slug when omitted.
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
    /// Extra headers on every POST (e.g. Authorization). The protocol's own
    /// Content-Type / Accept / Mcp-Session-Id cannot be overridden.
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Remote tool names to register; empty = all tools.
    #[serde(default)]
    pub allow: Vec<String>,
}

fn default_true() -> bool {
    true
}

/// Pref text → configs: a JSON array of objects is the structured form;
/// anything else is the legacy newline-URL list (defaults: name = URL slug,
/// enabled, no headers, all tools).
pub fn parse_servers(text: &str) -> Vec<McpServerConfig> {
    if let Ok(mut configs) = serde_json::from_str::<Vec<McpServerConfig>>(text) {
        for cfg in &mut configs {
            if cfg.name.trim().is_empty() {
                cfg.name = server_slug(&cfg.url);
            }
        }
        return configs;
    }
    parse_server_list(text)
        .into_iter()
        .map(|url| McpServerConfig {
            name: server_slug(&url),
            url,
            headers: BTreeMap::new(),
            enabled: true,
            allow: Vec::new(),
        })
        .collect()
}

/// Newline-separated pref text → trimmed, non-empty server URLs (the legacy
/// config format, still accepted).
pub fn parse_server_list(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect()
}

/// `https://mcp.example.com/api` → `mcp_example_com_api`: scheme dropped,
/// non-alphanumerics collapsed to single underscores.
pub(super) fn server_slug(url: &str) -> String {
    let stripped = url.split("://").last().unwrap_or(url);
    let mut out = String::new();
    for ch in stripped.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('_') && !out.is_empty() {
            out.push('_');
        }
    }
    out.trim_end_matches('_').to_string()
}
