//! Two small pure helpers the user's layer needs: merging one override patch
//! into the stored document, and stamping the resolved model id onto the
//! core's request body. Their own file so `endpoint.rs` stays inside the
//! 200-line rule (I12).

use serde_json::{json, Map, Value};

/// Merge one patch document into the stored overrides, entry by entry, so
/// editing one catalogue entry never drops what was saved for another.
fn merge_overrides(into: &mut Value, patch: &Value) {
    let (Some(dst), Some(src)) = (
        into.get_mut("models").and_then(Value::as_object_mut),
        patch.get("models").and_then(Value::as_object),
    ) else {
        *into = patch.clone();
        return;
    };
    for (name, fields) in src {
        let slot = dst
            .entry(name.clone())
            .or_insert_with(|| Value::Object(Default::default()));
        match (slot.as_object_mut(), fields.as_object()) {
            (Some(existing), Some(new)) => existing.extend(new.clone()),
            _ => *slot = fields.clone(),
        }
    }
}

/// Write (or CLEAR) one entry's override slot. Clearing on an empty patch is
/// what makes a later `models.json` edit reach a user who once pressed Save:
/// an entry with no override left follows the shipped file again.
pub(crate) fn pin(overrides: &mut Value, name: &str, fields: Map<String, Value>) {
    if fields.is_empty() {
        if let Some(models) = overrides.get_mut("models").and_then(Value::as_object_mut) {
            models.remove(name);
        }
        return;
    }
    let patch = json!({"models": {name: Value::Object(fields)}});
    match overrides.as_object_mut() {
        Some(_) => merge_overrides(overrides, &patch),
        None => *overrides = patch,
    }
}

/// Stamp the entry's model id into the core's request body. The core speaks
/// the symbolic catalogue key; the concrete model id is the adapter's job,
/// like a credential.
pub fn stamp_model(body_json: &str, model: &str) -> String {
    if model.is_empty() {
        return body_json.to_string();
    }
    serde_json::from_str::<Value>(body_json)
        .map(|mut v| {
            v["model"] = Value::String(model.to_string());
            v.to_string()
        })
        .unwrap_or_else(|_| body_json.to_string())
}
