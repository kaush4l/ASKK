//! # Screen: what a terminal shows, as an object
//!
//! The service holds the terminals (`docs/concept.md`, section 6). A window never gets the
//! bytes a program wrote: it gets the screen those bytes made, worked out once in the
//! service, so a page, the Mac window and `askk terminal` all draw the same thing and none
//! needs a terminal library of its own.
//!
//! - [`Screen`]: the rows as they stand now, the cursor, the title the program set, and
//!   whether the program still runs.
//! - [`Line`]: one row, as runs of text that share a look ([`Span`]).
//! - A colour is a string: empty for the terminal's own, `"0"`..`"255"` for one of the 256
//!   indexed colours, or `"#rrggbb"`.
//!
//! The questions about a terminal (`api/`): `terminal_open(command, place, cols, rows)` gives
//! its id; `terminal_screen(id)` gives this object; `terminal_type(id, keys)` types;
//! `terminal_resize(id, cols, rows)`; `terminal_close(id)`; `terminal_scrolled(id, back)`
//! gives this object as it was `back` rows up. A terminal is also a box
//! (`terminal:<id>`, `core/boxes.rs`), and its key on the change feed is `terminals/<id>`.
use serde::{Deserialize, Serialize};

/// A run of text in one look.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    /// The ink; empty = the terminal's own.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fg: String,
    /// The ground; empty = the terminal's own.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub bg: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dim: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    /// Ink and ground change places.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inverse: bool,
}

impl Span {
    /// Text in the terminal's own look.
    pub fn plain(text: impl Into<String>) -> Span {
        Span { text: text.into(), ..Default::default() }
    }

    /// Whether `other` looks the same (so the two can be one span).
    pub fn same_look(&self, other: &Span) -> bool {
        (&self.fg, &self.bg, self.bold, self.dim, self.italic, self.underline, self.inverse) == (&other.fg, &other.bg, other.bold, other.dim, other.italic, other.underline, other.inverse)
    }
}

/// One row of the screen.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub spans: Vec<Span>,
}

impl Line {
    /// The row's text without its looks.
    pub fn text(&self) -> String {
        self.spans.iter().map(|s| s.text.as_str()).collect()
    }

    /// Add a span, joined to the last one when it looks the same.
    pub fn push(&mut self, span: Span) {
        if span.text.is_empty() {
            return;
        }
        match self.spans.last_mut() {
            Some(last) if last.same_look(&span) => last.text.push_str(&span.text),
            _ => self.spans.push(span),
        }
    }
}

/// A terminal's screen as it stands now.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Screen {
    pub cols: u16,
    pub rows: u16,
    /// Top to bottom; at most `rows` of them. Rows with nothing on them at the end are left out.
    pub lines: Vec<Line>,
    /// Where the cursor is, as (column, row) from 0; `None` when the program hid it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<(u16, u16)>,
    /// The title the program set; empty when it set none.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    /// Whether the program still runs.
    pub alive: bool,
    /// How it ended, once it has.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<i32>,
    /// The program asked for pasted text to be marked (bracketed paste): a window sends a
    /// paste between the marks (`ui/features/terminals.rs`, `pasted`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bracketed: bool,
}

impl Screen {
    /// The last row that says something, for a box's one line.
    pub fn last_line(&self) -> String {
        self.lines.iter().rev().map(Line::text).map(|t| t.trim().to_string()).find(|t| !t.is_empty()).unwrap_or_default()
    }

    /// The whole screen as plain text, a row per line.
    pub fn text(&self) -> String {
        self.lines.iter().map(|l| l.text().trim_end().to_string()).collect::<Vec<_>>().join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_of_one_look_are_one_span_and_a_screen_reads_as_text() {
        let mut line = Line::default();
        line.push(Span::plain("ab"));
        line.push(Span::plain("c"));
        line.push(Span { text: "!".into(), fg: "1".into(), bold: true, ..Default::default() });
        line.push(Span::plain(""));
        assert_eq!((line.spans.len(), line.text()), (2, "abc!".to_string()));
        let screen = Screen { cols: 80, rows: 24, lines: vec![line, Line::default(), Line { spans: vec![Span::plain("  $ ")] }, Line::default()], alive: true, ..Default::default() };
        assert_eq!(screen.last_line(), "$");
        assert_eq!(screen.text(), "abc!\n\n  $\n");
    }

    #[test]
    fn a_screen_goes_over_the_wire_without_what_it_does_not_have() {
        let s = Screen { cols: 2, rows: 1, lines: vec![Line { spans: vec![Span::plain("hi")] }], alive: true, ..Default::default() };
        let text = serde_json::to_string(&s).unwrap();
        assert_eq!(text, r#"{"cols":2,"rows":1,"lines":[{"spans":[{"text":"hi"}]}],"alive":true}"#);
        assert_eq!(serde_json::from_str::<Screen>(&text).unwrap(), s);
    }
}
