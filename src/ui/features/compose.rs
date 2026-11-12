//! # Compose: what the composer understands as it is typed into
//!
//! | typed | what opens | what a pick does |
//! | --- | --- | --- |
//! | `/` at the start | the commands ([`COMMANDS`]) | writes the command; Enter runs it ([`command`]) |
//! | `@` | the other boxes and this engine's other conversations | writes `@name`; sent, the message carries a note on what it names ([`references`]) |
//! | `#` | the files of the engine's workspace | writes `#path`; the engine reads it with its own tools |
//!
//! The menu is found by the last word only ([`trigger`]), so it opens as the word is typed and
//! closes when a space ends it. It is moved through with the arrows, taken with Enter or Tab,
//! and closed with Escape.
//!
//! Beside it: what an ArrowUp in an empty composer brings back ([`recall`]), what a paste
//! becomes ([`BIG_PASTE`]; the page's own listener holds it, `views/compose.rs`), a cited answer as the composer holds it ([`cite`]), and the
//! limits an attachment is held to ([`LIMITS`]).
#![cfg_attr(feature = "local", allow(dead_code))]

/// One command: its name, what it takes, what it does.
#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub name: &'static str,
    pub takes: &'static str,
    pub about: &'static str,
}

pub const COMMANDS: &[Command] = &[
    Command { name: "clear", takes: "", about: "clear this conversation (notes, goal and learning stay)" },
    Command { name: "new", takes: "", about: "begin a new conversation; this one is kept" },
    Command { name: "goal", takes: "<text>", about: "set what this engine is for" },
    Command { name: "model", takes: "<name>", about: "name the model this engine uses (default: follow the default)" },
    Command { name: "compact", takes: "", about: "fold the conversation into a short summary now" },
    Command { name: "permit", takes: "ask | edits | all", about: "choose what it may do without asking" },
];

/// A line of the menu: what is shown, a word beside it, and what replaces the word typed.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub label: String,
    pub detail: String,
    pub insert: String,
}

/// Something `@` can name: its name as written after `@`, and what it is.
#[derive(Clone, Debug, PartialEq)]
pub struct Mention {
    pub name: String,
    pub about: String,
    /// What a message that names it is told about it.
    pub note: String,
}

/// The menu's sign and the word typed after it, when the text ends in a word that opens it:
/// `/` only at the very start, `@` and `#` anywhere.
pub fn trigger(text: &str) -> Option<(char, String)> {
    if text.ends_with(char::is_whitespace) {
        return None;
    }
    let word = text.rsplit(char::is_whitespace).next().unwrap_or_default();
    let sign = word.chars().next()?;
    match sign {
        '/' if text.trim_start() == word => Some(('/', word[1..].to_string())),
        '@' | '#' => Some((sign, word[1..].to_string())),
        _ => None,
    }
}

/// How many lines the menu shows at most.
pub const MENU: usize = 8;

/// The menu for `text`: the lines that start with (then hold) what was typed after the sign.
pub fn menu(text: &str, mentions: &[Mention], files: &[String]) -> Vec<Item> {
    let Some((sign, typed)) = trigger(text) else { return vec![] };
    let low = typed.to_lowercase();
    let rank = |name: &str| {
        let n = name.to_lowercase();
        if n.starts_with(&low) { Some(0) } else if n.contains(&low) { Some(1) } else { None }
    };
    let mut found: Vec<(u8, Item)> = match sign {
        '/' => COMMANDS.iter().filter_map(|c| rank(c.name).map(|r| (r, Item { label: format!("/{} {}", c.name, c.takes).trim().to_string(), detail: c.about.into(), insert: format!("/{}", c.name) }))).collect(),
        '@' => mentions.iter().filter_map(|m| rank(&m.name).map(|r| (r, Item { label: format!("@{}", m.name), detail: m.about.clone(), insert: format!("@{}", m.name) }))).collect(),
        _ => files.iter().filter_map(|f| rank(f).map(|r| (r, Item { label: format!("#{f}"), detail: "a file in its workspace".into(), insert: format!("#{f}") }))).collect(),
    };
    found.sort_by_key(|(r, _)| *r);
    found.into_iter().map(|(_, i)| i).take(MENU).collect()
}

/// The text with its last word replaced by a pick, and a space after, so typing goes on.
pub fn apply(text: &str, item: &Item) -> String {
    let cut = text.rfind(char::is_whitespace).map(|i| i + 1).unwrap_or(0);
    format!("{}{} ", &text[..cut], item.insert)
}

