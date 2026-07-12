//! Structured response contracts: render format instructions, parse replies.
//! Parse cascade (ADR-002): native tool calls → JSON brace-scan → TOON → repair.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::request::{InferenceReply, ToolCall};
use crate::toolcall::{derive_action, scan_tool_calls, strip_scaffold};
use crate::toon;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputMode {
    Json,
    #[default]
    Toon,
    Text,
}

// deviation: MODELS.md writes `&'static str` for contract/enum names; String is
// used so Element (a closed serializable enum, ADR-001) can derive Deserialize.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FieldKind {
    Str,
    List,
    Enum(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldSpec {
    pub name: String,
    pub kind: FieldKind,
    pub required: bool,
    pub description: String,
    /// Example value for the worked example + repair hint. List fields take
    /// `|`-separated items. None = kind-derived placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
}

impl FieldSpec {
    pub fn new(name: &str, kind: FieldKind, required: bool, description: &str) -> Self {
        Self {
            name: name.into(),
            kind,
            required,
            description: description.into(),
            example: None,
        }
    }

    pub fn with_example(mut self, example: &str) -> Self {
        self.example = Some(example.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Contract {
    pub name: String,
    pub version: u8,
    pub fields: Vec<FieldSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Action {
    Answer(String),
    ToolCalls(Vec<ToolCall>),
}

/// Which rung of the parse cascade produced the response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParsedFormat {
    Native,
    Json,
    Toon,
    Repaired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParsedResponse {
    pub fields: Map<String, Value>,
    pub action: Action,
    pub format: ParsedFormat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParseFailure {
    pub missing: Vec<String>,
    /// Appended as an observation for a bounded repair retry.
    pub repair_prompt: String,
}

impl Contract {
    /// Format instructions, rendered LAST on the sheet.
    pub fn instructions(&self, mode: OutputMode) -> String {
        let mut out = String::from(match mode {
            OutputMode::Json => "Respond with a single JSON object and nothing else.\n",
            OutputMode::Toon => {
                "Respond with exactly one line per field, `field: value`. For list \
                 fields put the field name on its own line (`field:`) followed by one \
                 `- item` line per entry. No prose outside the fields.\n"
            }
            OutputMode::Text => "Respond in plain text.\n",
        });
        out.push_str("Fields:\n");
        for field in &self.fields {
            let need = if field.required {
                "required"
            } else {
                "optional"
            };
            let kind = match &field.kind {
                FieldKind::Str => "text".to_string(),
                FieldKind::List => "list".to_string(),
                FieldKind::Enum(variants) => format!("one of: {}", variants.join(" | ")),
            };
            let _ = writeln!(
                out,
                "- {} ({need}, {kind}): {}",
                field.name, field.description
            );
        }
        self.render_example(mode, &mut out);
        out
    }

    /// One short worked example after the field bullets — weak models copy
    /// shape far better than they follow rules. Text mode renders none.
    fn render_example(&self, mode: OutputMode, out: &mut String) {
        match mode {
            OutputMode::Text => {}
            OutputMode::Toon => {
                out.push_str("Example (shape only):\n");
                for field in &self.fields {
                    let items = example_items(field);
                    if matches!(field.kind, FieldKind::List) {
                        let _ = writeln!(out, "{}:", field.name);
                        for item in items {
                            let _ = writeln!(out, "- {item}");
                        }
                    } else {
                        let _ = writeln!(out, "{}: {}", field.name, items[0]);
                    }
                }
            }
            OutputMode::Json => {
                let mut obj = Map::new();
                for field in &self.fields {
                    let mut items = example_items(field);
                    let value = if matches!(field.kind, FieldKind::List) {
                        Value::Array(items.into_iter().map(Value::String).collect())
                    } else {
                        Value::String(items.remove(0))
                    };
                    obj.insert(field.name.clone(), value);
                }
                let _ = writeln!(out, "Example (shape only):\n{}", Value::Object(obj));
            }
        }
    }

    /// JSON Schema projection, used as the provider-native structured schema.
    pub fn schema(&self) -> Value {
        let mut properties = Map::new();
        let mut required = Vec::new();
        for field in &self.fields {
            let prop = match &field.kind {
                FieldKind::Str => json!({"type": "string", "description": field.description}),
                FieldKind::List => json!({
                    "type": "array", "items": {"type": "string"},
                    "description": field.description
                }),
                FieldKind::Enum(variants) => json!({
                    "type": "string", "enum": variants, "description": field.description
                }),
            };
            properties.insert(field.name.clone(), prop);
            if field.required {
                required.push(Value::String(field.name.clone()));
            }
        }
        json!({"type": "object", "properties": properties, "required": required})
    }

    /// Fallback-answer hygiene: strip this contract's scaffold field lines
    /// (everything except `answer`) from a raw reply before it stands in as
    /// the answer — repairs replay history; scaffold replay wastes context.
    pub fn strip_scaffold(&self, text: &str) -> String {
        let names: Vec<&str> = self.fields.iter().map(|f| f.name.as_str()).collect();
        strip_scaffold(text, &names)
    }

    /// Parse cascade: native tool calls first, then JSON, then TOON, then repair.
    pub fn parse(&self, reply: &InferenceReply) -> Result<ParsedResponse, ParseFailure> {
        if !reply.native_tool_calls.is_empty() {
            // Native calling wins (ADR-002); text fields are best-effort extras.
            let fields = self.best_effort_fields(&reply.text);
            return Ok(ParsedResponse {
                fields,
                action: Action::ToolCalls(reply.native_tool_calls.clone()),
                format: ParsedFormat::Native,
            });
        }
        // A failed JSON rung falls through to TOON: an embedded fragment
        // (e.g. a `calls` item like `{"tool": ...}`) can win the brace scan
        // while the real structure is TOON lines around it.
        let json_failure = match self.json_fields(&reply.text) {
            Some(map) => match self.finish(map, &reply.text, ParsedFormat::Json) {
                Ok(parsed) => return Ok(parsed),
                Err(failure) => Some(failure),
            },
            None => None,
        };
        let map = toon::decode(&reply.text, &self.key_names());
        if !map.is_empty() {
            match self.finish(map, &reply.text, ParsedFormat::Toon) {
                Ok(parsed) => return Ok(parsed),
                Err(failure) => {
                    // Structured parse missed a required field — but if the
                    // reply carries MCP tool calls (the model dropped them on a
                    // bare line instead of under `answer:`), that IS the action.
                    if let Some(parsed) = self.recover_tool_calls(&reply.text) {
                        return Ok(parsed);
                    }
                    return Err(failure);
                }
            }
        }
        if let Some(parsed) = self.recover_tool_calls(&reply.text) {
            return Ok(parsed);
        }
        if let Some(failure) = json_failure {
            return Err(failure);
        }
        // Nothing structured found: coerce defaults; required fields decide.
        self.finish(Map::new(), &reply.text, ParsedFormat::Repaired)
    }

    /// Last-ditch recovery for the react turn: only contracts that carry an
    /// `action` switch accept bare tool calls. Returns a tool-call response
    /// when the raw reply contains at least one, in EITHER shape a model tends
    /// to emit — MCP `{"name","arguments"}` or the natural `toolname: {args}`.
    fn recover_tool_calls(&self, text: &str) -> Option<ParsedResponse> {
        if !self.fields.iter().any(|f| f.name == "action") {
            return None;
        }
        let fields: Vec<&str> = self.fields.iter().map(|f| f.name.as_str()).collect();
        let calls = scan_tool_calls(text, &fields);
        if calls.is_empty() {
            return None;
        }
        Some(ParsedResponse {
            fields: Map::new(),
            action: Action::ToolCalls(calls),
            format: ParsedFormat::Repaired,
        })
    }

    fn key_names(&self) -> Vec<&str> {
        self.fields.iter().map(|f| f.name.as_str()).collect()
    }

    fn best_effort_fields(&self, text: &str) -> Map<String, Value> {
        if let Some(map) = self.json_fields(text) {
            return map;
        }
        toon::decode(text, &self.key_names())
    }

    /// JSON rung guard: the extracted object must carry at least one known
    /// field, otherwise it is an embedded fragment (e.g. an `args` object)
    /// and the cascade falls through to TOON.
    fn json_fields(&self, text: &str) -> Option<Map<String, Value>> {
        match extract_json_object(text).and_then(|s| serde_json::from_str::<Value>(s).ok()) {
            Some(Value::Object(map)) if self.fields.iter().any(|f| map.contains_key(&f.name)) => {
                Some(map)
            }
            _ => None,
        }
    }

    /// Repair/coerce: missing optional → default; missing/invalid required → failure.
    fn finish(
        &self,
        mut raw: Map<String, Value>,
        raw_text: &str,
        format: ParsedFormat,
    ) -> Result<ParsedResponse, ParseFailure> {
        let mut fields = Map::new();
        let mut problems: Vec<&FieldSpec> = Vec::new();
        for spec in &self.fields {
            match raw.remove(&spec.name).and_then(|v| coerce(spec, v)) {
                Some(value) => {
                    fields.insert(spec.name.clone(), value);
                }
                None if spec.required => problems.push(spec),
                None => {
                    if let Some(default) = default_for(&spec.kind) {
                        fields.insert(spec.name.clone(), default);
                    }
                }
            }
        }
        // Keep unknown extras — models add them and they are harmless.
        for (key, value) in raw {
            fields.entry(key).or_insert(value);
        }
        if !problems.is_empty() {
            let names: Vec<String> = problems.iter().map(|s| s.name.clone()).collect();
            let detail: Vec<String> = problems.iter().map(|s| describe(s)).collect();
            return Err(ParseFailure {
                missing: names,
                repair_prompt: format!(
                    "Missing or invalid required field(s): {} — expected e.g. {}. \
                     Reply again with every required field.",
                    detail.join(", "),
                    shape_hint(problems[0]),
                ),
            });
        }
        let action = derive_action(&fields, raw_text);
        Ok(ParsedResponse {
            fields,
            action,
            format,
        })
    }
}

fn describe(spec: &FieldSpec) -> String {
    match &spec.kind {
        FieldKind::Enum(variants) => format!("{} (one of: {})", spec.name, variants.join(" | ")),
        _ => spec.name.clone(),
    }
}

/// Example values for one field: the curated example (lists split on `|`)
/// or a kind-derived placeholder. Never empty.
fn example_items(spec: &FieldSpec) -> Vec<String> {
    if let Some(example) = &spec.example {
        let items: Vec<String> = match spec.kind {
            FieldKind::List => example
                .split('|')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
            _ => vec![example.clone()],
        };
        if !items.is_empty() {
            return items;
        }
    }
    match &spec.kind {
        FieldKind::Str => vec!["text…".into()],
        FieldKind::List => vec!["first item".into()],
        FieldKind::Enum(variants) => vec![variants.first().cloned().unwrap_or_default()],
    }
}

/// One-line shape reminder for the repair prompt.
fn shape_hint(spec: &FieldSpec) -> String {
    match &spec.kind {
        FieldKind::List => format!("`{}:` followed by `- item` lines", spec.name),
        _ => format!("`{}: {}`", spec.name, example_items(spec)[0]),
    }
}

fn default_for(kind: &FieldKind) -> Option<Value> {
    match kind {
        FieldKind::Str => Some(Value::String(String::new())),
        FieldKind::List => Some(Value::Array(Vec::new())),
        FieldKind::Enum(_) => None, // no sane default for an enum
    }
}

fn coerce(spec: &FieldSpec, value: Value) -> Option<Value> {
    match &spec.kind {
        FieldKind::Str => match value {
            Value::String(s) => Some(Value::String(s)),
            Value::Null => None,
            other => Some(Value::String(other.to_string())),
        },
        FieldKind::List => match value {
            Value::Array(items) => Some(Value::Array(
                items
                    .into_iter()
                    .map(|item| match item {
                        Value::String(_) => item,
                        other => Value::String(other.to_string()),
                    })
                    .collect(),
            )),
            Value::String(s) => Some(Value::Array(vec![Value::String(s)])),
            Value::Null => None,
            other => Some(Value::Array(vec![Value::String(other.to_string())])),
        },
        FieldKind::Enum(variants) => {
            let s = value.as_str()?.trim();
            variants
                .iter()
                .find(|v| v.eq_ignore_ascii_case(s))
                .map(|v| Value::String(v.clone()))
        }
    }
}

/// Quote-aware brace scan: extract the first balanced top-level JSON object.
pub fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if escaped {
            escaped = false;
            continue;
        }
        match b {
            b'\\' if in_string => escaped = true,
            b'"' => in_string = !in_string,
            b'{' if !in_string => depth += 1,
            b'}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=i]);
                }
            }
            _ => {}
        }
    }
    None // truncated/unbalanced
}

/// TOON default; three consecutive parse failures escalate to JSON. Success
/// resets the failure streak; escalation is sticky (JSON is safer once TOON failed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatNegotiator {
    mode: OutputMode,
    failures: u32,
    honored: bool,
}

impl FormatNegotiator {
    pub const ESCALATE_AFTER: u32 = 3;

    /// Start at the agent's declared format — honored telemetry is aligned
    /// from turn 1 instead of assuming TOON until an escalation.
    pub fn with_mode(mode: OutputMode) -> Self {
        Self {
            mode,
            failures: 0,
            honored: true,
        }
    }

    pub fn mode(&self) -> OutputMode {
        self.mode
    }

    /// Whether the last reply honored the requested format (per-turn telemetry).
    pub fn honored(&self) -> bool {
        self.honored
    }

    pub fn record_success(&mut self, format: ParsedFormat) {
        self.honored = match (self.mode, format) {
            (_, ParsedFormat::Native) => true,
            (_, ParsedFormat::Repaired) => false,
            (OutputMode::Json, ParsedFormat::Json) | (OutputMode::Toon, ParsedFormat::Toon) => true,
            (OutputMode::Text, _) => true,
            _ => false,
        };
        self.failures = 0;
    }

    pub fn record_failure(&mut self) {
        self.honored = false;
        self.failures += 1;
        if self.failures >= Self::ESCALATE_AFTER {
            self.mode = OutputMode::Json;
        }
    }
}

impl Default for FormatNegotiator {
    fn default() -> Self {
        Self::with_mode(OutputMode::Toon)
    }
}

#[cfg(test)]
#[path = "contract_tests.rs"]
mod tests;
