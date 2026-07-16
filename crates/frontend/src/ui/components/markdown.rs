//! Markdown subset → rsx (wave-15): `#`/`##`/`###` headings, `-`/`*` bullet
//! lists, ``` fenced code, paragraphs; inline `code`, **bold**, [text](url).
//! The line classifier, block folder, and inline splitter are pure data
//! (host-tested); `render` is the thin rsx mapping. Used by the chat's
//! assistant bubbles and the Artifacts viewer.

use dioxus::prelude::*;

/// Block-level shape of one source line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind<'a> {
    Heading(u8, &'a str),
    Bullet(&'a str),
    Fence,
    Blank,
    Text(&'a str),
}

pub fn classify(line: &str) -> LineKind<'_> {
    let t = line.trim_end();
    if t.starts_with("```") {
        LineKind::Fence
    } else if let Some(rest) = t.strip_prefix("### ") {
        LineKind::Heading(3, rest)
    } else if let Some(rest) = t.strip_prefix("## ") {
        LineKind::Heading(2, rest)
    } else if let Some(rest) = t.strip_prefix("# ") {
        LineKind::Heading(1, rest)
    } else if let Some(rest) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
        LineKind::Bullet(rest)
    } else if t.is_empty() {
        LineKind::Blank
    } else {
        LineKind::Text(t)
    }
}

/// One renderable block after folding the classified lines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    Heading(u8, String),
    List(Vec<String>),
    Code(String),
    Para(String),
}

fn flush_para(out: &mut Vec<Block>, para: &mut Vec<&str>) {
    if !para.is_empty() {
        out.push(Block::Para(para.join("\n")));
        para.clear();
    }
}

fn flush_list(out: &mut Vec<Block>, list: &mut Vec<String>) {
    if !list.is_empty() {
        out.push(Block::List(std::mem::take(list)));
    }
}

pub fn blocks(src: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut para: Vec<&str> = Vec::new();
    let mut list: Vec<String> = Vec::new();
    let mut code: Option<Vec<&str>> = None;
    for line in src.lines() {
        // Inside a fence everything is verbatim until the closing fence.
        if let Some(buf) = code.as_mut() {
            if classify(line) == LineKind::Fence {
                out.push(Block::Code(buf.join("\n")));
                code = None;
            } else {
                buf.push(line);
            }
            continue;
        }
        match classify(line) {
            LineKind::Fence => {
                flush_para(&mut out, &mut para);
                flush_list(&mut out, &mut list);
                code = Some(Vec::new());
            }
            LineKind::Heading(level, text) => {
                flush_para(&mut out, &mut para);
                flush_list(&mut out, &mut list);
                out.push(Block::Heading(level, text.to_string()));
            }
            LineKind::Bullet(item) => {
                flush_para(&mut out, &mut para);
                list.push(item.to_string());
            }
            LineKind::Blank => {
                flush_para(&mut out, &mut para);
                flush_list(&mut out, &mut list);
            }
            LineKind::Text(text) => {
                flush_list(&mut out, &mut list);
                para.push(text);
            }
        }
    }
    if let Some(buf) = code {
        out.push(Block::Code(buf.join("\n"))); // unclosed fence still shows
    }
    flush_para(&mut out, &mut para);
    flush_list(&mut out, &mut list);
    out
}

/// Inline run inside a paragraph or list item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Span {
    Text(String),
    Bold(String),
    Code(String),
    Link { text: String, href: String },
}

/// `[text](href)` starting at `from`; returns the span and the rest.
fn parse_link(from: &str) -> Option<(Span, &str)> {
    let close = from.find("](")?;
    let end = from[close + 2..].find(')')?;
    Some((
        Span::Link {
            text: from[1..close].to_string(),
            href: from[close + 2..close + 2 + end].to_string(),
        },
        &from[close + 2 + end + 1..],
    ))
}

