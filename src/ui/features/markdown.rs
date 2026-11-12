//! # Markdown: an answer's text as plain values
//!
//! An engine or an agent answers in Markdown. This file reads that text once into plain
//! values ([`Block`], [`Inline`]) that every UI draws in its own way: a page as headings,
//! lists and tables, a terminal as lines.
//!
//! What is safe is decided here, not where it is drawn:
//!
//! - **Raw HTML is never markup.** It comes out as the text that was written.
//! - **A link goes only to `http`, `https` or `mailto`** ([`safe`]). Any other target
//!   (`javascript:`, `data:`, a path on this machine) leaves the link's words as plain text.
//! - **A picture is not loaded**: it is a link to itself, so reading an answer never asks
//!   another machine for anything.
// The tab's own page shows an answer as plain text and uses none of this yet.
#![cfg_attr(feature = "local", allow(dead_code))]
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag};

/// A run of text inside a block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Inline {
    Text(String),
    Code(String),
    Strong(Vec<Inline>),
    Em(Vec<Inline>),
    Strike(Vec<Inline>),
    /// `to` has passed [`safe`].
    Link { to: String, text: Vec<Inline> },
    /// A line ends here on purpose.
    Break,
}

/// One entry of a list. `done` is a task's tick, when the entry is a task.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub done: Option<bool>,
    pub blocks: Vec<Block>,
}

/// A part of the text that stands on its own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Block {
    Heading { level: u8, text: Vec<Inline> },
    Para(Vec<Inline>),
    /// `start`: the first number of a numbered list; `None` for a list of points.
    List { start: Option<u64>, items: Vec<Item> },
    Quote(Vec<Block>),
    /// A fenced or indented block of code; `lang` is the word after the fence, if any.
    Code { lang: String, text: String },
    /// Each row has as many cells as the head.
    Table { head: Vec<Vec<Inline>>, rows: Vec<Vec<Vec<Inline>>> },
    Rule,
}

/// The target of a link when it may be followed: `http`, `https` or `mailto`, nothing else.
pub fn safe(to: &str) -> Option<String> {
    let to = to.trim();
    let lower = to.to_ascii_lowercase();
    let ok = ["http://", "https://", "mailto:"].iter().any(|s| lower.starts_with(s) && lower.len() > s.len());
    (ok && !to.chars().any(|c| c.is_control() || c.is_whitespace())).then(|| to.to_string())
}

/// Read Markdown into blocks.
pub fn parse(text: &str) -> Vec<Block> {
    let mut events = Parser::new_ext(text, Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS);
    blocks(&mut events).0
}

/// Whether `text` says anything Markdown would draw differently from plain text. A UI may
/// skip the cost of drawing blocks for a plain line.
pub fn plain(text: &str) -> bool {
    !text.contains(['#', '*', '_', '`', '[', '|', '>', '~', '\n']) && !text.contains("- ") && !text.contains(". ")
}

/// Add text to a run, joined to the text before it.
fn say(run: &mut Vec<Inline>, text: &str) {
    match run.last_mut() {
        Some(Inline::Text(t)) => t.push_str(text),
        _ => run.push(Inline::Text(text.to_string())),
    }
}

/// Add inlines to a run, joining text to text.
fn join(run: &mut Vec<Inline>, more: Vec<Inline>) {
    for i in more {
        match i {
            Inline::Text(t) => say(run, &t),
            other => run.push(other),
        }
    }
}

