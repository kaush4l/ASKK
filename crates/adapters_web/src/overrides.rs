//! Two small pure helpers the user's layer needs: merging one override patch
//! into the stored document, and stamping the resolved model id onto the
//! core's request body. Their own file so `endpoint.rs` stays inside the
//! 200-line rule (I12).

use serde_json::Value;

/// Merge one patch document into the stored overrides, entry by entry, so
/// editing one catalogue entry never drops what was saved for another.
pub(crate) fn merge_overrides(into: &mut Value, patch: &Value) {
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
