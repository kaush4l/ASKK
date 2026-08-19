//! Writing the user's layer over the catalogue: what one Save changes about
//! one entry, and what it must leave alone. The awkward case is the whole
//! file — an override patch merges ENTRY BY ENTRY, because editing
//! `openrouter` must not drop what was saved for `local`.

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
