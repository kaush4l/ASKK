//! Compaction as a TURN: a call the machine makes on its own sheet, whose reply
//! is recorded as the summarizer's words and never as this agent's answer. The
//! environment block is rebuilt from the injected clock every time. Split from
//! `window.rs` (the pure arithmetic) for the 200-line rule (I12).

use agent::{
    adopt_spec, environment, set_window, step, window, AgentSpec, AgentState, Effect,
    SUMMARY_HEADING,
};
use kernel::{Event, EventId, EventKind, Timestamp};

const AT: Timestamp = Timestamp(1_753_800_000_000);

fn spec(name: &str, prompt: &str, compact_at: usize, keep: usize) -> AgentSpec {
    AgentSpec {
        name: name.into(),
        description: format!("{name} does a thing"),
        model: format!("model-{name}"),
        temperature: None,
        engine: "react".into(),
        role: String::new(),
        stages: Vec::new(),
        faculties: Vec::new(),
        tools: vec![],
        space: String::new(),
        compact_at,
        keep_recent: keep,
        max_rounds: 64,
        passes: 1,
        goal: agent::Goal::default(),
        prompt: prompt.into(),
    }
}

fn user(text: &str, at: Timestamp) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at,
        kind: EventKind::UserMessage {
            text: text.into(),
            agent: String::new(),
            from: String::new(),
        },
    }
}

fn reply(text: &str, at: Timestamp) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at,
        kind: EventKind::ModelReplied {
            text: text.into(),
            agent: String::new(),
        },
    }
}

/// THE SUMMARIZER IS A SHEET, NOT AN AGENT. It used to be a whole `agent.md`
/// in `public/agents/`, found by the `role:` it declared and carried in three
/// fields of every other agent's state — and a build that shipped without it
/// stopped compacting and said nothing. What that file contributed was a system
/// prompt, so the prompt is `agent::SUMMARIZE`, the call runs on this agent's
/// own model, and there is nothing left to be missing.
///
/// What has NOT changed is the part that matters: the compaction call is not
/// steered by the caller's prompt, and its reply is recorded as the
/// summarizer's words rather than as this agent's answer.
#[test]
fn compaction_is_a_turn_taken_on_the_summarizers_own_sheet() {
    let peers = vec![spec("main", "you are main", 4, 2)];
    let mut state = AgentState::new();
    adopt_spec(&mut state, &peers[0], &peers);
    set_window(
        &mut state.paper,
        &["user: a".into(), "assistant: b".into(), "user: c".into()],
        AT,
    );

    let (state, effects) = step(state, user("and now this", AT));
    let Some(Effect::CallModel { document, model, speaker, .. }) = effects.first() else {
        panic!("expected one model call, got {effects:?}");
    };
    assert_eq!(speaker, "summarizer", "the reply belongs to the summarizer");
    assert_eq!(model, "model-main", "one agent, one endpoint");
    let sent = format!("{document:?}");
    assert!(sent.contains(agent::SUMMARIZE), "the sheet's own prompt steers it");
    assert!(!sent.contains("you are main"), "and the caller's does not: {sent}");
    assert!(state.compacting, "the next reply is the summary, not an answer");

    // The summary comes back: it replaces the window, and only THEN is the
    // turn the person asked for taken.
    let (state, effects) = step(state, reply("NOTES", AT));
    assert!(!state.compacting);
    assert_eq!(state.compactions, 1, "the log owes a rewrite");
    assert_eq!(
        window(&state.paper),
        vec![
            format!("system: {SUMMARY_HEADING}\nNOTES"),
            "user: c".to_string(),
            "user: and now this".to_string(),
        ],
        "the question just asked is still in the window it is answered from"
    );
    let Some(Effect::CallModel { speaker, model, .. }) = effects.first() else {
        panic!("expected the real turn, got {effects:?}");
    };
    assert_eq!(speaker, "", "this one IS this agent's own turn");
    assert_eq!(model, "model-main");
}

/// "A cached clock is a wrong clock." The CONTEXT block is rebuilt from the
/// injected timestamp on every call, so nothing stale survives into a later
/// turn — and because the timestamp is injected it is still deterministic.
#[test]
fn the_context_block_is_assembled_fresh_for_every_request() {
    let first = Timestamp(1_753_800_000_000); // 2025-07-29 14:40:00 UTC, Tuesday
    let later = Timestamp(1_753_886_461_000); // a day and a minute after
    assert_eq!(
        environment(first),
        "current time: 2025-07-29 14:40:00 UTC\nday: Tuesday\ndevice: a browser tab."
    );
    assert_eq!(
        environment(later),
        "current time: 2025-07-30 14:41:01 UTC\nday: Wednesday\ndevice: a browser tab."
    );

    let (state, effects) = step(AgentState::new(), user("first", first));
    let sent = format!("{:?}", effects.first().expect("a call"));
    assert!(sent.contains("2025-07-29 14:40:00"), "this turn's clock: {sent}");

    // The first turn ENDS before the second question: a user message while a
    // turn is still running is steering, and steering emits no call at all.
    let (state, _) = step(state, reply("done", first));
    let (_, effects) = step(state, user("second", later));
    let sent = format!("{:?}", effects.first().expect("a call"));
    assert!(sent.contains("2025-07-30 14:41:01"), "the NEW clock: {sent}");
    assert!(
        !sent.contains("2025-07-29 14:40:00"),
        "and not a stale one left over from the last turn: {sent}"
    );
}