/// Blocks up to the end of what holds them. Also gives the tick of a task, when the first
/// thing in an entry of a list was one.
fn blocks<'a>(events: &mut impl Iterator<Item = Event<'a>>) -> (Vec<Block>, Option<bool>) {
    let mut out = vec![];
    // Text that stands straight in a list entry, with no paragraph around it.
    let mut loose: Vec<Inline> = vec![];
    let mut done = None;
    fn flush(loose: &mut Vec<Inline>, out: &mut Vec<Block>) {
        if !loose.is_empty() {
            out.push(Block::Para(std::mem::take(loose)));
        }
    }
    while let Some(ev) = events.next() {
        match ev {
            Event::End(_) => break,
            Event::TaskListMarker(ticked) => done = Some(ticked),
            Event::Rule => {
                flush(&mut loose, &mut out);
                out.push(Block::Rule);
            }
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    flush(&mut loose, &mut out);
                    out.push(Block::Para(inlines(events)));
                }
                Tag::Heading { level, .. } => {
                    flush(&mut loose, &mut out);
                    out.push(Block::Heading { level: level as u8, text: inlines(events) });
                }
                Tag::BlockQuote(_) => {
                    flush(&mut loose, &mut out);
                    out.push(Block::Quote(blocks(events).0));
                }
                Tag::CodeBlock(kind) => {
                    flush(&mut loose, &mut out);
                    let lang = match kind {
                        CodeBlockKind::Fenced(info) => info.split([' ', ',', '{']).next().unwrap_or_default().to_ascii_lowercase(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    let text = raw(events);
                    out.push(Block::Code { lang, text: text.strip_suffix('\n').unwrap_or(&text).to_string() });
                }
                // Markup written by hand is shown as what was written.
                Tag::HtmlBlock => {
                    flush(&mut loose, &mut out);
                    let text = raw(events);
                    out.push(Block::Code { lang: "html".into(), text: text.trim_end().to_string() });
                }
                Tag::List(start) => {
                    flush(&mut loose, &mut out);
                    let mut items = vec![];
                    while let Some(ev) = events.next() {
                        match ev {
                            Event::Start(Tag::Item) => {
                                let (blocks, done) = blocks(events);
                                items.push(Item { done, blocks });
                            }
                            _ => break,
                        }
                    }
                    out.push(Block::List { start, items });
                }
                Tag::Table(_) => {
                    flush(&mut loose, &mut out);
                    out.push(table(events));
                }
                // A kind of block this app does not draw: its text is kept.
                Tag::FootnoteDefinition(_) | Tag::DefinitionList | Tag::DefinitionListTitle | Tag::DefinitionListDefinition | Tag::MetadataBlock(_) | Tag::Item | Tag::TableHead | Tag::TableRow | Tag::TableCell => {
                    flush(&mut loose, &mut out);
                    out.extend(blocks(events).0);
                }
                inline => join(&mut loose, span(inline, events)),
            },
            other => join(&mut loose, leaf(other)),
        }
    }
    flush(&mut loose, &mut out);
    (out, done)
}

/// The text of everything up to the end of what holds it, as written.
fn raw<'a>(events: &mut impl Iterator<Item = Event<'a>>) -> String {
    let mut text = String::new();
    for ev in events {
        match ev {
            Event::End(_) => break,
            Event::Text(t) | Event::Html(t) | Event::InlineHtml(t) | Event::Code(t) => text.push_str(&t),
            Event::SoftBreak | Event::HardBreak => text.push('\n'),
            _ => {}
        }
    }
    text
}

/// A table: its head row, then its rows, each cut or filled to the head's width.
fn table<'a>(events: &mut impl Iterator<Item = Event<'a>>) -> Block {
    fn cells<'a>(events: &mut impl Iterator<Item = Event<'a>>) -> Vec<Vec<Inline>> {
        let mut row = vec![];
        while let Some(ev) = events.next() {
            match ev {
                Event::Start(Tag::TableCell) => row.push(inlines(events)),
                _ => break,
            }
        }
        row
    }
    let (mut head, mut rows) = (vec![], vec![]);
    while let Some(ev) = events.next() {
        match ev {
            Event::Start(Tag::TableHead) => head = cells(events),
            Event::Start(Tag::TableRow) => {
                let mut row = cells(events);
                row.resize(head.len(), vec![]);
                rows.push(row);
            }
            _ => break,
        }
    }
    Block::Table { head, rows }
}

/// Inlines up to the end of what holds them.
fn inlines<'a>(events: &mut impl Iterator<Item = Event<'a>>) -> Vec<Inline> {
    let mut run = vec![];
    while let Some(ev) = events.next() {
        match ev {
            Event::End(_) => break,
            Event::Start(tag) => join(&mut run, span(tag, events)),
            other => join(&mut run, leaf(other)),
        }
    }
    run
}

/// An event that holds nothing, as inlines.
fn leaf(ev: Event) -> Vec<Inline> {
    match ev {
        Event::Text(t) | Event::Html(t) | Event::InlineHtml(t) | Event::InlineMath(t) | Event::DisplayMath(t) => vec![Inline::Text(t.to_string())],
        Event::Code(t) => vec![Inline::Code(t.to_string())],
        Event::SoftBreak => vec![Inline::Text(" ".into())],
        Event::HardBreak => vec![Inline::Break],
        Event::FootnoteReference(name) => vec![Inline::Text(format!("[{name}]"))],
        _ => vec![],
    }
}

