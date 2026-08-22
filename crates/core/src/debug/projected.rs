//! THE FOLD'S OWN TESTS, in a file of their own because `turns.rs` is at I12's
//! ceiling with them in it. `#[path]`-included so they stay a child module of
//! the thing they test and can reach its `pub(crate)` surface.

use super::*;

/// A `Ctx` holding nothing but a log — every other field is the absence it
/// would have in a test that granted no capability (ADR-006). The fold is a
/// pure function of `recent`/`at`, so this is the whole of its input.
fn ctx(recent: Vec<EventKind>) -> Ctx {
    let at = (0..recent.len()).map(|n| 1_753_800_000_000 + n as i64).collect();
    Ctx {
        wipe: false,
        kv: None,
        clock: None,
        emit: None,
        recent,
        at,
        running: Vec::new(),
        calling: Vec::new(),
        interrupt: kernel::Interrupt::None,
        queued: Vec::new(),
        agents: Vec::new(),
        agent_problems: Vec::new(),
        resolved_models: Vec::new(),
        authored: Vec::new(),
        board: Vec::new(),
        me: "main".to_string(),
        window: Vec::new(),
        space: None,
        durable: false,
        booted: 0,
        writership: crate::log::writership::Writership::default(),
    }
}

fn said(recent: Vec<EventKind>) -> String {
    let mut opening = vec![EventKind::UserMessage {
        text: "go".into(),
        agent: String::new(),
        from: String::new(),
    }];
    opening.extend(recent);
    crate::debug::render::panel(&ctx(opening), "main").0
}

/// `PhaseEntered` — a variant of the closed vocabulary with zero readers in
/// the tree. It has one now. Consecutive repeats fold, because what is worth
/// reading is the walk and not the count.
///
/// UNPINNABLE END TO END, AND SAID SO (I17): NOTHING IN THIS BUILD EMITS
/// THIS FACT. `runtime::pump` appends it only when `app.agent.phase` moves,
/// and `agent::AgentState::phase` is never reassigned anywhere in `crates/
/// agent` — the stage machine replaced the phase machine and left the field
/// behind. So this test drives the projection with facts it constructs, and
/// no integration test can reach it: the machine fact that would settle it
/// is an assignment to `state.phase` that does not exist.
#[test]
fn the_phase_machine_is_drawn_when_the_machine_moves() {
    let walked = said(vec![
        EventKind::PhaseEntered { phase: kernel::PhaseId::Work },
        EventKind::PhaseEntered { phase: kernel::PhaseId::Work },
        EventKind::PhaseEntered { phase: kernel::PhaseId::Verify },
    ]);
    assert!(walked.contains("phase machine: work → verify"), "{walked}");
}

/// `ModelCalled::document_hash` and its cost, on the reply that call
/// produced — the pairing `effects.rs` orders the two facts for.
#[test]
fn a_calls_cost_and_document_land_on_the_reply_it_produced() {
    let round = said(vec![
        EventKind::ModelCalled {
            document_hash: "abc123def4567890".into(),
            spent_tokens: 512,
        },
        EventKind::ModelReplied {
            text: "First I look.\nread_file({\"path\": \"a\"})".into(),
            agent: String::new(),
        },
    ]);
    assert!(round.contains("512 tokens"), "the cost is not on the round: {round}");
    assert!(round.contains("document abc123def456"), "the hash has no reader: {round}");
    assert!(round.contains("called read_file"), "what it called is missing: {round}");
    assert!(round.contains("First I look."), "the model's working is missing: {round}");
}

/// …AND THE ANSWER IS NOT COPIED HERE. The prose reply has a home — the
/// conversation — and a debug pane that reprinted it would be the second
/// copy this product's one-panel-one-home rule exists to prevent.
#[test]
fn the_answering_round_is_counted_but_its_text_is_left_to_chat() {
    let round = said(vec![EventKind::ModelReplied {
        text: "The answer is 4.".into(),
        agent: String::new(),
    }]);
    assert!(round.contains("round 1"), "the round is not counted: {round}");
    assert!(!round.contains("The answer is 4."), "the answer is copied here: {round}");
}
