//! WHAT A STOPPED RUN LEAVES BEHIND (R16-P0-2). One fact — `agent::STOPPED`,
//! emitted by the pure step function at the boundary — and both surfaces that
//! mention it are folds of it: the sentence in the conversation and the row in
//! the tool trace are computed here, from the same payload, in one file.
//!
//! Round 16 was spent removing the other shape, where two panes each kept their
//! own tally of one event and said two different things about it one click
//! apart. A control this new gets no chance to grow that.

use module::view::{Fragment, FragmentBuilder};

/// WHAT IT HAD DONE WHEN YOU STOPPED IT. A run you cut off is one you will want
/// to re-ask, so the number it got to is part of the sentence — the same shape
/// the round ceiling's own note has used since 15C.
///
/// And WHAT THE STOP DOES NOT DO, because this app cannot interrupt a command
/// inside the Linux or a goal already handed to another agent's Worker, and a
/// button that implied otherwise would be the class of claim thirteen rounds
/// have been spent deleting.
pub(crate) fn note(payload_json: &str) -> String {
    let far = match agent::rounds(payload_json) {
        0 => "before it had finished a round of tool calls".to_string(),
        1 => "after 1 round of tool calls".to_string(),
        n => format!("after {n} rounds of tool calls"),
    };
    format!(
        "stopped by you, {far}. Anything already running finishes — a command in the Linux, \
         or an agent it handed work to — and nothing new is started. The Tool trace has what \
         it did; ask again to carry on."
    )
}

/// The same fact as one row of the trace, in the trace's own words: WHEN, WHO,
/// and what happened. It carries no output block because nothing ran — the row
/// is the boundary itself, sitting after the last call that did.
pub(crate) fn row(who: &str, payload_json: &str, at: i64) -> Fragment {
    let far = match agent::rounds(payload_json) {
        0 => "before round 1".to_string(),
        n => format!("at round {n}"),
    };
    FragmentBuilder::new("div")
        .class("tool-call")
        .attr("data-outcome", "stopped by you")
        .attr("data-by", who)
        .attr("data-at", &at.to_string())
        .child(
            FragmentBuilder::new("p")
                .class("tool-args")
                .child(
                    FragmentBuilder::new("time")
                        .class("tool-time")
                        .text(&agent::clock(kernel::Timestamp(at)))
                        .build(),
                )
                .child(
                    FragmentBuilder::new("span")
                        .class("tool-by")
                        .text(&format!(" {who}"))
                        .build(),
                )
                .child(
                    FragmentBuilder::new("span")
                        .class("tool-outcome")
                        .text(&format!(" — stopped by you {far}"))
                        .build(),
                )
                .build(),
        )
        .build()
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_number_is_the_rounds_it_completed_and_never_a_guess() {
        assert!(super::note("3").contains("after 3 rounds of tool calls"));
        assert!(super::note("1").contains("after 1 round of tool calls"), "not '1 rounds'");
        assert!(super::note("0").contains("before it had finished a round"));
        // An unreadable payload reads as none rather than inventing a count.
        assert!(super::note("").contains("before it had finished a round"));
    }
}
