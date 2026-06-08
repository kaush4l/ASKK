//! Persisted configuration for an in-browser MCP (Model Context Protocol) server.
//!
//! [`McpServerConfig`] mirrors the provider-profile pattern: a stable id, a
//! human-readable name, and the connection details. [`McpServerKind`] is the seam
//! for future transports — only the browser-hosted (JS module) kind exists today;
//! HTTP (remote) and Stdio (gateway-bridged) kinds are added later.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How an MCP server is reached. Only [`McpServerKind::Browser`] exists today;
/// remote and bridged transports are added later — this enum is the seam.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum McpServerKind {
    /// A JS module loaded and run inside the browser tab.
    #[default]
    Browser,
}

/// A saved, named MCP server connection. Persisted as part of the [`AppSnapshot`]
/// so configured servers survive reloads.
///
/// [`AppSnapshot`]: crate::state::AppSnapshot
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct McpServerConfig {
    /// Stable identity, generated once on creation.
    pub id: String,
    /// Human-readable label shown in the UI.
    pub name: String,
    /// The transport used to reach this server.
    #[serde(default)]
    pub kind: McpServerKind,
    /// Path to the JS module that implements the server (for browser-kind servers).
    pub module_path: String,
    /// Whether this server's tools are offered to the agent.
    pub enabled: bool,
}

impl McpServerConfig {
    /// Create a new, enabled browser-kind MCP server with a fresh id.
    // Consumed by the sibling MCP UI/runtime units that land separately.
    #[allow(dead_code)]
    pub fn new(name: impl Into<String>, module_path: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            module_path: module_path.into(),
            kind: McpServerKind::Browser,
            enabled: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppSnapshot;

    #[test]
    fn mcp_server_config_round_trips_through_json() {
        let config = McpServerConfig::new("Reference", "/assets/mcp_reference_server.js");
        let json = serde_json::to_string(&config).unwrap();
        let decoded: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, decoded);
    }

    #[test]
    fn mcp_server_kind_serializes_snake_case() {
        let json = serde_json::to_string(&McpServerKind::Browser).unwrap();
        assert_eq!(json, "\"browser\"");
    }

    #[test]
    fn old_snapshot_without_mcp_servers_defaults_to_empty() {
        // Build a valid snapshot, drop the `mcp_servers` key, and confirm an older
        // persisted shape still deserializes with the field defaulting to empty.
        let base = AppSnapshot::default();
        let mut value = serde_json::to_value(&base).unwrap();
        value
            .as_object_mut()
            .expect("snapshot serializes to a JSON object")
            .remove("mcp_servers");

        let restored: AppSnapshot = serde_json::from_value(value).unwrap();
        assert!(restored.mcp_servers.is_empty());
    }
}