/// The command a message is, when it starts with one: its name and the words after it.
/// `None`: it is a message (an unknown `/word` is a message too, so a path can be sent).
pub fn command(text: &str) -> Option<(&'static str, String)> {
    let t = text.trim();
    let rest = t.strip_prefix('/')?;
    let (name, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    COMMANDS.iter().find(|c| c.name == name).map(|c| (c.name, args.trim().to_string()))
}

/// The message as sent: what was typed, then one note for each `@name` in it that names
/// something known, so the engine knows what was meant.
pub fn references(text: &str, mentions: &[Mention]) -> String {
    let named: Vec<&Mention> = mentions.iter().filter(|m| text.split(|c: char| c.is_whitespace() || ",.;:!?()".contains(c)).any(|w| w == format!("@{}", m.name))).collect();
    if named.is_empty() {
        return text.to_string();
    }
    let notes: Vec<String> = named.iter().map(|m| format!("- @{}: {}", m.name, m.note)).collect();
    format!("{text}\n\n(named in this message)\n{}", notes.join("\n"))
}

/// The prompt ArrowUp brings back: from the newest (`at` none) to older ones; `up` false goes
/// back toward the newest, and past it to nothing (`None`).
pub fn recall(asked: &[String], at: Option<usize>, up: bool) -> Option<usize> {
    if asked.is_empty() {
        return None;
    }
    match (at, up) {
        (None, true) => Some(asked.len() - 1),
        (Some(i), true) => Some(i.saturating_sub(1)),
        (Some(i), false) if i + 1 < asked.len() => Some(i + 1),
        _ => None,
    }
}

/// From this many bytes a pasted text becomes a file attached to the message.
pub const BIG_PASTE: usize = 32 * 1024;


/// What the composer says an attachment is held to (the service's own limits, `host/media.rs`).
pub const LIMITS: &str = "Images, recordings, videos and texts; several at once, by the clip, a drop or a paste. Up to 400 MB a file; a text is read up to 20,000 characters. A paste of 32 KB or more becomes a text file (mod+shift+V keeps it as text).";

/// A cited answer as the composer holds it: each line quoted, and a line left to write on.
pub fn cite(said: &str, before: &str) -> String {
    let quoted: Vec<String> = said.trim().lines().map(|l| if l.is_empty() { ">".to_string() } else { format!("> {l}") }).collect();
    let before = before.trim_end();
    format!("{}{}\n\n", if before.is_empty() { String::new() } else { format!("{before}\n\n") }, quoted.join("\n"))
}

/// What a steer's line says: waiting for the next step, or where it landed.
pub fn steer_line(landed: Option<usize>, posted: bool) -> String {
    match (landed, posted) {
        (_, true) => "came after the last step: sent as a message for the next run".into(),
        (Some(step), _) => format!("landed at step {step}"),
        (None, _) => "waits for the next step of this run".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_menu_opens_on_the_word_being_typed() {
        assert_eq!(trigger("/go"), Some(('/', "go".into())));
        assert_eq!(trigger("say /go"), None, "a command only at the start");
        assert_eq!(trigger("ask @gu"), Some(('@', "gu".into())));
        assert_eq!(trigger("read #src/ma"), Some(('#', "src/ma".into())));
        assert_eq!(trigger("ask @guru "), None, "a space ends the word");
        assert_eq!(trigger(""), None);
        let m = menu("/c", &[], &[]);
        assert_eq!(m.iter().map(|i| i.insert.as_str()).collect::<Vec<_>>(), ["/clear", "/compact"]);
        let mentions = vec![Mention { name: "askk/guru".into(), about: "engine".into(), note: "the teacher".into() }];
        assert_eq!(menu("@gu", &mentions, &[])[0].label, "@askk/guru", "found inside the name too");
        assert_eq!(menu("#main", &[], &["src/main.rs".into()])[0].insert, "#src/main.rs");
        assert_eq!(apply("ask @gu", &menu("@gu", &mentions, &[])[0]), "ask @askk/guru ");
    }

    #[test]
    fn a_command_is_run_and_a_mention_is_explained() {
        assert_eq!(command("/goal  teach fractions "), Some(("goal", "teach fractions".into())));
        assert_eq!(command("/clear"), Some(("clear", String::new())));
        assert_eq!(command("/usr/bin is a path"), None);
        assert_eq!(command("hello"), None);
        let mentions = vec![Mention { name: "askk/guru".into(), about: "engine".into(), note: "the teacher, idle".into() }];
        assert_eq!(references("ask @askk/guru, please", &mentions), "ask @askk/guru, please\n\n(named in this message)\n- @askk/guru: the teacher, idle");
        assert_eq!(references("no names", &mentions), "no names");
    }

    #[test]
    fn recall_walks_back_and_forth_and_a_big_paste_is_a_file() {
        let asked: Vec<String> = ["a", "b", "c"].map(String::from).to_vec();
        assert_eq!(recall(&asked, None, true), Some(2));
        assert_eq!(recall(&asked, Some(0), true), Some(0), "it stops at the oldest");
        assert_eq!(recall(&asked, Some(1), false), Some(2));
        assert_eq!(recall(&asked, Some(2), false), None, "past the newest is the empty composer");
        assert_eq!(recall(&[], None, true), None);
        assert_eq!(cite("one\n\ntwo", ""), "> one\n>\n> two\n\n");
        assert_eq!(cite("x", "see"), "see\n\n> x\n\n");
        assert_eq!(steer_line(Some(3), false), "landed at step 3");
    }
}
