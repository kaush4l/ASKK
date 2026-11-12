//! # Keys: what a press of the keyboard does, anywhere in a window
//!
//! | press | does |
//! | --- | --- |
//! | mod+K | opens "go to anything" (again: closes it) |
//! | mod+B | folds the pill, or opens it |
//! | `/` | puts the cursor in the message box |
//! | `?` | shows this list |
//! | Escape | closes what is open: the list, the sheet, the open box |
//!
//! `mod` is Command on a Mac and Control elsewhere. A press that types into a field is left
//! to the field (`/` and `?` are letters there). A press inside a terminal box is left to the
//! terminal: Control+K means something to a shell.
//!
//! The table is data ([`KEYS`]): the page reads it to know which presses to keep from the
//! browser, and the list of shortcuts a person is shown is the same table.
#![cfg_attr(feature = "local", allow(dead_code))]

/// What a press does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    Palette,
    FoldPill,
    Compose,
    Help,
    Close,
}

/// One shortcut: the key, whether `mod` is held, what it does, and the words for it.
pub struct Shortcut {
    /// The key as the browser names it, in lower case (`k`, `/`, `escape`).
    pub key: &'static str,
    pub with_mod: bool,
    pub act: Act,
    pub says: &'static str,
}

pub const KEYS: &[Shortcut] = &[
    Shortcut { key: "k", with_mod: true, act: Act::Palette, says: "Go to anything: a session, a page, an action" },
    Shortcut { key: "b", with_mod: true, act: Act::FoldPill, says: "Fold the pill, or open it" },
    Shortcut { key: "/", with_mod: false, act: Act::Compose, says: "Write a message" },
    Shortcut { key: "?", with_mod: false, act: Act::Help, says: "Show these shortcuts" },
    Shortcut { key: "escape", with_mod: false, act: Act::Close, says: "Close what is open" },
];

/// Keys that are not in [`KEYS`] because the part that has the focus answers them itself.
pub const ALSO: &[(&str, &str)] = &[
    ("↑ ↓", "Move in the pill and in the list of \"go to anything\""),
    ("Enter", "Send the message · open what is chosen"),
    ("Shift Enter", "A new line in the message"),
];

/// A press as the page reports it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Press {
    pub key: String,
    /// Command on a Mac, Control elsewhere.
    pub with_mod: bool,
    /// The cursor is in a field that takes text.
    pub typing: bool,
}

/// What a press does, if anything.
pub fn act(p: &Press) -> Option<Act> {
    let key = p.key.to_lowercase();
    let s = KEYS.iter().find(|s| s.key == key && s.with_mod == p.with_mod)?;
    // Without mod, a key typed into a field is a letter.
    (s.with_mod || !p.typing).then_some(s.act)
}

/// The keys of a shortcut as a person reads them: `⌘ K` on a Mac, `Ctrl K` elsewhere.
pub fn shown(s: &Shortcut, mac: bool) -> Vec<String> {
    let key = match s.key {
        "escape" => "Esc".to_string(),
        k => k.to_uppercase(),
    };
    match (s.with_mod, mac) {
        (true, true) => vec!["⌘".into(), key],
        (true, false) => vec!["Ctrl".into(), key],
        (false, _) => vec![key],
    }
}

/// The script a page runs once to hear these keys. It tells the page of a press with
/// `dioxus.send([key, mod, typing])`, and keeps from the browser exactly the presses in
/// [`KEYS`] (so mod+K does not open the browser's own search). Escape in a field only leaves
/// the field, so a draft is never lost to it; a press inside a terminal box (`.term`) is not
/// heard at all, and a dialog answers its own plain keys (only mod+K reaches past it).
pub fn listener() -> String {
    let table: Vec<String> = KEYS.iter().map(|s| format!("[{:?},{}]", s.key, s.with_mod)).collect();
    format!(
        r#"const keys = [{}];
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const heard = e => {{
  if (e.defaultPrevented || e.isComposing) return;
  const t = e.target, el = t && t.closest ? t : null;
  if (el && el.closest('.term')) return;
  const dialog = !!el && !!el.closest('[role="dialog"]');
  const key = (e.key || '').toLowerCase();
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (e.altKey || (!mod && (e.metaKey || e.ctrlKey))) return;
  const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  if (!keys.some(k => k[0] === key && k[1] === mod)) return;
  if (!mod && dialog) return;
  if (!mod && typing) {{ if (key === 'escape') el.blur(); return; }}
  e.preventDefault();
  dioxus.send([key, mod, typing]);
}};
if (window.askkKeys) window.removeEventListener('keydown', window.askkKeys);
window.askkKeys = heard;
window.addEventListener('keydown', heard);
await new Promise(() => {{}});"#,
        table.join(",")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn press(key: &str, with_mod: bool, typing: bool) -> Press {
        Press { key: key.into(), with_mod, typing }
    }

    #[test]
    fn a_press_does_one_thing_and_a_letter_typed_into_a_field_does_nothing() {
        assert_eq!(act(&press("k", true, false)), Some(Act::Palette));
        assert_eq!(act(&press("K", true, true)), Some(Act::Palette), "mod+K works while typing");
        assert_eq!(act(&press("b", true, false)), Some(Act::FoldPill));
        assert_eq!(act(&press("/", false, false)), Some(Act::Compose));
        assert_eq!(act(&press("/", false, true)), None, "a slash typed into a message is a slash");
        assert_eq!(act(&press("?", false, false)), Some(Act::Help));
        assert_eq!(act(&press("Escape", false, false)), Some(Act::Close));
        assert_eq!(act(&press("k", false, false)), None);
        assert_eq!(act(&press("/", true, false)), None);
    }

    #[test]
    fn every_shortcut_is_shown_and_kept_from_the_browser() {
        let script = listener();
        for s in KEYS {
            assert!(script.contains(&format!("[{:?},{}]", s.key, s.with_mod)), "{} is heard", s.key);
            assert!(!s.says.is_empty());
        }
        assert_eq!(shown(&KEYS[0], true), ["⌘", "K"]);
        assert_eq!(shown(&KEYS[0], false), ["Ctrl", "K"]);
        assert_eq!(shown(&KEYS[4], true), ["Esc"]);
    }
}