pub fn spans(text: &str) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    loop {
        // The earliest opener decides what to try next.
        let next = ["**", "`", "["]
            .iter()
            .filter_map(|m| rest.find(m).map(|at| (at, *m)))
            .min();
        let Some((at, marker)) = next else {
            plain.push_str(rest);
            break;
        };
        let (before, from) = rest.split_at(at);
        let parsed = match marker {
            "**" => from[2..].find("**").map(|end| {
                (
                    Span::Bold(from[2..2 + end].to_string()),
                    &from[2 + end + 2..],
                )
            }),
            "`" => from[1..].find('`').map(|end| {
                (
                    Span::Code(from[1..1 + end].to_string()),
                    &from[1 + end + 1..],
                )
            }),
            _ => parse_link(from),
        };
        plain.push_str(before);
        match parsed {
            Some((span, after)) => {
                if !plain.is_empty() {
                    out.push(Span::Text(std::mem::take(&mut plain)));
                }
                out.push(span);
                rest = after;
            }
            None => {
                // The opener never closes: keep it literal, move past it.
                plain.push_str(&from[..marker.len()]);
                rest = &from[marker.len()..];
            }
        }
    }
    if !plain.is_empty() {
        out.push(Span::Text(plain));
    }
    out
}

fn inline(text: &str) -> Element {
    let spans = spans(text);
    rsx! {
        for (k, span) in spans.iter().enumerate() {
            match span {
                Span::Text(t) => rsx! { span { key: "{k}", "{t}" } },
                Span::Bold(t) => rsx! { strong { key: "{k}", "{t}" } },
                Span::Code(t) => rsx! { code { key: "{k}", "{t}" } },
                Span::Link { text, href } => rsx! {
                    a { key: "{k}", href: "{href}", target: "_blank", rel: "noopener", "{text}" }
                },
            }
        }
    }
}

/// The whole subset renderer: markdown source → one `.md` div.
pub fn render(src: &str) -> Element {
    let blocks = blocks(src);
    rsx! {
        div { class: "md",
            for (i, block) in blocks.iter().enumerate() {
                match block {
                    Block::Heading(1, text) => rsx! { h1 { key: "{i}", "{text}" } },
                    Block::Heading(2, text) => rsx! { h2 { key: "{i}", "{text}" } },
                    Block::Heading(_, text) => rsx! { h3 { key: "{i}", "{text}" } },
                    Block::Code(code) => rsx! { pre { key: "{i}", code { "{code}" } } },
                    Block::Para(text) => rsx! { p { key: "{i}", {inline(text)} } },
                    Block::List(items) => rsx! {
                        ul { key: "{i}",
                            for (j, item) in items.iter().enumerate() {
                                li { key: "{j}", {inline(item)} }
                            }
                        }
                    },
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_names_every_line_shape() {
        assert_eq!(classify("# Title"), LineKind::Heading(1, "Title"));
        assert_eq!(classify("## Sub"), LineKind::Heading(2, "Sub"));
        assert_eq!(classify("### Deep"), LineKind::Heading(3, "Deep"));
        assert_eq!(classify("#NotAHeading"), LineKind::Text("#NotAHeading"));
        assert_eq!(classify("- item"), LineKind::Bullet("item"));
        assert_eq!(classify("* item"), LineKind::Bullet("item"));
        assert_eq!(classify("```rust"), LineKind::Fence);
        assert_eq!(classify("   "), LineKind::Blank);
        assert_eq!(classify("plain"), LineKind::Text("plain"));
    }

    #[test]
    fn blocks_fold_paragraphs_lists_and_fences() {
        let src =
            "# T\n\nline one\nline two\n\n- a\n- b\n```\nlet x = 1;\n# not a heading\n```\ntail";
        assert_eq!(
            blocks(src),
            vec![
                Block::Heading(1, "T".into()),
                Block::Para("line one\nline two".into()),
                Block::List(vec!["a".into(), "b".into()]),
                Block::Code("let x = 1;\n# not a heading".into()),
                Block::Para("tail".into()),
            ]
        );
    }

    #[test]
    fn blocks_keep_an_unclosed_fence_visible() {
        assert_eq!(
            blocks("```\ncode without end"),
            vec![Block::Code("code without end".into())]
        );
    }

    #[test]
    fn spans_split_bold_code_and_links() {
        assert_eq!(
            spans("use `x` and **y** — see [docs](https://d.io)."),
            vec![
                Span::Text("use ".into()),
                Span::Code("x".into()),
                Span::Text(" and ".into()),
                Span::Bold("y".into()),
                Span::Text(" — see ".into()),
                Span::Link {
                    text: "docs".into(),
                    href: "https://d.io".into()
                },
                Span::Text(".".into()),
            ]
        );
    }

    #[test]
    fn spans_leave_unclosed_markers_literal() {
        assert_eq!(
            spans("a ** b ` c [d](e"),
            vec![Span::Text("a ** b ` c [d](e".into())]
        );
        assert_eq!(spans("plain"), vec![Span::Text("plain".into())]);
    }
}
