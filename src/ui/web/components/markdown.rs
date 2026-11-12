//! An answer's text, drawn: Markdown as headings, lists, tables, links and code.
//!
//! [`Markdown`] is given the text already read into plain values (`ui/features/markdown.rs`,
//! where what is safe was decided) and draws them. [`Prose`] is given the text itself, reads
//! it once, and hands the values on. [`CodeBlock`] is given a program and the word after its
//! fence: it colours it (`ui/features/code.rs`) and offers to copy it.
//!
//! Nothing written by a model becomes markup here: every piece is put on the page as text.
use super::Icon;
use crate::ui::features::code;
use crate::ui::features::markdown::{self as md, Block, Inline};
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// Text in Markdown, read and drawn. Read again only when the text changes.
#[component]
pub fn Prose(text: String, #[props(default)] class: String) -> Element {
    let blocks = use_memo(use_reactive!(|text| if md::plain(&text) { vec![Block::Para(vec![Inline::Text(text)])] } else { md::parse(&text) }));
    rsx! {
        div { class: "prose {class}", Markdown { blocks: blocks() } }
    }
}

/// Blocks, drawn one under the other.
#[component]
pub fn Markdown(blocks: Vec<Block>) -> Element {
    rsx! {
        for (i, b) in blocks.into_iter().enumerate() {
            BlockView { key: "{i}", block: b }
        }
    }
}

/// A run of inlines.
fn run(inlines: &[Inline]) -> Element {
    rsx! {
        for x in inlines.iter() {
            {one(x)}
        }
    }
}

fn one(x: &Inline) -> Element {
    match x {
        Inline::Text(t) => rsx! { "{t}" },
        Inline::Code(t) => rsx! { code { class: "md-code-inline", "{t}" } },
        Inline::Strong(inner) => rsx! { strong { {run(inner)} } },
        Inline::Em(inner) => rsx! { em { {run(inner)} } },
        Inline::Strike(inner) => rsx! { s { {run(inner)} } },
        // `to` is http, https or mailto (decided where the text was read). It opens beside
        // this page and is told nothing about it.
        Inline::Link { to, text } => rsx! { a { class: "md-link", href: "{to}", target: "_blank", rel: "noopener noreferrer", {run(text)} } },
        Inline::Break => rsx! { br {} },
    }
}

#[component]
fn BlockView(block: Block) -> Element {
    match block {
        // The page's own headings are h1 and h2; an answer's begin below them.
        Block::Heading { level, text } => match level {
            1 => rsx! { h3 { class: "md-h md-h1", {run(&text)} } },
            2 => rsx! { h4 { class: "md-h md-h2", {run(&text)} } },
            3 => rsx! { h5 { class: "md-h md-h3", {run(&text)} } },
            _ => rsx! { h6 { class: "md-h md-h4", {run(&text)} } },
        },
        Block::Para(text) => rsx! { p { class: "md-p", {run(&text)} } },
        Block::Quote(blocks) => rsx! { blockquote { class: "md-quote", Markdown { blocks } } },
        Block::Rule => rsx! { hr { class: "md-rule" } },
        Block::Code { lang, text } => rsx! { CodeBlock { lang, text } },
        Block::List { start, items } => {
            let entries = rsx! {
                for (i, item) in items.into_iter().enumerate() {
                    li { key: "{i}", class: if item.done.is_some() { "md-task" } else { "" },
                        // A task says whether it is done with a sign and a word, not a colour.
                        if let Some(done) = item.done {
                            span { class: if done { "md-tick is-done" } else { "md-tick" }, role: "img", "aria-label": if done { "done" } else { "not done" }, if done { "✓" } else { "○" } }
                        }
                        div { class: "md-item", Markdown { blocks: item.blocks } }
                    }
                }
            };
            match start {
                Some(n) => rsx! { ol { class: "md-list", start: "{n}", {entries} } },
                None => rsx! { ul { class: "md-list", {entries} } },
            }
        }
        Block::Table { head, rows } => rsx! {
            // A wide table scrolls sideways inside itself, and the keyboard can scroll it.
            div { class: "md-table-wrap", role: "region", "aria-label": "Table", tabindex: "0",
                table { class: "md-table",
                    thead { tr { for (i, c) in head.iter().enumerate() { th { key: "{i}", scope: "col", {run(c)} } } } }
                    tbody {
                        for (r, row) in rows.iter().enumerate() {
                            tr { key: "{r}", for (i, c) in row.iter().enumerate() { td { key: "{i}", {run(c)} } } }
                        }
                    }
                }
            }
        },
    }
}

/// A program: its language, the text in colours, and a button that copies it as written.
#[component]
pub fn CodeBlock(lang: String, text: String) -> Element {
    // What the copy button says: nothing yet, copied, or that it could not.
    let mut copied = use_signal(|| None::<bool>);
    let pieces = code::inked(&lang, &text);
    let copy = {
        let text = text.clone();
        move |_| {
            let quoted = serde_json::to_string(&text).unwrap_or_default();
            spawn(async move {
                let ok = document::eval(&format!("try {{ await navigator.clipboard.writeText({quoted}); return true; }} catch (e) {{ return false; }}")).await.ok().and_then(|v| v.as_bool()).unwrap_or(false);
                copied.set(Some(ok));
                let _ = document::eval("await new Promise(r => setTimeout(r, 1600)); return 0;").await;
                copied.set(None);
            });
        }
    };
    let (icon, says) = match copied() {
        None => ("copy", "Copy"),
        Some(true) => ("check", "Copied"),
        Some(false) => ("close", "Could not copy"),
    };
    rsx! {
        figure { class: "md-code",
            figcaption { class: "md-code-head",
                span { class: "md-code-lang", "{code::named(&lang)}" }
                Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "md-copy", aria_label: "Copy the code", onclick: copy,
                    Icon { name: icon, size: 14 }
                    span { role: "status", "{says}" }
                }
            }
            pre { class: "md-code-body", tabindex: "0",
                code {
                    for (i, (ink, piece)) in pieces.into_iter().enumerate() {
                        span { key: "{i}", class: "ink-{ink.key()}", "{piece}" }
                    }
                }
            }
        }
    }
}
