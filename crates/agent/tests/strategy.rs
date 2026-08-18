//! THE STRATEGY LOOP, through `step` and against the real shipped `main`.
//!
//! What a route DOES is a sequence of effects a turn produces, so every
//! assertion here drives the machine rather than calling `route_of` and
//! believing it. A unit test of the parser could pass while the turn it steers
//! ended in the wrong place, which is the failure this file exists to catch.

use agent::{
    adopt_spec, parse_agent_file, step, AgentState, Effect, Route, STAGE_ANSWER, STAGE_STRATEGY,
};
use kernel::{Event, EventId, EventKind, Timestamp};

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const AT: Timestamp = Timestamp(1_753_800_000_000);

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: AT, kind }
}

fn user(text: &str) -> Event {
    ev(EventKind::UserMessage {
        text: text.into(),
        agent: String::new(),
        from: String::new(),
    })
}

fn replied(text: &str) -> Event {
    ev(EventKind::ModelReplied { text: text.into(), agent: String::new() })
}

/// The shipped agent, mid-turn, having just voted.
fn voted(vote: &str) -> (AgentState, Vec<Effect>) {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    let (state, _) = step(state, user("do the thing"));
    step(state, replied(vote))
}

fn stage_facts(effects: &[Effect]) -> Vec<String> {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
                if kind == agent::STAGE_ENTERED =>
            {
                Some(agent::stage_of(payload_json))
            }
            _ => None,
        })
        .collect()
}

/// THE TURN OPENS ON THE VOTE. `main` declares one stage and it does no work:
/// the first call of every turn asks how much turn this message deserves.
#[test]
fn a_turn_opens_by_asking_which_loop_to_run() {
    let spec = parse_agent_file("main", MAIN).expect("main parses");
    assert_eq!(spec.stages, [STAGE_STRATEGY], "the shipped file declares the vote");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    let (state, effects) = step(state, user("hello"));
    assert_eq!(stage_facts(&effects), ["strategy"]);
    assert_eq!(agent::current_stage(&state), STAGE_STRATEGY);
}

/// EACH VOTE INSTALLS ITS OWN LOOP, and the loop is what the rest of the turn
/// walks. The three routes are the three shapes of request a person has.
#[test]
fn each_route_installs_the_loop_it_named() {
    for (vote, expected) in [
        ("ROUTE: answer\nWHY: it is a greeting", vec![STAGE_ANSWER]),
        ("ROUTE: react\nWHY: needs a search", vec!["work"]),
        (
            "ROUTE: project\nWHY: something to build",
            vec!["plan", "work", "verify", "critique"],
        ),
    ] {
        let (state, effects) = voted(vote);
        assert_eq!(state.stages, expected, "vote {vote:?}");
        // …and the turn is already IN the first stage of it, with the call made.
        assert_eq!(stage_facts(&effects), [expected[0].to_string()]);
        assert!(
            effects.iter().any(|e| matches!(e, Effect::CallModel { .. })),
            "the chosen loop is entered, not merely recorded: {effects:?}"
        );
    }
}

/// THE VOTE IS NOT A TURN, so it is not written down as one. Putting
/// `assistant: ROUTE: project` in the conversation would show the person a
/// reply they were never given, and would leave the model reading its own
/// routing decision back as context on every turn after it.
#[test]
fn the_vote_never_enters_the_conversation() {
    let (state, _) = voted("ROUTE: project\nWHY: something to build");
    let window = agent::window(&state.paper);
    assert!(
        !window.iter().any(|line| line.contains("ROUTE")),
        "the vote is a decision about the turn, not a turn: {window:?}"
    );
    assert!(
        window.iter().any(|line| line.contains("do the thing")),
        "…and what the person actually said is still there: {window:?}"
    );
}

/// AN UNREADABLE VOTE IS `react`, AND THAT DIRECTION IS DELIBERATE. React is
/// the only route that can still reach either outcome — it can answer in prose
/// on its first call and it can call tools until it is done. Failing to
/// `answer` would strand a request that needed a tool; failing to `project`
/// would bill four calls for a greeting.
#[test]
fn an_unreadable_vote_lands_in_the_middle_route() {
    for reply in [
        "I think this one needs a web search first.", // answered instead of voting
        "ROUTE: whatever",                            // not one of the three
        "",                                           // said nothing
        "route: answer",                              // the word, but not the line
    ] {
        assert_eq!(agent::vote_of(reply), Route::React, "reply {reply:?}");
    }
    // …and the three that ARE votes are read, punctuation and emphasis included:
    // a small local model writes `**ROUTE:** project.` often enough to matter.
    assert_eq!(agent::vote_of("ROUTE: answer"), Route::Answer);
    assert_eq!(agent::vote_of("ROUTE: Project."), Route::Project);
    assert_eq!(agent::vote_of("ROUTE: `react`"), Route::React);
}

