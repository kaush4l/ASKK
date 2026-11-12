//! # Manifest: what the world is made of, and where each part lives
//!
//! `askk.json` at the root of a store names the key of every kind of domain object. Boot reads
//! it first and initialises exactly what it names; no module spells a key of its own. A field
//! left out keeps its default, so a store without `askk.json` boots as it always did.
//!
//! ```json
//! {"engines": "engines", "board": "board.json", "routes": "routes", "components": "components",
//!  "models": "models.json", "templates": "templates", "theme": "theme.json", "ui": "ui.json",
//!  "layout": "layout.json", "jobs": "jobs.json", "dismissed": "dismissed",
//!  "surfaces": "surfaces.json", "senses": "senses.json", "sessions": "sessions",
//!  "rooms": "rooms"}
//! ```
//!
//! Three keys are the store's own and fixed in code, because they are needed before the manifest
//! can be read: `askk.json` (this file), `askk.pid` (the one-writer lock, `store::LOCK`) and
//! `settings.json` (how the service runs, read before boot: `settings::KEY`).
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Key of the manifest itself.
pub const KEY: &str = "askk.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Manifest {
    /// Engines, one folder each (`<engines>/<name>/engine.json`), sub-engines nested.
    pub engines: String,
    /// Message boxes between engines.
    pub board: String,
    /// Pages (`<routes>/**/page.json`).
    pub routes: String,
    /// Components made by engines or people (`<components>/*.json`).
    pub components: String,
    /// Models and runtimes.
    pub models: String,
    /// Engine shapes `create_engine` copies (`<templates>/<name>/engine.json`).
    pub templates: String,
    pub theme: String,
    pub ui: String,
    pub layout: String,
    /// Spawned jobs (kept across restarts as `lost`).
    pub jobs: String,
    /// Where dismissed engines are kept.
    pub dismissed: String,
    /// What each face of a shell shows (window, tray, dock, notch).
    pub surfaces: String,
    /// How each kind of attached file is sensed (`core/media.rs`).
    pub senses: String,
    /// Conversations with other agents' harnesses, one key each (`core/session.rs`).
    pub sessions: String,
    /// Rooms: several sessions and a person in one setup, one key each (`core/room.rs`).
    pub rooms: String,
    /// How this home runs each kind of harness (`core/session.rs::Setting`).
    pub harnesses: String,
    /// The modes and presets on offer (`core/room.rs::Curation`).
    pub modes: String,
}

impl Default for Manifest {
    fn default() -> Self {
        let s = |x: &str| x.to_string();
        Manifest {
            engines: s("engines"),
            board: s("board.json"),
            routes: s("routes"),
            components: s("components"),
            models: s("models.json"),
            templates: s("templates"),
            theme: s("theme.json"),
            ui: s("ui.json"),
            layout: s("layout.json"),
            jobs: s("jobs.json"),
            dismissed: s("dismissed"),
            surfaces: s("surfaces.json"),
            senses: s("senses.json"),
            sessions: s("sessions"),
            rooms: s("rooms"),
            harnesses: s("harnesses.json"),
            modes: s("modes.json"),
        }
    }
}

impl Manifest {
    /// The manifest in `store` (defaults for anything it leaves out, or if it is absent).
    pub fn read(store: &dyn super::store::Store) -> Result<Manifest, String> {
        match store.get(KEY) {
            Some(t) => serde_json::from_str(&t).map_err(|e| format!("{KEY}: {e}")),
            None => Ok(Manifest::default()),
        }
    }
    /// The store key of the engine at `path` (`askk/market` → `engines/askk/market`).
    pub fn engine(&self, path: &str) -> String {
        super::store::join(&self.engines, path)
    }
}

static M: OnceLock<Manifest> = OnceLock::new();

/// Fix the process manifest (boot does this once, after seeding).
pub fn set(m: Manifest) {
    let _ = M.set(m);
}

/// The process manifest: what boot read; until then, the data store's (or the defaults).
pub fn manifest() -> &'static Manifest {
    M.get_or_init(|| Manifest::read(&*super::store::data()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_partial_manifest_keeps_defaults_for_the_rest() {
        let m: Manifest = serde_json::from_str(r#"{"engines": "agents"}"#).unwrap();
        assert_eq!((m.engines.as_str(), m.board.as_str()), ("agents", "board.json"));
        assert_eq!(m.engine("a/b"), "agents/a/b");
    }

    #[test]
    fn the_shipped_manifest_names_every_part() {
        let t = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/defaults/askk.json")).unwrap();
        let shipped: serde_json::Value = serde_json::from_str(&t).unwrap();
        let all = serde_json::to_value(Manifest::default()).unwrap();
        assert_eq!(shipped, all, "defaults/askk.json lists every field with its default");
    }
}
