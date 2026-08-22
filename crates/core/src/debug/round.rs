//! ONE ROUND — the model call, what it cost, the Document it was sent, and
//! WHAT THE MODEL ACTUALLY SAID WHEN IT DECIDED TO CALL A TOOL.
//!
//! That last one is the fact this file exists for. `chat::transcript::spoken`
//! pushes a tool-calling `ModelReplied` onto a counter and draws NOTHING
//! (`fn calling`), on purpose and correctly — the conversation is for the
//! answer, and a transcript full of the model's working is not a conversation.
//! But the working was then in the log and on no screen anywhere: only the
//! final prose reply is ever rendered, so the four rounds a turn actually
//! spent, and the reasoning the model wrote before each call, were invisible.
//! Here they are, in log order, one block each.
//!
//! …AND `document_hash` WITH THEM. Emitted by `effects.rs` since the token
//! meter landed and read by nothing. It is the identity of the assembled
//! Document that round was sent (I13), which makes it the one fact that
//! settles the commonest question a stuck turn raises: two rounds carrying the
//! same hash were sent the SAME prompt, and that is a loop, not progress.

use module::view::{Fragment, FragmentBuilder};

use crate::debug::turns::{Round, Turn};

/// A hash is an identity, not a number to read: enough of it to compare two
/// rounds by eye, and no more.
fn short(hash: &str) -> String {
    hash.chars().take(12).collect()
}

/// What one round did, as its heading. A part that has nothing to say is left
/// out rather than printed as a nought: `0 tokens` reads as free and
/// `document not recorded` reads as a fault, and neither is what an endpoint
/// that reports no usage means.
fn heading(n: usize, one: &Round) -> String {
    let did = match one.tools.is_empty() {
        true => "prose, no tool called".to_string(),
        false => format!("called {}", one.tools.join(", ")),
    };
    // WHICH STAGE SPENT IT. Without this, round 1 of a routed turn — the vote,
    // which never reaches the conversation — reads as an answer the person
    // somehow missed.
    let stage = match one.stage.is_empty() {
        true => String::new(),
        false => format!(" · {}", one.stage),
    };
    let spent = match one.spent {
        0 => String::new(),
        n => format!(" · {n} tokens"),
    };
    let sent = match one.hash.is_empty() {
        true => String::new(),
        false => format!(" · document {}", short(&one.hash)),
    };
    format!("round {n}{stage} · {did}{spent}{sent}")
}

/// One round. The model's own text is shown ONLY for a round that called a
/// tool: that is the half nothing draws. The answering round's text has a home
/// — the Chat pane — and a second copy of it here would be the duplication
/// this product's one-panel-one-home rule exists to prevent.
pub(crate) fn round(n: usize, one: &Round) -> Fragment {
    let block = FragmentBuilder::new("div")
        .class("debug-round")
        .attr("data-round", &n.to_string())
        .attr("data-tools", &one.tools.len().to_string())
        .attr("data-at", &one.at.to_string())
        .child(FragmentBuilder::new("p").class("debug-round-head").text(&heading(n, one)).build());
    match one.tools.is_empty() {
        true => block.build(),
        false => block
            .child(
                FragmentBuilder::new("pre")
                    .attr("tabindex", "0")
                    .attr("role", "region")
                    .attr("aria-label", &format!("what the model said in round {n}"))
                    .text(&one.text)
                    .build(),
            )
            .build(),
    }
}

/// WHAT WENT WRONG INSIDE THE TURN — every refused or failed tool call, kept
/// together and after the rounds, so a person scanning a turn meets the cost
/// and then the damage rather than hunting for a red row in a list.
pub(crate) fn broke(turn: &Turn) -> Vec<Fragment> {
    turn.failures
        .iter()
        .map(|(tool, said)| {
            FragmentBuilder::new("p")
                .class("error debug-fail")
                .text(&format!("{tool} failed — {said}"))
                .build()
        })
        .collect()
}
