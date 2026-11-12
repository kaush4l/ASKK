//! # Settings: how the service itself runs, in one file a person edits
//!
//! `settings.json` in the data place. Its key is fixed ([`KEY`]), not named by the manifest:
//! it says where the service listens, which is needed before anything is booted. It holds
//! only what is about the running service and is written nowhere else: models, theme, words
//! and layout each have their own file and are not repeated here.
//!
//! ```json
//! {"listen": "127.0.0.1:8090", "origins": [], "look_every_ms": 2000}
//! ```
//!
//! | key | means | an edit takes effect |
//! | --- | --- | --- |
//! | `listen` | the address and port the service answers at | at the next start (`askk restart`); `PORT` and `IP` in the environment win over it |
//! | `origins` | pages at other addresses that may ask this service, beside those in `ASKK_ORIGINS` | at once |
//! | `look_every_ms` | how often the home is looked at for files edited by hand; 0 = only when `reload` is asked | at once |
//! | `keys` | which key does what in `askk terminal`, after which prefix (`core/keys.rs`) | at once, in every `askk terminal` |
//! | `terminal` | how `askk terminal` looks (`theme`, `colours`), tells (`notify`), and which session it opens (`session`): [`Terminal`] | at once, in every `askk terminal` (`session` at its next start) |
//!
//! A key that is not in this table, or a value of the wrong kind, is refused with a sentence
//! and the settings in force are kept: a typing mistake never takes the service down.
use super::held::Held;
use super::store::Store;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Key of the settings file.
pub const KEY: &str = "settings.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    /// The address and port the service answers at.
    pub listen: String,
    /// Pages (by origin, `https://example.org`) that may ask, beside the environment's.
    pub origins: Vec<String>,
    /// Milliseconds between two looks at the home for hand edits; 0 = never by itself.
    pub look_every_ms: u64,
    /// The keys of `askk terminal` (`core/keys.rs`).
    pub keys: super::keys::Keys,
    /// How `askk terminal` looks and tells: its colours, its notifications, its session.
    pub terminal: Terminal,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { listen: "127.0.0.1:8090".into(), origins: vec![], look_every_ms: 2000, keys: Default::default(), terminal: Default::default() }
    }
}

/// The table `terminal` of `settings.json`:
///
/// | key | means | values |
/// | --- | --- | --- |
/// | `theme` | the colours of the sidebar, tabs, frames and the foot, and of a program's 16 base colours | `glass-dark`, `glass-light` (the page's glass palette), `terminal` (the outer terminal's own) |
/// | `colours` | how a colour is sent | `truecolor`, or `256` for a terminal that has only those |
/// | `notify` | how a box that comes to wait for the owner, or ends, while it is not shown is told | `bell`, `osc9`, `osc777`, with a space between them; `off` |
/// | `session` | the named session a window opens when none is said (`askk terminal --session <name>`) | empty: the one without a name |
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Terminal {
    pub theme: String,
    pub colours: String,
    pub notify: String,
    pub session: String,
}

impl Default for Terminal {
    fn default() -> Self {
        Terminal { theme: "glass-dark".into(), colours: "truecolor".into(), notify: "bell osc9".into(), session: String::new() }
    }
}

/// The themes `askk terminal` has.
pub const THEMES: [&str; 3] = ["glass-dark", "glass-light", "terminal"];
/// The ways it can tell.
pub const TELLS: [&str; 3] = ["bell", "osc9", "osc777"];

impl Terminal {
    /// Whether the table can be used, or the sentence why not.
    pub fn check(&self) -> Result<(), String> {
        if !THEMES.contains(&self.theme.as_str()) {
            return Err(format!("`terminal.theme` is one of {} (found '{}')", THEMES.join(", "), self.theme));
        }
        if self.colours != "truecolor" && self.colours != "256" {
            return Err(format!("`terminal.colours` is truecolor or 256 (found '{}')", self.colours));
        }
        if self.notify.trim() != "off" {
            if let Some(w) = self.notify.split_whitespace().find(|w| !TELLS.contains(w)) {
                return Err(format!("`terminal.notify` is off, or some of {} with a space between (found '{w}')", TELLS.join(", ")));
            }
        }
        super::terminals::session_key(&self.session).map(|_| ()).map_err(|e| format!("`terminal.session`: {e}"))
    }

    /// Whether it tells in this way (`bell`, `osc9`, `osc777`).
    pub fn tells(&self, how: &str) -> bool {
        self.notify.split_whitespace().any(|w| w == how)
    }
}

/// The shortest time between two looks: looking more often costs work and shows nothing sooner.
pub const QUICKEST_MS: u64 = 200;

impl Settings {
    /// The settings written in `store`; the defaults when the file is not there yet.
    pub fn read(store: &dyn Store) -> Result<Settings, String> {
        let key = KEY;
        let Some(text) = store.get(key) else { return Ok(Settings::default()) };
        let s: Settings = serde_json::from_str(&text).map_err(|e| format!("{key}: {e}"))?;
        if s.listen.parse::<std::net::SocketAddr>().is_err() {
            return Err(format!("{key}: `listen` must be an address and a port, like 127.0.0.1:8090 (found '{}')", s.listen));
        }
        if s.look_every_ms != 0 && s.look_every_ms < QUICKEST_MS {
            return Err(format!("{key}: `look_every_ms` must be 0 (never) or at least {QUICKEST_MS} (found {})", s.look_every_ms));
        }
        s.keys.bound().map_err(|e| format!("{key}: {e}"))?;
        s.terminal.check().map_err(|e| format!("{key}: {e}"))?;
        Ok(s)
    }
}

/// The settings in force; `None` until they are first asked for.
static NOW: Mutex<Option<Settings>> = Mutex::new(None);