/// What an opening tag and everything up to its end come to.
fn span<'a>(tag: Tag<'a>, events: &mut impl Iterator<Item = Event<'a>>) -> Vec<Inline> {
    let inner = inlines(events);
    match tag {
        Tag::Strong => vec![Inline::Strong(inner)],
        Tag::Emphasis => vec![Inline::Em(inner)],
        Tag::Strikethrough => vec![Inline::Strike(inner)],
        Tag::Link { dest_url, .. } => match safe(&dest_url) {
            Some(to) if !inner.is_empty() => vec![Inline::Link { to, text: inner }],
            Some(to) => vec![Inline::Link { text: vec![Inline::Text(to.clone())], to }],
            None => inner,
        },
        Tag::Image { dest_url, .. } => {
            let alt = if inner.is_empty() { vec![Inline::Text("picture".into())] } else { inner };
            match safe(&dest_url) {
                Some(to) => vec![Inline::Link { to, text: alt }],
                None => alt,
            }
        }
        _ => inner,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> Inline {
        Inline::Text(s.into())
    }

    #[test]
    fn headings_emphasis_code_and_a_break_are_read_as_values() {
        let b = parse("# Title\n\nSome **bold** and *slanted* and ~~gone~~ and `code`.  \nNext line.");
        assert_eq!(b[0], Block::Heading { level: 1, text: vec![t("Title")] });
        assert_eq!(b[1], Block::Para(vec![t("Some "), Inline::Strong(vec![t("bold")]), t(" and "), Inline::Em(vec![t("slanted")]), t(" and "), Inline::Strike(vec![t("gone")]), t(" and "), Inline::Code("code".into()), t("."), Inline::Break, t("Next line.")]));
        assert_eq!(parse("one\ntwo"), [Block::Para(vec![t("one two")])], "a line end inside a paragraph is a space");
    }

    #[test]
    fn lists_nest_count_and_carry_ticks() {
        let b = parse("3. three\n4. four\n\n- [x] done\n- [ ] open\n  - inside");
        let Block::List { start, items } = &b[0] else { panic!("a numbered list") };
        assert_eq!((*start, items.len()), (Some(3), 2));
        assert_eq!(items[0], Item { done: None, blocks: vec![Block::Para(vec![t("three")])] });
        let Block::List { start, items } = &b[1] else { panic!("a list of points") };
        assert_eq!((*start, items[0].done, items[1].done), (None, Some(true), Some(false)));
        assert!(matches!(&items[1].blocks[1], Block::List { items, .. } if items[0].blocks == [Block::Para(vec![t("inside")])]), "a list inside an entry");
    }

    #[test]
    fn code_keeps_its_language_and_its_text_as_written() {
        let b = parse("```rust,ignore\nfn main() {\n    <b>hi</b>\n}\n```\n\n    indented\n");
        assert_eq!(b[0], Block::Code { lang: "rust".into(), text: "fn main() {\n    <b>hi</b>\n}".into() });
        assert_eq!(b[1], Block::Code { lang: String::new(), text: "indented".into() });
    }

    #[test]
    fn a_table_has_a_head_and_rows_of_the_same_width() {
        let b = parse("| a | b |\n| --- | ---: |\n| 1 | **2** |\n| 3 |\n");
        let Block::Table { head, rows } = &b[0] else { panic!("a table") };
        assert_eq!(head, &[vec![t("a")], vec![t("b")]]);
        assert_eq!(rows[0], [vec![t("1")], vec![Inline::Strong(vec![t("2")])]]);
        assert_eq!(rows[1], [vec![t("3")], vec![]], "a short row is filled");
    }

    #[test]
    fn a_link_goes_only_where_it_is_safe_to_go() {
        assert_eq!(safe(" https://askk.dev/a?b=1 "), Some("https://askk.dev/a?b=1".into()));
        assert_eq!(safe("MAILTO:a@b.c"), Some("MAILTO:a@b.c".into()));
        for bad in ["javascript:alert(1)", "data:text/html,x", "/etc/passwd", "file:///x", "https://", "https://a b", "vbscript:x", " JaVaScRiPt:alert(1)"] {
            assert_eq!(safe(bad), None, "{bad}");
        }
        let b = parse("[ok](https://a.b) [bad](javascript:alert(1)) <https://c.d> ![cat](https://e.f/cat.png) ![x](data:image/png;base64,AAAA)");
        assert_eq!(b, [Block::Para(vec![
            Inline::Link { to: "https://a.b".into(), text: vec![t("ok")] },
            t(" bad "),
            Inline::Link { to: "https://c.d".into(), text: vec![t("https://c.d")] },
            t(" "),
            Inline::Link { to: "https://e.f/cat.png".into(), text: vec![t("cat")] },
            t(" x"),
        ])], "an unsafe link leaves its words; a picture is a link, never loaded");
    }

    #[test]
    fn markup_written_by_hand_is_text_never_markup() {
        let b = parse("hi <img src=x onerror=alert(1)> there\n\n<script>alert(1)</script>\n\n> quoted <b>x</b>");
        assert_eq!(b[0], Block::Para(vec![t("hi <img src=x onerror=alert(1)> there")]));
        assert_eq!(b[1], Block::Code { lang: "html".into(), text: "<script>alert(1)</script>".into() });
        assert_eq!(b[2], Block::Quote(vec![Block::Para(vec![t("quoted <b>x</b>")])]));
        assert_eq!(parse("---"), [Block::Rule]);
        assert!(plain("The sum is 30007") && !plain("a **b**") && !plain("1. one"));
    }
}
