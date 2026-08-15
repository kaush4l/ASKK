//! The user's layer over the catalogue: which entry is selected, what they
//! changed about it, and ONE API KEY PER ENTRY. Pure (host-tested): this is
//! where a secret gets lost — or sent to the wrong origin — and both are what
//! the tests refuse.
//! `catalogue.rs` owns the rules, `model.rs` owns the wire, this owns choice.

use serde_json::{Map, Value};

use kernel::ModelError;

use crate::catalogue::{Catalogue, Entry};
use crate::overrides::pin;

mod profile;

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
    /// Entry name → that entry's key. One key per entry, never one key for
    /// the catalogue: `openrouter`'s key must not travel to `api.openai.com`,
    /// to `api.anthropic.com`, or to `127.0.0.1` (`ux-walker`, increment 04).
    keys: Map<String, Value>,
    /// The base URL of the web-search endpoint, or empty. It lives in THIS
    /// record — beside the model endpoint and under the same key — because
    /// this record is what every sub-agent's Worker is handed at boot; a
    /// setting kept anywhere else would be a capability the page had and half
    /// the roster did not. It is not a credential and there is no key field
    /// for it: a public JSON endpoint is the only kind that can be called.
    search: String,
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
    /// is write-only, so a blank one must never wipe a saved secret. The key
    /// is stored against THIS entry only.
    pub fn set(&mut self, base_url: &str, api_key: Option<&str>, model: &str) {
        let name = self.current();
        match api_key.map(str::trim) {
            Some("") => {
                self.keys.remove(&name);
            }
            Some(key) => {
                self.keys.insert(name.clone(), Value::String(key.to_string()));
            }
            None => {}
        }
        // A field equal to what the FILE says is not an override, it is
        // agreement — and storing it pins this browser to today's models.json
        // forever. The fields are pre-filled from the entry, so before this
        // every Save pinned every field and "blank uses this entry's own" was
        // unreachable (`ux-walker`, increment 05). Blank still means the same
        // thing; matching the file now means it too.
        let shipped = self.file.resolve(&name).unwrap_or_default();
        let keep = |typed: &str, own: &str| -> Option<String> {
            let typed = typed.trim().trim_end_matches('/').to_string();
            match typed.is_empty() || typed == own.trim_end_matches('/') {
                true => None,
                false => Some(typed),
            }
        };
        let mut fields = Map::new();
        if let Some(url) = keep(base_url, &shipped.base_url) {
            fields.insert("base_url".into(), Value::String(url));
        }
        if let Some(m) = keep(model, &shipped.model) {
            fields.insert("model".into(), Value::String(m));
        }
        pin(&mut self.overrides, &name, fields);
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
        let has_key = self.has_key(&self.current());
        (e.base_url, has_key, e.model, e.api_key_env)
    }

    /// The key for ONE named entry — the only way to read a key out, so a
    /// caller physically cannot attach entry A's key to entry B's request.
    pub fn api_key_for(&self, entry: &str) -> &str {
        self.keys.get(entry).and_then(Value::as_str).unwrap_or("")
    }

    pub fn has_key(&self, entry: &str) -> bool {
        !self.api_key_for(entry).is_empty()
    }

    /// The key of the entry Settings is editing.
    pub fn api_key(&self) -> &str {
        self.keys
            .get(&self.current())
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    /// Where a web search goes, and nowhere else: the ALLOWLIST is built from
    /// this string, so an empty one is an empty list and `web_search` refuses
    /// in words (CLAUDE.md §17 makes the destination a user's choice, not a
    /// constant this build ships).
    pub fn set_search(&mut self, base_url: &str) {
        self.search = base_url.trim().trim_end_matches('/').to_string();
    }

    pub fn search(&self) -> &str {
        &self.search
    }

    /// Back to the shipped catalogue: forget the pick, the overrides and every
    /// saved key. Without this the first Save is permanent — the walker had to
    /// delete the IndexedDB database to get back to the default (increment 04).
    pub fn reset(&mut self) {
        self.selected = String::new();
        self.overrides = Value::Null;
        self.keys = Map::new();
        self.search = String::new();
    }
}
