//! The model catalogue — `public/models.json`, read as data, keyed by NAME.
//!
//! Ported from the Python `core/inference.py`, whose central decision carries
//! over whole: there is no provider table. Nearly every server speaks the
//! OpenAI protocol and differs only in its `base_url`, so a provider name
//! bought nothing but a place to hardcode a URL. What is left is a catalogue
//! of named entries and, on each, the wire protocol it speaks.
//!
//! Pure (no browser, host-tested — I3): this is the rule set, `endpoint.rs`
//! holds the user's layer on top of it and `model.rs` puts bytes on the wire.

use serde_json::{Map, Value};

use kernel::ModelError;

/// One catalogue entry, in the Python file's own five keys. `api_key_env`
/// names an environment variable there; a browser has no environment, so it
/// is carried for parity and shown in Settings as "what to paste here".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Entry {
    /// The catalogue key this came from — not the model id.
    pub name: String,
    pub model: String,
    pub base_url: String,
    pub api: String,
    pub kind: String,
    pub api_key_env: String,
    /// What the file says about this entry, shown where the entry is picked.
    /// It has been in `models.json` since the catalogue landed and nothing
    /// read it; the on-device entry needs it, because what that one COSTS —
    /// a download the browser performs — has to be readable before a turn.
    pub note: String,
}

impl Entry {
    fn from_json(name: &str, v: &Value) -> Entry {
        let s = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string()
        };
        Entry {
            name: name.to_string(),
            model: s("model"),
            base_url: s("base_url").trim_end_matches('/').to_string(),
            api: s("api"),
            kind: s("kind"),
            api_key_env: s("api_key_env"),
            note: s("note"),
        }
    }

    /// Whether this entry is the browser's own model rather than a server.
    /// Every caller that would otherwise reach for a URL asks this first —
    /// there is no address, no key and no `fetch` on that path.
    pub fn is_on_device(&self) -> bool {
        self.kind == crate::ondevice::NAME
    }

    /// The URL one chat turn POSTs to — or the typed reason this entry cannot
    /// serve one. The Python has three transports; this build has the OpenAI
    /// chat-completions one, and says so rather than sending its bytes at a
    /// server that speaks something else.
    pub fn chat_url(&self) -> Result<String, ModelError> {
        // There is no URL for the browser's own model, and saying so as
        // "unsupported wire protocol" below would be a false claim about a
        // protocol. Callers branch on `is_on_device` before asking.
        if self.is_on_device() {
            return Err(ModelError::OnDevice {
                detail: "this entry has no address: it is your browser's own model, and a turn \
                         to it never leaves this machine"
                    .into(),
            });
        }
        if self.base_url.is_empty() {
            return Err(ModelError::EndpointUnknown {
                endpoint: format!("{} (the catalogue entry has no base_url)", self.name),
            });
        }
        match (self.kind.as_str(), self.api.as_str()) {
            ("" | "openai", "" | "completions") => Ok(format!("{}/chat/completions", self.base_url)),
            (kind, api) => Err(ModelError::Unsupported {
                detail: format!(
                    "catalogue entry '{}' speaks kind '{}' / api '{}'; this build speaks the \
                     OpenAI chat-completions protocol only",
                    self.name,
                    if kind.is_empty() { "openai" } else { kind },
                    if api.is_empty() { "completions" } else { api },
                ),
            }),
        }
    }
}

/// The catalogue: named entries and which one is the default.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Catalogue {
    default: String,
    models: Map<String, Value>,
}

impl Catalogue {
    /// Read one catalogue document. Junk yields an EMPTY catalogue, never a
    /// panic: an unreadable file costs the catalogue, not the page.
    pub fn parse(raw: &str) -> Catalogue {
        let mut c = Catalogue::default();
        c.overlay(raw);
        c
    }

    /// Layer a document of the same shape on top of this one, field by field
    /// — this is how the user's IndexedDB overrides ride on the shipped file.
    /// A blank value means "unchanged" (the same rule the API-key field has),
    /// so an emptied Settings box falls back to what the file said.
    pub fn overlay(&mut self, raw: &str) {
        let Ok(v) = serde_json::from_str::<Value>(raw) else {
            return;
        };
        if let Some(d) = v.get("default").and_then(Value::as_str) {
            if !d.trim().is_empty() {
                self.default = d.trim().to_string();
            }
        }
        let Some(models) = v.get("models").and_then(Value::as_object) else {
            return;
        };
        for (name, patch) in models {
            let Some(src) = patch.as_object() else { continue };
            let entry = self
                .models
                .entry(name.clone())
                .or_insert_with(|| Value::Object(Map::new()));
            let Some(dst) = entry.as_object_mut() else {
                continue;
            };
            for (key, value) in src {
                if value.as_str().is_some_and(|s| s.trim().is_empty()) {
                    continue;
                }
                dst.insert(key.clone(), value.clone());
            }
        }
    }

    pub fn default_name(&self) -> &str {
        &self.default
    }

    /// Every entry name, sorted (`serde_json::Map` is a BTreeMap), so the
    /// Settings list is deterministic.
    pub fn names(&self) -> Vec<String> {
        self.models.keys().cloned().collect()
    }

    pub fn is_empty(&self) -> bool {
        self.models.is_empty()
    }

    /// The Python `get_inference(name)` rule, whole:
    ///
    /// - an empty name is the catalogue's `default` entry;
    /// - a name that IS a key is that entry;
    /// - a name that is NOT a key is a **model id served by the default
    ///   entry's endpoint** — so `model: local` in an `agent.md` is a
    ///   catalogue key, and an arbitrary model id still works.
    ///
    /// `None` only when there is no such entry and no usable default.
    pub fn resolve(&self, name: &str) -> Option<Entry> {
        let key = match name.trim() {
            "" => self.default.trim(),
            named => named,
        };
        let mut entry = match self.models.get(key) {
            Some(v) => Entry::from_json(key, v),
            None => {
                let mut fallback =
                    Entry::from_json(&self.default, self.models.get(self.default.trim())?);
                fallback.model = key.to_string();
                fallback
            }
        };
        if entry.model.is_empty() {
            entry.model = key.to_string();
        }
        Some(entry)
    }
}
