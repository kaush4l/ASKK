//! # Go to anything: one list of every place and action, found by typing
//!
//! The list holds every session (a box), every page, and the things a person can do from
//! anywhere (fold the pill, switch the theme, start a session, show the shortcuts). Typing
//! narrows it ([`find`]); what is chosen is a [`Pick`], and the window acts on it.
#![cfg_attr(feature = "local", allow(dead_code))]

/// What choosing an entry does.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pick {
    /// Open this box on the canvas.
    Box(String),
    /// Go to this page.
    Page(String),
    FoldPill,
    Theme,
    Keys,
    /// Show the idle sessions on the canvas too, or only what runs.
    Idle,
    /// Start a session with this harness.
    Session(String),
}

/// One line of the list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub pick: Pick,
    pub label: String,
    /// A few quiet words after the label: a box's state, a page's address.
    pub hint: String,
    /// The heading it stands under.
    pub group: &'static str,
    /// The keys that do the same, when there are any.
    pub keys: Vec<String>,
}

impl Entry {
    /// A name of its own, for a UI that must tell the lines apart.
    pub fn id(&self) -> String {
        match &self.pick {
            Pick::Box(id) => format!("box-{id}"),
            Pick::Page(to) => format!("page-{to}"),
            Pick::Session(kind) => format!("new-{kind}"),
            other => format!("do-{other:?}").to_lowercase(),
        }
        .replace(|c: char| !(c.is_alphanumeric() || c == '-'), "-")
    }
}

/// What the list is made from, as plain values.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Sources {
    /// Each box: its id, its name, and a few words on it (its kind, its state).
    pub boxes: Vec<(String, String, String)>,
    /// Each page: its name and its address.
    pub pages: Vec<(String, String)>,
    /// Each harness a session can be started with.
    pub harnesses: Vec<String>,
    pub light: bool,
    pub folded: bool,
    pub mac: bool,
}

/// Every entry, in the order shown when nothing is typed: sessions, pages, actions.
pub fn entries(s: &Sources) -> Vec<Entry> {
    use super::keys::{shown, Act, KEYS};
    let keys = |a: Act| KEYS.iter().find(|k| k.act == a).map(|k| shown(k, s.mac)).unwrap_or_default();
    let mut out: Vec<Entry> = s.boxes.iter().map(|(id, title, about)| Entry { pick: Pick::Box(id.clone()), label: title.clone(), hint: about.clone(), group: "Sessions", keys: vec![] }).collect();
    out.extend(s.pages.iter().map(|(label, to)| Entry { pick: Pick::Page(to.clone()), label: label.clone(), hint: to.clone(), group: "Pages", keys: vec![] }));
    let act = |pick: Pick, label: &str, keys: Vec<String>| Entry { pick, label: label.to_string(), hint: String::new(), group: "Actions", keys };
    out.push(act(Pick::FoldPill, if s.folded { "Open the pill" } else { "Fold the pill" }, keys(Act::FoldPill)));
    out.push(act(Pick::Theme, if s.light { "Switch to the dark theme" } else { "Switch to the light theme" }, vec![]));
    out.push(act(Pick::Idle, "Show or hide idle sessions on the canvas", vec![]));
    out.extend(s.harnesses.iter().map(|kind| act(Pick::Session(kind.clone()), &format!("New session with {kind}"), vec![])));
    out.push(act(Pick::Keys, "Show the keyboard shortcuts", keys(Act::Help)));
    out
}

/// How well `text` holds one typed `word` (both lower case): higher is better, `None` is not
/// at all. The start of the text beats the start of a word in it, which beats the middle.
fn score(text: &str, word: &str) -> Option<u32> {
    let at = text.find(word)?;
    let word_start = at == 0 || text[..at].ends_with(|c: char| !c.is_alphanumeric());
    Some(match (at, word_start) {
        (0, _) => 400,
        (_, true) => 300,
        _ => 200,
    })
}

