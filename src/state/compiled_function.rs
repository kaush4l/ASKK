//! Persisted user-defined **compiled functions** and the **tool host** they run in.
//!
//! A [`CompiledFunction`] is the smallest unit of user-supplied tooling: one named
//! function (a JS handler body) with a description and an input schema. It is the
//! second of the three tool sources the agent can be given — MCP server configs,
//! compiled functions, and other agents — and it is deliberately NOT a server: the
//! user writes one function, never protocol plumbing.
//!
//! All enabled functions are hosted together in the **tool host**: a single
//! synthesized shellized MCP server ([`tool_host_server_config`]) that the runtime
//! brings up in its own dedicated Web Worker at run start, exactly like a
//! user-configured server. The shell worker compiles each function once and passes
//! every call a shared `state` object that persists for the worker's lifetime — so
//! the tool host both *hosts all the functions* and *maintains their state* in one
//! worker, in parity with the built-in specialized tools.

use crate::state::AppResult;
use crate::state::mcp::{McpServerConfig, McpServerDefinition, McpServerKind, ShellToolDef};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

/// Stable id of the synthesized tool-host server. Fixed (not a fresh UUID) so the
/// MCP runtime's fingerprint cache reuses the live worker across runs while the
/// function set is unchanged — which is exactly what keeps its `state` alive.
pub const TOOL_HOST_SERVER_ID: &str = "tool-host-builtin";

/// Display name of the synthesized tool-host server (shown in run events and baked
/// into each function's tool description).
pub const TOOL_HOST_SERVER_NAME: &str = "Tool host";

/// One user-defined function offered to the agent as a tool. Persisted as part of
/// the [`AppSnapshot`]; compiled once (per worker lifetime) by the shell worker.
///
/// [`AppSnapshot`]: crate::state::AppSnapshot
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CompiledFunction {
    /// Stable identity, generated once on creation.
    pub id: String,
    /// Tool name the model calls (must be non-empty and unique among functions).
    pub name: String,
    /// Human-readable description shown to the model.
    #[serde(default)]
    pub description: String,
    /// JSON Schema for the function's arguments, kept as editable JSON *text*.
    /// Empty text means "an open object". Parsed (and validated) only when the
    /// tool-host definition is synthesized, so the UI never fights the user
    /// mid-keystroke.
    #[serde(default)]
    pub input_schema: String,
    /// JS source of the handler body. It runs in the tool-host worker as
    /// `async (args, state) => { <body> }` — `args` are the parsed call arguments
    /// and `state` is the host's shared, persistent state object.
    #[serde(default)]
    pub body: String,
    /// Whether this function is offered to the agent.
    pub enabled: bool,
}

impl CompiledFunction {
    /// Create a new, enabled function with a fresh id.
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            description: description.into(),
            input_schema: String::new(),
            body: body.into(),
            enabled: true,
        }
    }
}

/// A ready-to-edit example function demonstrating the persistent `state` object:
/// each call increments a counter that survives across calls and runs.
pub fn default_compiled_function() -> CompiledFunction {
    CompiledFunction::new(
        "counter",
        "Increment a persistent counter held in the tool host's state and return its new value.",
        "state.count = (state.count || 0) + 1;\nreturn String(state.count);",
    )
}

/// Parse a function's `input_schema` text: empty means an open object, anything
/// else must be a JSON object.
fn parse_schema(function: &CompiledFunction) -> AppResult<Value> {
    let trimmed = function.input_schema.trim();
    if trimmed.is_empty() {
        return Ok(json!({ "type": "object" }));
    }
    let schema: Value = serde_json::from_str(trimmed).map_err(|err| {
        format!(
            "Function `{}` has an invalid input schema: {err}",
            function.name
        )
    })?;
    if !schema.is_object() {
        return Err(format!(
            "Function `{}` has an invalid input schema: expected a JSON object.",
            function.name
        ));
    }
    Ok(schema)
}

