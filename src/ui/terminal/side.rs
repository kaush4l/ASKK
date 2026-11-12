//! # Side: the sidebar of `askk terminal`, drawn
//!
//! Every box, what needs the owner first, under the place it runs in (herdr's Spaces): a
//! place's heading says its branch and how it stands; a box is its mark, its name and kind,
//! and its last line under it. Folded, it is marks only. Where a row is ([`side_row`]) is
//! worked out by the same function that draws it, so a click lands on what is shown.
use super::draw::{mark_style, put, Foot, Picture, DIM, HEADING, KEY, SIDE_HEAD, STRONG};
use ratatui::prelude::{Buffer, Color, Modifier, Rect, Style};

/// One row of the sidebar's list: a place's heading, or a box's first row or the one under it.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Slot {
    Head(usize),
    Box(usize, bool),
}

/// Every row of the list, open or folded. `heads`: where in the list each place begins
/// (empty: no headings). Folded, a box is one row and there are no headings.
fn slots(open: bool, boxes: usize, heads: &[usize]) -> Vec<Slot> {
    let mut out = vec![];
    for i in 0..boxes {
        if !open {
            out.push(Slot::Box(i, false));
            continue;
        }
        if let Some(g) = heads.iter().position(|h| *h == i) {
            out.push(Slot::Head(g));
        }
        out.extend([Slot::Box(i, false), Slot::Box(i, true)]);
    }
    out
}

/// The rows of the list, the first one drawn so that `chosen` is in view, and how many are
/// drawn. When they do not all fit, the last row says how many more there are.
fn side_window(side: Rect, open: bool, heads: &[usize], boxes: usize, chosen: usize) -> (Vec<Slot>, usize, usize) {
    let all = slots(open, boxes, heads);
    let rows = usize::from(side.height.saturating_sub(SIDE_HEAD));
    if all.len() <= rows {
        return (all, 0, rows);
    }
    let room = rows.saturating_sub(1).max(1);
    let end = all.iter().rposition(|s| matches!(s, Slot::Box(i, _) if *i == chosen)).map_or(0, |p| p + 1);
    let mut first = end.saturating_sub(room);
    // A box is drawn whole: the list does not begin on the row under one.
    while matches!(all.get(first), Some(Slot::Box(_, true))) {
        first += 1;
    }
    (all, first, room)
}

/// The box drawn at row `y` of the sidebar, as its place in the list.
pub fn side_row(side: Rect, open: bool, heads: &[usize], boxes: usize, chosen: usize, y: u16) -> Option<usize> {
    let (all, first, room) = side_window(side, open, heads, boxes, chosen);
    let row = usize::from(y.checked_sub(side.y + SIDE_HEAD)?);
    match all.get(first + row).filter(|_| row < room) {
        Some(Slot::Box(i, _)) => Some(*i),
        _ => None,
    }
}

pub(super) fn sidebar(buf: &mut Buffer, side: Rect, p: &Picture) {
    let end = side.x + side.width.saturating_sub(1);
    // The line between the sidebar and the rest.
    for y in side.y..side.y + side.height {
        put(buf, end, y, end + 1, "│", DIM);
    }
    if !p.side_open {
        put(buf, side.x, side.y, end, " ›", KEY);
    } else {
        let x = put(buf, side.x, side.y, end, " askk", STRONG);
        put(buf, x, side.y, end.saturating_sub(2), &format!(" · {}", p.host), DIM);
        put(buf, end.saturating_sub(2), side.y, end, "‹ ", KEY);
        put(buf, side.x, side.y + 1, end, " boxes", HEADING);
    }
    let at: Vec<usize> = p.heads.iter().map(|h| h.at).collect();
    let (all, first, room) = side_window(side, p.side_open, &at, p.boxes.len(), p.side_at);
    let mut last = 0;
    for (row, slot) in all.iter().skip(first).take(room).enumerate() {
        let y = side.y + SIDE_HEAD + row as u16;
        match *slot {
            // A place: its name, and how its git stands.
            Slot::Head(g) => {
                let h = &p.heads[g];
                let x = put(buf, side.x + 1, y, end, &h.name, HEADING);
                put(buf, x + 1, y, end, &h.git, Style::new().fg(if h.clean { Color::Green } else { Color::Yellow }));
            }
            Slot::Box(i, under) => {
                let b = p.boxes[i];
                let mark = p.seen.mark(b);
                last = i;
                if under {
                    let words = if b.last.is_empty() { mark.word().to_string() } else { b.last.clone() };
                    put(buf, side.x + 3, y, end, &words, DIM);
                    continue;
                }
                if p.foot == Foot::Side && i == p.side_at {
                    buf.set_style(Rect { x: side.x, y, width: side.width.saturating_sub(1), height: 1 }, Style::new().add_modifier(Modifier::REVERSED));
                }
                // The box the pane in focus shows carries a bar at the edge.
                put(buf, side.x, y, end, if b.id == p.shown { "▎" } else { " " }, KEY);
                let x = put(buf, side.x + 1, y, end, mark.sign(), mark_style(mark));
                if p.side_open {
                    let x = put(buf, x, y, end, &format!(" {}", b.title), STRONG);
                    put(buf, x, y, end, &format!(" · {}", b.kind), DIM);
                }
            }
        }
    }
    // What does not fit is counted, not dropped in silence.
    let more = if all.len() > room { p.boxes.len().saturating_sub(last + 1) } else { 0 };
    if more > 0 && side.height > 0 {
        let y = side.y + side.height - 1;
        put(buf, side.x, y, end, &if p.side_open { format!(" +{more} more (w, then ↓)") } else { format!("+{more}") }, DIM);
    }
}

