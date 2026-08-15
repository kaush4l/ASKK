//! THE LOOP AN AGENT FILE DECLARES (increment 20), asserted through `step` —
//! so what is pinned is the sequence of effects a real turn produces, not the
//! cursor arithmetic underneath it. Host-only, like every other agent test:
//! `step` is pure, and a stage is one more instruction and one more call.

use agent::{parse_agent_file, step, AgentState, Effect};
use kernel::{Event, EventId, EventKind, Timestamp};

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const SCOUT: &str = include_str!("../../../public/agents/scout/agent.md");
const SUMMARIZER: &str = include_str!("../../../public/agents/summarizer/agent.md");
/// The manifest itself, so the collision below is checked against what the app
/// would actually FETCH rather than against whatever folders happen to exist.
const INDEX: &str = include_str!("../../../public/agents/index.json");

fn ev(kind: EventKind) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    }
}

fn user(text: &str) -> Event {
    ev(EventKind::UserMessage {
        text: text.into(),
        agent: String::new(),
        from: String::new(),
    })
}

fn replied(text: &str) -> Event {
    ev(EventKind::ModelReplied {
        text: text.into(),
        agent: String::new(),
    })
}

fn staged(stages: &[&str]) -> AgentState {
    let mut state = AgentState::new();
    state.stages = stages.iter().map(|s| (*s).to_string()).collect();
    state
}

fn is_stage_fact(effect: &Effect) -> Option<String> {
    match effect {
        Effect::Emit {
            kind: EventKind::Custom { kind, payload_json },
        } if kind == agent::STAGE_ENTERED => Some(agent::stage_of(payload_json)),
        _ => None,
    }
}

/// THE SHIPPED FILES DECLARE IT. The point of the increment is that the loop
/// is in the agents folder, so the assertion is against the real files rather
/// than a fixture — a stage list deleted from `main` fails here.
#[test]
fn the_shipped_files_carry_the_roles_and_the_loop() {
    let main = parse_agent_file("main", MAIN).expect("main parses");
    assert_eq!(main.role, agent::ROLE_ENTRY, "the core looks this up, not the name `main`");
    assert_eq!(main.stages, ["plan", "work", "verify"]);
    let scout = parse_agent_file("scout", SCOUT).expect("scout parses");
    assert_eq!(scout.stages, ["plan", "work", "critique"]);
    let summarizer = parse_agent_file("summarizer", SUMMARIZER).expect("summarizer parses");
    assert_eq!(summarizer.role, agent::ROLE_SUMMARIZER);
    assert!(summarizer.stages.is_empty(), "one reply; there is no loop to declare");
    // …and the job is found by the declaration (`loader::role_holder`).
    let all = [summarizer.clone(), main.clone()];
    assert_eq!(agent::role_holder(&all, agent::ROLE_ENTRY).map(|s| &s.name), Some(&main.name));
    assert_eq!(
        agent::role_holder(&all, agent::ROLE_SUMMARIZER).map(|s| &s.name),
        Some(&summarizer.name)
    );
}

/// NO AGENT IS NAMED AFTER A STAGE (21). One agent was called `plan` while the
/// first stage of the loop is also called `plan`, so the roster and the
/// conversation used one word for two different things — and a rename that no
/// test would catch is a rename that comes back the next time somebody wants a
/// planning agent. The manifest is the directory listing (a static host cannot
/// list a folder), so the manifest is what this reads.
#[test]
fn no_shipped_agent_is_named_after_a_stage() {
    let index: serde_json::Value = serde_json::from_str(INDEX).expect("the manifest parses");
    let names = index["agents"].as_array().expect("agents is a list");
    assert!(!names.is_empty());
    for name in names {
        let name = name.as_str().expect("a name is a string");
        assert!(
            !agent::is_stage(name),
            "the agent `{name}` shares its name with a stage of the loop"
        );
    }
}

/// A DECLARED STAGE OPENS WITH ITS INSTRUCTION AND SAYS SO. The turn starts
/// with the plan stage's brief in the window and one fact in the log naming it
/// — a round the machine added that no projection could see would be a model
/// talking to itself (the `VERIFY_NUDGED` rule, 19).
#[test]
fn a_turn_opens_on_the_first_declared_stage() {
    let (_, effects) = step(staged(&["plan", "work"]), user("add a health check"));
    assert_eq!(effects.len(), 2, "the stage fact, then the call");
    assert_eq!(is_stage_fact(&effects[0]).as_deref(), Some("plan"));
    let Effect::CallModel { document, .. } = &effects[1] else {
        panic!("expected the call, got {effects:?}");
    };
    let text = format!("{document:?}");
    assert!(text.contains("OUTCOME"), "the plan brief is in the paper");
    assert!(text.contains("add a health check"), "…and so is the request");
}

