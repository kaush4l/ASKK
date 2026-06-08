//! Persisted configuration for an in-browser MCP (Model Context Protocol) server.
//!
//! [`McpServerConfig`] mirrors the provider-profile pattern: a stable id, a
//! human-readable name, and the connection details. [`McpServerKind`] is the seam
//! for transports. Two browser-only kinds exist today:
//!
//! * [`McpServerKind::Browser`] — a pre-written JS module (a complete classic Web
//!   Worker that implements the JSON-RPC plumbing itself, like the bundled reference
//!   server) loaded by `module_path`.
//! * [`McpServerKind::Shellized`] — a server described purely by its tools in
//!   [`McpServerConfig::definition`]. The runtime wraps ("shellizes") that definition
//!   in a generic shell worker that supplies all the MCP/JSON-RPC protocol, so a user
//!   defines a server by writing only tool logic. See [`McpServerDefinition`].
//!
//! Remote (HTTP) and bridged (stdio) transports are added later — this enum is the
//! seam.

use crate::state::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

/// How an MCP server is reached and run. Both kinds today run entirely inside the
/// browser tab; remote and bridged transports are added later.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum McpServerKind {
    /// A pre-written JS module loaded and run inside the browser tab as a classic Web
    /// Worker. The module implements the MCP JSON-RPC protocol itself.
    #[default]
    Browser,
    /// A server defined only by its tools ([`McpServerConfig::definition`]). The
    /// runtime injects the definition into a generic shell worker that supplies the
    /// MCP protocol — so the author writes tool logic, never the plumbing.
    Shellized,
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
    /// Path to the JS module that implements the server (for [`McpServerKind::Browser`]).
    pub module_path: String,
    /// The tool definition JSON for a [`McpServerKind::Shellized`] server. Parsed into
    /// an [`McpServerDefinition`] at connect time and injected into the shell worker.
    /// Empty (and ignored) for browser-kind servers. Defaulted so snapshots written
    /// before shellized servers existed still deserialize.
    #[serde(default)]
    pub definition: String,
    /// Whether this server's tools are offered to the agent.
    pub enabled: bool,
}

impl McpServerConfig {
    /// Create a new, enabled browser-kind MCP server (a pre-written JS module) with a
    /// fresh id.
    pub fn new(name: impl Into<String>, module_path: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            kind: McpServerKind::Browser,
            module_path: module_path.into(),
            definition: String::new(),
            enabled: true,
        }
    }

    /// Create a new, enabled [`McpServerKind::Shellized`] server with a fresh id. The
    /// `definition` is the tool-definition JSON wrapped by the shell worker at run
    /// start; [`default_shellized_definition`] is a ready-to-edit starting point.
    pub fn new_shellized(name: impl Into<String>, definition: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            kind: McpServerKind::Shellized,
            module_path: String::new(),
            definition: definition.into(),
            enabled: true,
        }
    }
}

/// The default `inputSchema` for a shell tool that declares none: an open object.
#[allow(dead_code)] // referenced by ShellToolDef's serde derive; see struct note.
fn default_input_schema() -> Value {
    json!({ "type": "object" })
}

/// One tool in a [`McpServerDefinition`]. `handler` is the JS source of an (async)
/// function body taking `args` (the parsed tool arguments) and returning a value the
/// shell worker normalizes into an MCP result: a string/number is sent as text, an
/// object/array as pretty JSON, and a `{ content, isError? }` shape is passed through
/// verbatim. A thrown error becomes a tool-level error result.
// Constructed only by the wasm registry (when shellizing) and the host tests; the
// non-test host bin never names it, so it reads as dead code there.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShellToolDef {
    /// Tool name the model calls (must be non-empty and unique within the server).
    pub name: String,
    /// Human-readable description shown to the model.
    #[serde(default)]
    pub description: String,
    /// JSON Schema for the tool's arguments. Serialized as camelCase `inputSchema` to
    /// match the MCP wire shape the shell worker expects.
    #[serde(
        default = "default_input_schema",
        rename = "inputSchema",
        alias = "input_schema"
    )]
    pub input_schema: Value,
    /// JS source for the tool's handler body (e.g. `return String(args.a + args.b);`).
    #[serde(default)]
    pub handler: String,
}

/// A shellized MCP server: a name plus the tools to expose. Parsed from
/// [`McpServerConfig::definition`] and injected into the generic shell worker, which
/// supplies the MCP/JSON-RPC protocol around these tools.
// Built and parsed by the wasm registry + host tests; see the note on `ShellToolDef`.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct McpServerDefinition {
    /// Server name advertised in the MCP `initialize` handshake. Optional.
    #[serde(default)]
    pub name: String,
    /// The tools this server exposes.
    #[serde(default)]
    pub tools: Vec<ShellToolDef>,
}

