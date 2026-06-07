//! The verification-critic contract. Parsed by the (currently dormant) critic path
//! in `inference`; kept ready for the verification loop, so the whole module is
//! allowed to be unused.
#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ResponseField, StructuredResponse, list_field, string_field};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationCriticResponse {
    pub passed: bool,
    pub reason: String,
    pub required_changes: Vec<String>,
}

impl StructuredResponse for VerificationCriticResponse {
    fn fields() -> &'static [ResponseField] {
        &[
            ResponseField {
                name: "passed",
                type_name: "boolean",
                description: "true only when the worker result satisfies the goal using the supplied evidence.",
            },
            ResponseField {
                name: "reason",
                type_name: "string",
                description: "One concise explanation of why verification passed or failed.",
            },
            ResponseField {
                name: "required_changes",
                type_name: "list",
                description: "Concrete changes needed if failed. Use [] when passed.",
            },
        ]
    }

    fn from_fields(fields: BTreeMap<String, Value>, raw: &str) -> Self {
        let reason = string_field(&fields, "reason");
        let required_changes = list_field(&fields, "required_changes");
        Self {
            passed: bool_field(&fields, "passed"),
            reason: if reason.trim().is_empty() {
                raw.trim().to_string()
            } else {
                reason
            },
            required_changes,
        }
    }
}

fn bool_field(fields: &BTreeMap<String, Value>, key: &str) -> bool {
    match fields.get(key) {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(text)) => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "true" | "yes" | "pass" | "passed"
        ),
        Some(Value::Number(number)) => number.as_u64().is_some_and(|value| value > 0),
        _ => false,
    }
}
