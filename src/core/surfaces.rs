//! # Surfaces: what each face of a shell shows
//!
//! A shell has a fixed set of faces, each one file under `shells/` (window, tray, dock, notch).
//! That set is code. What a face shows is a value in `surfaces.json` (manifest key `surfaces`):
//! which page, which live number, how big. An unknown field or number is refused when read, so
//! a typo is an error at the door and not a silent default.
//!
//! ```json
//! {"window": {"title": "askk", "page": "/", "width": 1280, "height": 820},
//!  "tray":   {"on": true, "number": "running", "items": [{"label": "Open", "page": "/"}]},
//!  "dock":   {"badge": "waiting"},
//!  "notch":  {"on": true, "place": "under", "page": "/notch", "width": 360, "height": 34},
//!  "companion": {"on": true, "place": "bottom-right", "size": 96, "engine": "askk",
//!                "bubble": {"width": 380, "height": 520}}}
//! ```
use serde::{Deserialize, Serialize};

/// A live number a face can carry.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Number {
    #[default]
    None,
    /// Unseen messages across every engine's inbox.
    Waiting,
    /// Engines that are not idle.
    Running,
}

/// The live numbers, counted by the host (`api::glance`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Glance {
    pub waiting: usize,
    pub running: usize,
}

impl Glance {
    /// The number as a face shows it; nothing when it is zero or the face carries none.
    #[cfg_attr(not(feature = "desktop"), allow(dead_code))]
    pub fn text(&self, n: Number) -> Option<String> {
        let v = match n {
            Number::None => 0,
            Number::Waiting => self.waiting,
            Number::Running => self.running,
        };
        (v > 0).then(|| v.to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Window {
    pub title: String,
    /// The page it opens on.
    pub page: String,
    pub width: u32,
    pub height: u32,
}

impl Default for Window {
    fn default() -> Self {
        Window { title: "askk".into(), page: "/".into(), width: 1280, height: 820 }
    }
}

/// One line of the tray menu: opens the window on `page`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub label: String,
    pub page: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Tray {
    pub on: bool,
    /// Shown beside the icon in the menu bar.
    pub number: Number,
    pub items: Vec<Item>,
}

impl Default for Tray {
    fn default() -> Self {
        let item = |l: &str, p: &str| Item { label: l.into(), page: p.into() };
        Tray { on: true, number: Number::Running, items: vec![item("Open", "/"), item("Asks", "/asks")] }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Dock {
    /// Shown as the badge on the Dock icon.
    pub badge: Number,
}

impl Default for Dock {
    fn default() -> Self {
        Dock { badge: Number::Waiting }
    }
}

/// Where the notch panel sits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    /// Just below the menu bar, under the notch. Hides nothing in the menu bar.
    #[default]
    Under,
    /// At the very top, over the menu bar. Covers whatever sits beside the notch within its
    /// width: app menus on the left, the newest tray icons on the right.
    On,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Notch {
    pub on: bool,
    pub place: Place,
    /// The page drawn in the panel, without the window's sidebar and top bar.
    pub page: String,
    pub width: u32,
    pub height: u32,
}

impl Default for Notch {
    fn default() -> Self {
        Notch { on: true, place: Place::Under, page: "/notch".into(), width: 360, height: 34 }
    }
}

/// The screen corner the companion sits in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Corner {
    #[default]
    BottomRight,
    BottomLeft,
    TopRight,
    TopLeft,
}

impl Corner {
    /// The word as written in the file (also the drawing's class in a page).
    pub fn name(self) -> &'static str {
        match self {
            Corner::BottomRight => "bottom-right",
            Corner::BottomLeft => "bottom-left",
            Corner::TopRight => "top-right",
            Corner::TopLeft => "top-left",
        }
    }
}

/// The chat panel the companion opens.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Bubble {
    pub width: u32,
    pub height: u32,
}

impl Default for Bubble {
    fn default() -> Self {
        Bubble { width: 380, height: 520 }
    }
}

/// The companion: a small character whose mood follows the engines (`core/companion.rs`) and
/// that opens a chat bubble. On the Mac it is its own window; elsewhere it sits in the page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Companion {
    pub on: bool,
    pub place: Corner,
    /// The character's edge, in points.
    pub size: u32,
    /// The engine the bubble talks to.
    pub engine: String,
    pub bubble: Bubble,
}

impl Default for Companion {
    fn default() -> Self {
        Companion { on: true, place: Corner::BottomRight, size: 96, engine: "askk".into(), bubble: Bubble::default() }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Surfaces {
    pub window: Window,
    pub tray: Tray,
    pub dock: Dock,
    pub notch: Notch,
    pub companion: Companion,
}

impl Surfaces {
    /// Parse and check `surfaces.json`.
    pub fn read(text: &str) -> Result<Surfaces, String> {
        let s: Surfaces = serde_json::from_str(text).map_err(|e| e.to_string())?;
        s.validate()?;
        Ok(s)
    }

    /// Every page is a path; every size is one a screen can hold.
    pub fn validate(&self) -> Result<(), String> {
        let page = |face: &str, p: &str| if p.starts_with('/') { Ok(()) } else { Err(format!("{face}: page '{p}' must start with /")) };
        let size = |face: &str, v: u32, lo: u32, hi: u32| if (lo..=hi).contains(&v) { Ok(()) } else { Err(format!("{face}: {v} is outside {lo}..={hi}")) };
        page("window", &self.window.page)?;
        size("window.width", self.window.width, 480, 7680)?;
        size("window.height", self.window.height, 320, 4320)?;
        page("notch", &self.notch.page)?;
        size("notch.width", self.notch.width, 120, 1200)?;
        size("notch.height", self.notch.height, 20, 400)?;
        size("companion.size", self.companion.size, 48, 256)?;
        size("companion.bubble.width", self.companion.bubble.width, 280, 640)?;
        size("companion.bubble.height", self.companion.bubble.height, 320, 900)?;
        let engine = &self.companion.engine;
        if engine.split('/').any(|s| s.is_empty() || s == "." || s == "..") {
            return Err(format!("companion: engine '{engine}' is not an engine path"));
        }
        self.tray.items.iter().try_for_each(|i| page("tray", &i.page))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_surfaces_are_the_defaults() {
        let t = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/defaults/surfaces.json")).unwrap();
        assert_eq!(Surfaces::read(&t).unwrap(), Surfaces::default());
    }

    #[test]
    fn a_partial_file_keeps_defaults_and_a_typo_is_refused() {
        let s = Surfaces::read(r#"{"dock": {"badge": "running"}}"#).unwrap();
        assert_eq!((s.dock.badge, s.tray.number), (Number::Running, Number::Running));
        assert!(Surfaces::read(r#"{"dock": {"bage": "running"}}"#).unwrap_err().contains("unknown field"));
        assert!(Surfaces::read(r#"{"dock": {"badge": "loud"}}"#).unwrap_err().contains("unknown variant"));
        assert!(Surfaces::read(r#"{"notch": {"page": "notch"}}"#).unwrap_err().contains("must start with /"));
        assert!(Surfaces::read(r#"{"notch": {"height": 4000}}"#).unwrap_err().contains("outside"));
        assert_eq!(Surfaces::read(r#"{"notch": {"place": "on"}}"#).unwrap().notch.place, Place::On);
        assert!(Surfaces::read(r#"{"notch": {"place": "left"}}"#).unwrap_err().contains("unknown variant"));
    }

    #[test]
    fn the_companion_takes_its_defaults_and_refuses_what_no_screen_can_hold() {
        // A file written before the companion existed has no such key: it takes the default.
        let old = Surfaces::read(r#"{"dock": {"badge": "running"}}"#).unwrap();
        assert_eq!(old.companion, Companion::default());
        let s = Surfaces::read(r#"{"companion": {"place": "top-left", "bubble": {"width": 300}}}"#).unwrap();
        assert_eq!((s.companion.place, s.companion.bubble.width, s.companion.bubble.height, s.companion.on), (Corner::TopLeft, 300, 520, true));
        assert_eq!(Corner::TopLeft.name(), "top-left");
        assert!(Surfaces::read(r#"{"companion": {"sise": 96}}"#).unwrap_err().contains("unknown field"));
        assert!(Surfaces::read(r#"{"companion": {"place": "middle"}}"#).unwrap_err().contains("unknown variant"));
        assert!(Surfaces::read(r#"{"companion": {"size": 9000}}"#).unwrap_err().contains("outside"));
        assert!(Surfaces::read(r#"{"companion": {"bubble": {"height": 10}}}"#).unwrap_err().contains("outside"));
        for bad in ["../x", "", "a//b", "./a"] {
            let text = format!(r#"{{"companion": {{"engine": "{bad}"}}}}"#);
            assert!(Surfaces::read(&text).unwrap_err().contains("not an engine path"), "{bad}");
        }
        assert_eq!(Surfaces::read(r#"{"companion": {"engine": "askk/designer"}}"#).unwrap().companion.engine, "askk/designer");
    }

    #[test]
    fn a_number_shows_only_when_it_is_not_zero() {
        let g = Glance { waiting: 3, running: 0 };
        assert_eq!((g.text(Number::Waiting), g.text(Number::Running), g.text(Number::None)), (Some("3".into()), None, None));
    }
}
