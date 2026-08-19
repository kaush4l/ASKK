//! The stored record: the user's layer written down and read back, including
//! every migration of an older one. This is the ONE shape a Worker is handed
//! at boot (`workers::spawn`), which makes it the place a new setting belongs
//! if every agent is to see it.
//!
//! A child module, not a sibling: it writes `Endpoint`'s private fields, and
//! the alternative — making `keys` visible to the whole crate — would open the
//! keyring to every file in the adapter to save one line of plumbing.

use serde_json::{json, Value};

use super::Endpoint;

impl Endpoint {
    /// The stored record — the one place the keys are serialized.
    pub fn profile_json(&self) -> String {
        json!({
            "selected": self.selected,
            "keys": Value::Object(self.keys.clone()),
            "overrides": self.overrides,
            "search": self.search,
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
        // Absent in every record written before increment 21, which is the
        // shipped state and the refusing one — a browser that never chose a
        // search endpoint must not inherit one from an upgrade.
        self.search = s("search").trim().to_string();
        if let Some(k) = v.get("keys").and_then(Value::as_object) {
            self.keys = k.clone();
        }
        if let Some(o) = v.get("overrides").filter(|o| o.is_object()) {
            self.overrides = o.clone();
        }
        // A record from before keys were per entry carried ONE key. It goes to
        // the entry it was last used with — the pick, or the default it
        // silently was — rather than being dropped or, worse, kept for all.
        let legacy_key = s("api_key").trim().to_string();
        if !legacy_key.is_empty() {
            self.keys.insert(self.current(), Value::String(legacy_key));
        }
        let legacy = s("base_url");
        if !legacy.is_empty() {
            self.set(legacy, None, s("model"));
        }
    }
}