/// The entries that answer what was typed, best first; all of them when nothing was. Every
/// word typed must be in the entry's label or in its hint; a word in the label counts for
/// more. Entries that answer equally well keep their order.
pub fn find(all: &[Entry], typed: &str) -> Vec<Entry> {
    let typed = typed.trim().to_lowercase();
    let words: Vec<&str> = typed.split_whitespace().collect();
    if words.is_empty() {
        return all.to_vec();
    }
    let mut hits: Vec<(u32, usize, &Entry)> = all
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            let (label, hint) = (e.label.to_lowercase(), e.hint.to_lowercase());
            let each: Option<Vec<u32>> = words.iter().map(|w| score(&label, w).map(|s| s + 50).max(score(&hint, w))).collect();
            each.and_then(|s| s.into_iter().min()).map(|s| (s, i, e))
        })
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    hits.into_iter().map(|(_, _, e)| e.clone()).collect()
}

/// The line the arrow keys move to from `at` in a list of `len`: down or up, round the ends.
pub fn step(at: usize, len: usize, down: bool) -> usize {
    match (len, down) {
        (0, _) => 0,
        (n, true) => (at + 1) % n,
        (n, false) => (at + n - 1) % n,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources() -> Sources {
        Sources {
            boxes: vec![("engine:askk".into(), "askk".into(), "engine · idle".into()), ("engine:askk/developer".into(), "developer".into(), "engine · working".into()), ("session:3".into(), "fix the build".into(), "claude · waits for you".into())],
            pages: vec![("Home".into(), "/".into()), ("Talk".into(), "/talk".into()), ("Settings".into(), "/settings".into())],
            harnesses: vec!["claude".into()],
            ..Default::default()
        }
    }

    #[test]
    fn the_list_holds_every_box_every_page_and_the_actions() {
        let all = entries(&sources());
        let groups: Vec<&str> = all.iter().map(|e| e.group).collect();
        assert_eq!(groups.iter().filter(|g| **g == "Sessions").count(), 3);
        assert_eq!(groups.iter().filter(|g| **g == "Pages").count(), 3);
        let actions: Vec<&str> = all.iter().filter(|e| e.group == "Actions").map(|e| e.label.as_str()).collect();
        assert_eq!(actions, ["Fold the pill", "Switch to the light theme", "Show or hide idle sessions on the canvas", "New session with claude", "Show the keyboard shortcuts"]);
        assert_eq!(all.iter().find(|e| e.pick == Pick::FoldPill).map(|e| e.keys.clone()), Some(vec!["Ctrl".to_string(), "B".to_string()]));
        let ids: std::collections::BTreeSet<String> = all.iter().map(Entry::id).collect();
        assert_eq!(ids.len(), all.len(), "every line has a name of its own");
        assert!(ids.iter().all(|id| id.chars().all(|c| c.is_alphanumeric() || c == '-')));
        let other = entries(&Sources { light: true, folded: true, mac: true, ..sources() });
        assert!(other.iter().any(|e| e.label == "Open the pill" && e.keys == ["⌘", "B"]) && other.iter().any(|e| e.label == "Switch to the dark theme"));
    }

    #[test]
    fn typing_narrows_the_list_and_the_best_match_is_first() {
        let all = entries(&sources());
        let labels = |typed: &str| find(&all, typed).into_iter().map(|e| e.label).collect::<Vec<_>>();
        assert_eq!(find(&all, "  ").len(), all.len(), "nothing typed: everything");
        assert_eq!(labels("dev"), ["developer"]);
        assert_eq!(labels("light"), ["Switch to the light theme"]);
        assert_eq!(labels("build fix"), ["fix the build"], "every word typed, in any order");
        assert_eq!(labels("waits"), ["fix the build"], "a box is found by its state");
        assert_eq!(labels("TALK"), ["Talk"]);
        assert!(labels("zzz").is_empty() && labels("fix zzz").is_empty());
        assert_eq!(labels("s")[0], "Settings", "the start of a label beats the middle of an earlier one");
        assert_eq!(labels("t")[0], "Talk");
    }

    #[test]
    fn the_arrows_go_round_the_ends() {
        assert_eq!((step(0, 3, true), step(2, 3, true), step(0, 3, false), step(1, 3, false)), (1, 0, 2, 0));
        assert_eq!(step(5, 0, true), 0);
    }
}