/// PROSE FROM A STAGE THAT IS NOT THE LAST DOES NOT END THE TURN. It moves
/// the cursor on and asks again — which is the entire stage machine.
#[test]
fn prose_advances_the_stage_instead_of_ending_the_turn() {
    let (state, _) = step(staged(&["plan", "work"]), user("add a health check"));
    let (state, effects) = step(state, replied("OUTCOME: /health answers 200."));
    assert_eq!(is_stage_fact(&effects[0]).as_deref(), Some("work"));
    assert!(
        matches!(effects[1], Effect::CallModel { .. }),
        "the work stage is asked, not ended: {effects:?}"
    );
    assert!(
        !effects.iter().any(|e| matches!(e, Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == agent::ENDED)),
        "nothing ended"
    );
    // …and the LAST stage's prose ends it the way it always has.
    let (_, effects) = step(state, replied("Done — /health answers 200."));
    assert!(
        effects.iter().any(|e| matches!(e, Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == agent::ENDED)),
        "the last stage ends the turn: {effects:?}"
    );
}

/// THE TOOLLESS STAGES ARE TOOLLESS, AND IT IS ENFORCED. `plan` is told in
/// words to call nothing; this asserts the model is not even shown the tools,
/// which is what `engine: base` taught (19) — a described capability that is
/// not enforced is a setting that looks applied.
#[test]
fn a_toolless_stage_is_shown_no_tools() {
    let mut state = staged(&["plan", "work"]);
    state.toolbox = agent::builtin_tools();
    let (state, effects) = step(state, user("what is the time"));
    let Effect::CallModel { document, .. } = &effects[1] else {
        panic!("expected the call");
    };
    assert!(!format!("{document:?}").contains("now("), "plan may call nothing");
    // …and the work stage, one reply later, is shown them again.
    let (_, effects) = step(state, replied("OUTCOME: the user learns the time."));
    let Effect::CallModel { document, .. } = &effects[1] else {
        panic!("expected the call");
    };
    assert!(format!("{document:?}").contains("now("), "work may act");
}

/// AN AGENT WITH NO `stages:` RUNS EXACTLY WHAT IT RAN BEFORE. One call out,
/// one ending back — the whole compatibility promise, in one test.
#[test]
fn no_stages_is_the_turn_this_build_always_took() {
    let (state, effects) = step(AgentState::new(), user("hello"));
    assert_eq!(effects.len(), 1, "no stage fact: {effects:?}");
    let (_, effects) = step(state, replied("Hello."));
    assert!(
        effects.iter().any(|e| matches!(e, Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == agent::ENDED)),
        "one reply ends the turn"
    );
}

/// A STAGE NAME THIS BUILD CANNOT WALK IS REFUSED, in both YAML forms, and so
/// is a list that could never act. `engine: reakt`'s rule (19): a key that
/// parses clean and selects nothing is worse than no key.
#[test]
fn an_unknown_or_actless_stage_list_is_refused() {
    let bad = [
        "---\nname: a\nstages: [plan, wrok]\n---\nbody",
        "---\nname: a\nstages:\n  - plan\n  - wrok\n---\nbody",
        "---\nname: a\nstages: [plan, critique]\n---\nbody",
        "---\nname: a\nstages: work\n---\nbody",
        "---\nname: a\nengine: base\nstages: [work]\n---\nbody",
        "---\nname: a\nrole: enrty\n---\nbody",
    ];
    for text in bad {
        assert!(parse_agent_file("a", text).is_err(), "should refuse: {text}");
    }
    // …and the shapes that ARE legal stay legal.
    let ok = parse_agent_file("a", "---\nname: a\nstages:\n  - plan\n  - work\n---\nbody")
        .expect("the block form parses");
    assert_eq!(ok.stages, ["plan", "work"]);
}

/// THE GATE AND THE STAGE DO NOT BOTH FIRE. A turn that wrote a file and
/// declared a verify stage used to be asked twice and print two notices saying
/// the same thing (browser walk, 20). The declaration wins.
#[test]
fn a_declared_verify_stage_replaces_the_nudge() {
    let start = staged(&["work", "verify"]);
    let (state, _) = step(start, user("write a file"));
    // The work stage writes something and nothing runs after it — exactly the
    // condition the mechanical gate holds an answer over.
    let (state, _) = step(
        state,
        ev(EventKind::ToolInvoked {
            tool: kernel::ToolId("write_file".into()),
            ok: true,
            output: "wrote check.txt".into(),
            args: String::new(),
        }),
    );
    let (_, effects) = step(state, replied("Done, I wrote it."));
    assert!(
        !effects.iter().any(|e| matches!(e, Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == agent::VERIFY_NUDGED)),
        "no nudge — the file's own verify stage is next: {effects:?}"
    );
    assert_eq!(is_stage_fact(&effects[0]).as_deref(), Some("verify"));
}