impl McpServerDefinition {
    /// Parse and validate a shellized server definition from its JSON text, returning
    /// a human-readable error (surfaced in the UI / run log) on malformed input. A
    /// definition with zero tools is rejected: an empty server can advertise nothing.
    #[allow(dead_code)] // called by the wasm registry + host tests; see struct note.
    pub fn parse(text: &str) -> AppResult<Self> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err("MCP definition is empty — add at least one tool.".to_string());
        }
        let def: McpServerDefinition = serde_json::from_str(trimmed)
            .map_err(|err| format!("Invalid MCP definition JSON: {err}"))?;
        if def.tools.is_empty() {
            return Err("MCP definition declares no tools.".to_string());
        }
        for (index, tool) in def.tools.iter().enumerate() {
            if tool.name.trim().is_empty() {
                return Err(format!(
                    "Tool #{} in the MCP definition has no name.",
                    index + 1
                ));
            }
        }
        Ok(def)
    }
}

/// A ready-to-edit shellized definition: one `multiply` tool whose handler is a
/// single line of JS. New shellized servers start from this so the author has a
/// working example to adapt.
pub fn default_shellized_definition() -> String {
    let def = json!({
        "name": "Calculator",
        "tools": [
            {
                "name": "multiply",
                "description": "Multiply two numbers and return the product.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "a": { "type": "number" },
                        "b": { "type": "number" }
                    },
                    "required": ["a", "b"]
                },
                "handler": "return String(Number(args.a) * Number(args.b));"
            }
        ]
    });
    serde_json::to_string_pretty(&def).unwrap_or_else(|_| "{}".to_string())
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
    fn shellized_config_round_trips_through_json() {
        let config = McpServerConfig::new_shellized("Calc", default_shellized_definition());
        assert_eq!(config.kind, McpServerKind::Shellized);
        let json = serde_json::to_string(&config).unwrap();
        let decoded: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, decoded);
    }

    #[test]
    fn mcp_server_kind_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&McpServerKind::Browser).unwrap(),
            "\"browser\""
        );
        assert_eq!(
            serde_json::to_string(&McpServerKind::Shellized).unwrap(),
            "\"shellized\""
        );
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

    #[test]
    fn config_without_kind_or_definition_defaults() {
        // A config persisted before `kind`/`definition` existed must still load,
        // defaulting to a browser-kind server with an empty definition.
        let text = r#"{
            "id": "abc",
            "name": "Legacy",
            "module_path": "/assets/mcp_reference_server.js",
            "enabled": true
        }"#;
        let config: McpServerConfig = serde_json::from_str(text).unwrap();
        assert_eq!(config.kind, McpServerKind::Browser);
        assert!(config.definition.is_empty());
    }

    #[test]
    fn default_template_parses_and_exposes_multiply() {
        let def = McpServerDefinition::parse(&default_shellized_definition())
            .expect("default template is valid");
        assert_eq!(def.name, "Calculator");
        assert_eq!(def.tools.len(), 1);
        assert_eq!(def.tools[0].name, "multiply");
        assert!(!def.tools[0].handler.trim().is_empty());
    }

    #[test]
    fn parse_defaults_missing_input_schema_to_open_object() {
        let def =
            McpServerDefinition::parse(r#"{ "tools": [ { "name": "ping" } ] }"#).expect("parse");
        assert_eq!(def.tools[0].input_schema, default_input_schema());
    }

    #[test]
    fn parse_accepts_snake_case_input_schema_alias() {
        let def = McpServerDefinition::parse(
            r#"{ "tools": [ { "name": "ping", "input_schema": { "type": "object" } } ] }"#,
        )
        .expect("parse alias");
        assert_eq!(def.tools[0].input_schema["type"], "object");
    }

    #[test]
    fn parse_rejects_empty_text_no_tools_and_unnamed_tools() {
        assert!(McpServerDefinition::parse("   ").is_err());
        assert!(McpServerDefinition::parse(r#"{ "tools": [] }"#).is_err());
        assert!(McpServerDefinition::parse("{ not json").is_err());
        assert!(
            McpServerDefinition::parse(r#"{ "tools": [ { "name": "" } ] }"#).is_err(),
            "an unnamed tool must be rejected"
        );
    }

    #[test]
    fn definition_serializes_input_schema_as_camelcase() {
        // The shell worker reads `tool.inputSchema`, so the injected JSON must use the
        // camelCase key regardless of the alias accepted on input.
        let def = McpServerDefinition::parse(
            r#"{ "tools": [ { "name": "ping", "input_schema": { "type": "object" } } ] }"#,
        )
        .unwrap();
        let json = serde_json::to_value(&def).unwrap();
        assert!(json["tools"][0].get("inputSchema").is_some());
        assert!(json["tools"][0].get("input_schema").is_none());
    }
}