/// Synthesize the tool-host server from the enabled compiled functions.
///
/// Returns `Ok(None)` when there is nothing to host (no functions, or none
/// enabled), `Ok(Some(config))` with a [`McpServerKind::Shellized`] config the MCP
/// runtime brings up like any user server, and `Err` (naming the offending
/// function) on an empty/duplicate name or unparseable schema — surfaced as a run
/// event / probe error, never a panic.
///
/// The config's `definition` embeds every enabled function, so the runtime's
/// fingerprint changes whenever a function is added, edited, or toggled — forcing a
/// fresh worker (and fresh state) exactly when the function set changes.
pub fn tool_host_server_config(
    functions: &[CompiledFunction],
) -> AppResult<Option<McpServerConfig>> {
    let enabled: Vec<&CompiledFunction> = functions.iter().filter(|f| f.enabled).collect();
    if enabled.is_empty() {
        return Ok(None);
    }

    let mut tools = Vec::with_capacity(enabled.len());
    let mut seen: Vec<&str> = Vec::with_capacity(enabled.len());
    for function in enabled {
        let name = function.name.trim();
        if name.is_empty() {
            return Err("A compiled function has no name — name it or disable it.".to_string());
        }
        if seen.contains(&name) {
            return Err(format!(
                "Two enabled compiled functions are both named `{name}` — names must be unique."
            ));
        }
        seen.push(name);
        tools.push(ShellToolDef {
            name: name.to_string(),
            description: function.description.trim().to_string(),
            input_schema: parse_schema(function)?,
            handler: function.body.clone(),
        });
    }

    let definition = McpServerDefinition {
        name: TOOL_HOST_SERVER_NAME.to_string(),
        tools,
    };
    let definition = serde_json::to_string(&definition)
        .map_err(|err| format!("Unable to encode the tool-host definition: {err}"))?;

    Ok(Some(McpServerConfig {
        id: TOOL_HOST_SERVER_ID.to_string(),
        name: TOOL_HOST_SERVER_NAME.to_string(),
        kind: McpServerKind::Shellized,
        module_path: String::new(),
        definition,
        enabled: true,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add_fn() -> CompiledFunction {
        let mut function = CompiledFunction::new(
            "add",
            "Add two numbers.",
            "return String(Number(args.a) + Number(args.b));",
        );
        function.input_schema = r#"{
            "type": "object",
            "properties": { "a": { "type": "number" }, "b": { "type": "number" } },
            "required": ["a", "b"]
        }"#
        .to_string();
        function
    }

    #[test]
    fn compiled_function_round_trips_through_json() {
        let function = add_fn();
        let json = serde_json::to_string(&function).unwrap();
        let decoded: CompiledFunction = serde_json::from_str(&json).unwrap();
        assert_eq!(function, decoded);
    }

    #[test]
    fn no_enabled_functions_means_no_tool_host() {
        assert_eq!(tool_host_server_config(&[]).unwrap(), None);

        let mut disabled = add_fn();
        disabled.enabled = false;
        assert_eq!(tool_host_server_config(&[disabled]).unwrap(), None);
    }

    #[test]
    fn tool_host_config_is_a_stable_shellized_server() {
        let config = tool_host_server_config(&[add_fn(), default_compiled_function()])
            .unwrap()
            .expect("two enabled functions yield a host");
        assert_eq!(config.id, TOOL_HOST_SERVER_ID);
        assert_eq!(config.name, TOOL_HOST_SERVER_NAME);
        assert_eq!(config.kind, McpServerKind::Shellized);
        assert!(config.enabled);

        // The definition must be exactly what the shell worker expects: parseable,
        // with camelCase `inputSchema` and the body carried as `handler`.
        let definition = McpServerDefinition::parse(&config.definition).expect("valid definition");
        assert_eq!(definition.name, TOOL_HOST_SERVER_NAME);
        assert_eq!(definition.tools.len(), 2);
        assert_eq!(definition.tools[0].name, "add");
        assert!(definition.tools[0].handler.contains("args.a"));
        assert_eq!(definition.tools[1].name, "counter");
        assert!(definition.tools[1].handler.contains("state.count"));

        let raw: serde_json::Value = serde_json::from_str(&config.definition).unwrap();
        assert!(raw["tools"][0].get("inputSchema").is_some());
        assert!(raw["tools"][0].get("input_schema").is_none());
    }

    #[test]
    fn disabled_functions_are_left_out_of_the_host() {
        let mut off = default_compiled_function();
        off.enabled = false;
        let config = tool_host_server_config(&[add_fn(), off])
            .unwrap()
            .expect("one enabled function remains");
        let definition = McpServerDefinition::parse(&config.definition).unwrap();
        assert_eq!(definition.tools.len(), 1);
        assert_eq!(definition.tools[0].name, "add");
    }

    #[test]
    fn empty_schema_text_defaults_to_an_open_object() {
        let function = default_compiled_function();
        assert!(function.input_schema.is_empty());
        let config = tool_host_server_config(&[function]).unwrap().unwrap();
        let definition = McpServerDefinition::parse(&config.definition).unwrap();
        assert_eq!(definition.tools[0].input_schema["type"], "object");
    }

    #[test]
    fn invalid_schema_text_is_an_error_naming_the_function() {
        let mut function = add_fn();
        function.input_schema = "{ not json".to_string();
        let err = tool_host_server_config(&[function]).expect_err("invalid schema rejected");
        assert!(err.contains("add"), "error must name the function: {err}");

        let mut function = add_fn();
        function.input_schema = "[1, 2]".to_string();
        let err = tool_host_server_config(&[function]).expect_err("non-object schema rejected");
        assert!(err.contains("JSON object"), "got: {err}");
    }

    #[test]
    fn unnamed_and_duplicate_functions_are_rejected() {
        let mut unnamed = add_fn();
        unnamed.name = "   ".to_string();
        assert!(tool_host_server_config(&[unnamed]).is_err());

        let twin_a = add_fn();
        let mut twin_b = default_compiled_function();
        twin_b.name = "add".to_string();
        let err = tool_host_server_config(&[twin_a, twin_b]).expect_err("duplicate rejected");
        assert!(err.contains("add"), "error must name the duplicate: {err}");
    }

    #[test]
    fn editing_a_function_changes_the_definition() {
        // The MCP runtime fingerprints `definition`; an edited body must change it so
        // the live worker (and its state) is replaced rather than silently reused.
        let function = add_fn();
        let before = tool_host_server_config(std::slice::from_ref(&function))
            .unwrap()
            .unwrap();
        let mut edited = function;
        edited.body = "return 'changed';".to_string();
        let after = tool_host_server_config(&[edited]).unwrap().unwrap();
        assert_ne!(before.definition, after.definition);
    }
}
