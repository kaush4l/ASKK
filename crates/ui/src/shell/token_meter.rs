//! The TOKEN METER: what this page has spent, in the permanent chrome. It is
//! the one part of the frame that is a NUMBER and its formatting rather than a
//! poll — `heartbeat.rs` reads the figure off the board, this decides how it
//! reads to a person.

use dioxus::prelude::*;

/// What this page has spent, in the frame, from the log (I8).
///
/// The one thing in the permanent chrome of every console with a real agent
/// behind it; VIEWS.md §6 calls its absence "the tell for a console built by
/// someone who does not run agents". Tokens and not money: a price per model
/// is a table this build does not have, and a made-up dollar figure is worse
/// than none. Nothing until the first turn reports usage — an endpoint that
/// reports none must not read as free.
///
/// The number carries a VISIBLE label and the period it covers: it was a bare
/// "3.0k tokens" explained only by a `title` (F19).
///
/// …AND ITS SUBJECT, WHICH IS THE FLEET (R8-9). `Tokens, all time` sat two
/// inches from `Agent: author` with `author` on zero turns, so the label named
/// a period and left the subject to be guessed from what was beside it — and
/// what was beside it was the wrong answer. Scoping the number to the selected
/// agent was the other repair and it is the wrong one: this is the page's
/// spend, the one figure in the chrome that must not reset when you switch tab.
#[component]
pub fn TokenMeter(tokens: ReadSignal<u64>) -> Element {
    let spent = tokens();
    if spent == 0 {
        return rsx! {};
    }
    let text = grouped(spent);
    rsx! {
        p {
            class: "pill meter",
            role: "status",
            title: "Every token spent by every agent since this browser first opened the \
                    app, summed from the event log. Replies whose provider reported no \
                    usage are not counted.",
            span { class: "pill-label", "Tokens, every agent " }
            "{text}"
        }
    }
}

/// ONE FORMAT, for the whole session (R3-23). The meter used to switch shape at
/// the ten-thousandth token — `8653` became `11.1k` — so the number a person
/// had learned to read changed units under them and dropped its last three
/// digits. Grouped digits, always: exact, and `font-variant-numeric:
/// tabular-nums` in `chrome.css` keeps the column still as it grows.
pub(crate) fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.char_indices() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn one_format_at_every_size() {
        assert_eq!(super::grouped(7), "7");
        assert_eq!(super::grouped(8653), "8,653");
        assert_eq!(super::grouped(11_100), "11,100");
        assert_eq!(super::grouped(1_234_567), "1,234,567");
    }
}