/// The settings in force. Read from the data store at first use; a file that cannot be read
/// is said once and the defaults are used.
pub fn settings() -> Settings {
    let mut now = NOW.held();
    if now.is_none() {
        *now = Some(Settings::read(&*super::store::data()).unwrap_or_else(|e| {
            eprintln!("askk: {e}; the built-in settings are used");
            Settings::default()
        }));
    }
    now.clone().unwrap_or_default()
}

/// What reading the file again did: what is in force now, and what waits for a restart.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Taken {
    pub in_force: Vec<String>,
    pub needs_restart: Vec<String>,
}

/// Read the file again and put it in force. A file that cannot be read changes nothing and
/// the reason is returned.
pub fn take(store: &dyn Store) -> Result<Taken, String> {
    let new = Settings::read(store)?;
    let old = settings();
    let key = KEY;
    let mut out = Taken::default();
    if new.origins != old.origins {
        let who = if new.origins.is_empty() { "no page at another address".to_string() } else { new.origins.join(", ") };
        out.in_force.push(format!("{key}: `origins`: {who} may ask, from now on"));
    }
    if new.look_every_ms != old.look_every_ms {
        out.in_force.push(match new.look_every_ms {
            0 => format!("{key}: `look_every_ms`: the home is looked at only when `reload` is asked"),
            ms => format!("{key}: `look_every_ms`: the home is looked at every {ms} ms"),
        });
    }
    if new.keys != old.keys {
        out.in_force.push(format!("{key}: `keys`: every `askk terminal` uses them from now on"));
    }
    if new.terminal != old.terminal {
        out.in_force.push(format!("{key}: `terminal`: every `askk terminal` looks and tells as it says from now on"));
    }
    if new.listen != old.listen {
        out.needs_restart.push(format!("{key}: `listen` is now {}, but a running service cannot move: it answers there after `askk restart`", new.listen));
    }
    *NOW.held() = Some(new);
    Ok(out)
}

/// Every page that may ask this service from a browser: the ones the environment names
/// (`core/places.rs`) and the ones in the settings. None by default.
pub fn origins() -> Vec<String> {
    let mut all = super::places::origins();
    all.extend(settings().origins.iter().map(|o| o.trim().trim_end_matches('/').to_string()).filter(|o| !o.is_empty()));
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::store::Bundle;

    fn with(text: &str) -> Bundle {
        Bundle::memory([("settings.json".to_string(), text.to_string())].into())
    }

    #[test]
    fn a_missing_file_is_the_defaults_and_a_wrong_one_is_refused_in_a_sentence() {
        assert_eq!(Settings::read(&Bundle::memory(Default::default())).unwrap(), Settings::default());
        assert_eq!(Settings::read(&with(r#"{"origins": ["https://a.example"]}"#)).unwrap().listen, "127.0.0.1:8090", "a key left out keeps its default");
        let unknown = Settings::read(&with(r#"{"lissten": "x"}"#)).unwrap_err();
        assert!(unknown.starts_with("settings.json: unknown field `lissten`"), "{unknown}");
        assert!(Settings::read(&with(r#"{"listen": "8090"}"#)).unwrap_err().contains("like 127.0.0.1:8090"));
        assert!(Settings::read(&with(r#"{"look_every_ms": 5}"#)).unwrap_err().contains("at least 200"));
        assert_eq!(Settings::read(&with(r#"{"keys": {"prefix": "ctrl+a"}}"#)).unwrap().keys.split_right, "v %", "a key left out of the table keeps its default");
        assert!(Settings::read(&with(r#"{"keys": {"splt": "v"}}"#)).unwrap_err().contains("unknown field `splt`"));
        assert_eq!(Settings::read(&with(r#"{"keys": {"zoom": "v"}}"#)).unwrap_err(), "settings.json: `keys.zoom`: 'v' already does `split_right`: one key does one thing");
        let t = Settings::read(&with(r#"{"terminal": {"theme": "glass-light", "notify": "off"}}"#)).unwrap().terminal;
        assert_eq!((t.theme.as_str(), t.colours.as_str(), t.tells("bell")), ("glass-light", "truecolor", false));
        assert!(Settings::read(&with(r#"{"terminal": {"theme": "pink"}}"#)).unwrap_err().contains("`terminal.theme` is one of glass-dark, glass-light, terminal"));
        assert!(Settings::read(&with(r#"{"terminal": {"notify": "bell siren"}}"#)).unwrap_err().contains("(found 'siren')"));
        assert!(Settings::read(&with(r#"{"terminal": {"colours": "16"}}"#)).is_err());
        assert!(Settings::read(&with(r#"{"terminal": {"session": "My Work"}}"#)).unwrap_err().contains("`terminal.session`"));
        assert!(Terminal::default().tells("osc9") && !Terminal::default().tells("osc777"));
    }

    #[test]
    fn the_shipped_settings_are_the_built_in_ones() {
        let shipped: Settings = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/defaults/settings.json"))).unwrap();
        assert_eq!(shipped, Settings::default(), "defaults/settings.json shows every key with its default");
    }

    #[test]
    fn an_edit_is_put_in_force_and_says_what_waits_for_a_restart() {
        let _ = settings();
        let taken = take(&with(r#"{"listen": "127.0.0.1:9999", "origins": ["https://a.example/"], "look_every_ms": 0}"#)).unwrap();
        assert_eq!(taken.in_force.len(), 2, "{taken:?}");
        assert!(taken.needs_restart[0].contains("askk restart"), "{taken:?}");
        assert!(origins().contains(&"https://a.example".to_string()), "a named page may ask at once");
        assert!(take(&with("{")).is_err(), "a broken file is refused");
        assert_eq!(settings().look_every_ms, 0, "and what was in force is kept");
        take(&Bundle::memory(Default::default())).unwrap();
    }
}