/// THE `answer` ROUTE CANNOT ACT, and it is enforced rather than announced —
/// the `engine: base` lesson (19). The vote said this needs no tool; a stage
/// still shown the toolbox would reach for one, and the vote would have been
/// worth nothing.
#[test]
fn the_answer_route_is_shown_no_tools() {
    let (_, effects) = voted("ROUTE: answer\nWHY: it is a greeting");
    let Some(Effect::CallModel { document, .. }) = effects.iter().find(|e| {
        matches!(e, Effect::CallModel { .. })
    }) else {
        panic!("expected the answering call: {effects:?}");
    };
    let sent = format!("{document:?}");
    assert!(sent.contains("No tools are installed"), "the answer route offers nothing");
    assert!(!sent.contains("exec("), "…and cannot reach the shell");
}

/// A NEW MESSAGE STARTS FROM THE DECLARATION, NOT FROM THE LAST ROUTE. The
/// second message of a conversation must be voted on afresh: without the
/// separate `declared` list, a greeting arriving after a project would still be
/// walking plan → work → verify → critique.
#[test]
fn the_next_message_is_voted_on_again() {
    // A turn taken all the way to its end, so the next message is a new TURN
    // and not a steer into this one.
    let (state, _) = voted("ROUTE: answer\nWHY: it is a greeting");
    assert_eq!(state.stages, [STAGE_ANSWER]);
    let (state, _) = step(state, replied("Hello — what would you like to do?"));
    let (state, effects) = step(state, user("now build me a script that sorts a file"));
    assert_eq!(state.stages, [STAGE_STRATEGY], "back to the declared list");
    assert_eq!(stage_facts(&effects), ["strategy"]);
    // …and this one can vote its way to the long loop, which is the whole
    // point of asking again rather than inheriting.
    let (state, _) = step(state, replied("ROUTE: project\nWHY: it asks for a script"));
    assert_eq!(state.stages, ["plan", "work", "verify", "critique"]);
}

/// THE ROUTE IS A FACT, because a turn that silently became four calls instead
/// of one is a thing only the bill explains otherwise (I8). It carries the WHY
/// with it: the vote alone says the machine chose, and the clause says what it
/// chose on.
#[test]
fn the_chosen_route_is_recorded_with_its_reason() {
    let (_, effects) = voted("ROUTE: project\nWHY: it asks for a working script");
    let found = effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } }
            if kind == agent::ROUTE_CHOSEN =>
        {
            Some(agent::route_of(payload_json))
        }
        _ => None,
    });
    assert_eq!(
        found,
        Some(("project".into(), "it asks for a working script".into())),
        "the route and what decided it: {effects:?}"
    );
}

/// THE PLAN STAGE'S TOOL RESULT COMES BACK TO THE PLAN STAGE.
///
/// `plan` is granted the skill tools so its brief's "read the ones that apply"
/// is real. That makes it the first toolless-by-default stage that can produce
/// a tool call, so the round-trip has to work there too: the call runs, the
/// result lands in `## observations`, and the SAME stage is asked again with it.
/// A result that arrived after the stage had moved on would be instruction
/// pulled in for a stage that no longer needed it.
#[test]
fn a_skill_read_in_the_plan_stage_comes_back_to_the_plan_stage() {
    let (state, _) = voted("ROUTE: project\nWHY: something to build");
    assert_eq!(agent::current_stage(&state), "plan");
    let (state, effects) = step(state, replied("list_skills({})"));
    // `list_skills` is PURE, so `step` answers it itself and emits the result
    // rather than asking the runtime to run it. The runtime appends that fact
    // and steps again, which is what this does.
    let Some(Effect::Emit { kind }) = effects.first() else {
        panic!("the plan stage's call is answered: {effects:?}");
    };
    assert!(matches!(kind, EventKind::ToolInvoked { .. }), "{kind:?}");
    let (state, effects) = step(state, ev(kind.clone()));
    assert_eq!(agent::current_stage(&state), "plan", "still planning");
    let Some(Effect::CallModel { document, .. }) =
        effects.iter().find(|e| matches!(e, Effect::CallModel { .. }))
    else {
        panic!("the plan stage is asked again with what it read: {effects:?}");
    };
    let sent = format!("{document:?}");
    assert!(sent.contains("agent-file"), "the skill listing is in the paper: {sent}");
    assert!(sent.contains("OUTCOME"), "…under the plan brief, still");
}
