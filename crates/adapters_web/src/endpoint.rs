//! The user's layer over the catalogue: which entry is selected, what they
//! changed about it, and the one API key. Pure (host-tested): this is where a
//! secret gets lost, and losing one silently is what the tests refuse.
//! `catalogue.rs` owns the rules, `model.rs` owns the wire, this owns choice.

use serde_json::{json, Value};

use kernel::ModelError;

use crate::catalogue::{Catalogue, Entry};

/// The catalogue as shipped, plus the user's persisted layer on it.
///
/// There is no free-standing base URL any more: a URL typed in Settings is an
/// OVERRIDE OF AN ENTRY, stored under that entry's name, so switching entries
/// and switching back does not lose it. `selected` is the user's explicit
/// pick and outranks an agent's `model:` key; empty means "let the agent (or
/// the catalogue's default) decide".
#[derive(Clone, Default)]
pub struct Endpoint {
    file: Catalogue,
    overrides: Value,
    selected: String,
    api_key: String,
}

impl Endpoint {
    /// Install `public/models.json`. The user's layer is unaffected — it is
    /// applied over whatever the file happens to say this deploy.
    pub fn set_catalogue(&mut self, raw: &str) {
        self.file = Catalogue::parse(raw);
    }

    /// The catalogue the app actually uses: the file with the user's layer on
    /// top. Recomputed rather than mutated, so clearing an override reverts to
    /// the shipped value instead of leaving a hole.
    pub fn catalogue(&self) -> Catalogue {
        let mut c = self.file.clone();
        if !self.overrides.is_null() {
            c.overlay(&self.overrides.to_string());
        }
        c
    }

    pub fn names(&self) -> Vec<String> {
        self.catalogue().names()
    }

    /// The entry Settings is editing: the explicit pick, else the default.
    pub fn current(&self) -> String {
        match self.selected.trim() {
            "" => self.catalogue().default_name().to_string(),
            named => named.to_string(),
        }
    }

    pub fn select(&mut self, name: &str) {
        self.selected = name.trim().to_string();
    }

    /// Override the current entry (a user action in Settings). A blank field
    /// means "unchanged" throughout: blank base URL or model falls back to the
    /// shipped entry, and `api_key: None` KEEPS the stored key — the key field
    /// is write-only, so a blank one must never wipe a saved secret.
    pub fn set(&mut self, base_url: &str, api_key: Option<&str>, model: &str) {
        if let Some(key) = api_key {
            self.api_key = key.trim().to_string();
        }
        let name = self.current();
        let patch = json!({"models": {name: {
            "base_url": base_url.trim().trim_end_matches('/'),
            "model": model.trim(),
        }}});
        match self.overrides.as_object_mut() {
            Some(_) => merge_overrides(&mut self.overrides, &patch),
            None => self.overrides = patch,
        }
    }

    /// Which entry answers a call that asked for `asked` (the agent's `model:`
    /// key, as it arrives in the request body). The user's explicit Settings
    /// pick wins; otherwise the catalogue resolves the agent's key.
    pub fn resolve(&self, asked: &str) -> Result<Entry, ModelError> {
        let name = match self.selected.trim() {
            "" => asked.trim(),
            picked => picked,
        };
        self.catalogue()
            .resolve(name)
            .ok_or_else(|| ModelError::EndpointUnknown {
                endpoint: "model".into(),
            })
    }

    /// What Settings shows for the current entry: base URL, whether a key is
    /// saved, model name, and the env var the Python reads — never the key.
    pub fn summary(&self) -> (String, bool, String, String) {
        let e = self.catalogue().resolve(&self.current()).unwrap_or_default();
        (e.base_url, !self.api_key.is_empty(), e.model, e.api_key_env)
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    /// The stored record — the one place the key is serialized.
    pub fn profile_json(&self) -> String {
        json!({
            "selected": self.selected,
            "api_key": self.api_key,
            "overrides": self.overrides,
        })
        .to_string()
    }

    /// Load that record back (boot). An unreadable record leaves the endpoint
    /// on the shipped catalogue rather than failing boot (I15). A record from
    /// before the catalogue existed carried a bare `base_url`: it becomes an
    /// override of the current entry, so nobody's saved endpoint is lost.
    pub fn load_profile(&mut self, raw: &str) {
        let Ok(v) = serde_json::from_str::<Value>(raw) else {
            return;
        };
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default();
        self.selected = s("selected").trim().to_string();
        self.api_key = s("api_key").trim().to_string();
        if let Some(o) = v.get("overrides").filter(|o| o.is_object()) {
            self.overrides = o.clone();
        }
        let legacy = s("base_url");
        if !legacy.is_empty() {
            self.set(legacy, None, s("model"));
        }
    }
}

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
