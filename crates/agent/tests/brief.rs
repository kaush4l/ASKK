//! THE STAGE BRIEFS ARE FILES NOW — and the point of the increment is not that
//! they load, it is what happens when they do not. A brief that goes missing
//! must stop the stage, in words, rather than be quietly replaced by something
//! compiled in: a plan stage that writes no plan looks exactly like one that
//! ran, and that is the failure class this whole codebase refuses (`engine:
//! reakt`, `compact_at: lots`).
//!
//! Asserted through `step` wherever a turn is involved, like every other stage
//! test: what is pinned is the sequence of effects a real turn produces.

mod common;

use agent::{step, AgentState, Effect};
use context::{render, ContentPart, ProviderFormat, Role};
use kernel::{Event, EventId, EventKind, Timestamp};

const FMT: ProviderFormat = ProviderFormat::OpenAiChat { vision: false, audio: false };

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: Timestamp(1_753_800_000_000), kind }
}

fn user(text: &str) -> Event {
    ev(EventKind::UserMessage { text: text.into(), agent: String::new(), from: String::new() })
}

/// A state that declares a loop, with or without the words to walk it.
fn staged(stages: &[&str], briefed: bool) -> AgentState {
    let mut state = AgentState::new();
    state.declared = stages.iter().map(|s| (*s).to_string()).collect();
    state.stages = state.declared.clone();
    if briefed {
        common::brief(&mut state);
    }
    state
}

/// THE BYTES THE MODEL WAS ACTUALLY SENT — rendered, not the sections, because
/// a brief that reaches the paper and not the prompt is not a brief.
fn asked(effects: &[Effect]) -> String {
    let document = effects
        .iter()
        .find_map(|e| match e {
            Effect::CallModel { document, .. } => Some(document),
            _ => None,
        })
        .expect("the stage calls the model");
    let messages = render(document, FMT);
    assert_eq!(messages[0].role, Role::System, "the paper is the system turn");
    messages[0]
        .content
        .iter()
        .filter_map(|p| match p {
            ContentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn ended_why(effects: &[Effect]) -> Option<String> {
    effects.iter().find_map(|e| match e {
        Effect::Emit { kind: EventKind::Custom { kind, payload_json } } if kind == agent::ENDED => {
            Some(agent::ended_why(payload_json))
        }
        _ => None,
    })
}

fn notes(effects: &[Effect]) -> String {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::Emit { kind: EventKind::Custom { kind, payload_json } } if kind == "core.note" => {
                serde_json::from_str::<String>(payload_json).ok()
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// (a) The five files this repo ships are the five keys the machine knows, and
/// they load. A file deleted, renamed or emptied fails HERE rather than in a
/// browser three deploys later.
#[test]
fn the_shipped_briefs_load() {
    let briefs = common::shipped_briefs();
    assert!(!briefs.is_empty());
    assert_eq!(agent::BRIEF_KEYS.len(), 5);
    // …and every key is a stage the machine walks, or the durable paragraph.
    for key in agent::BRIEF_KEYS {
        assert!(agent::is_stage(key) || key == agent::BRIEF_DURABLE, "{key} answers to nothing");
    }
}

/// (b) A key that never arrived is refused with the FILE to fix in the message.
/// "verify is missing" is a fact about a program; `public/stages/verify.md` is
/// the sentence a person can act on.
#[test]
fn a_missing_brief_is_refused_by_the_file_a_person_must_add() {
    let short: Vec<(String, String)> = common::brief_pairs()
        .into_iter()
        .filter(|(k, _)| k != agent::STAGE_VERIFY)
        .collect();
    let err = agent::load_briefs(short).expect_err("a set missing a key is not a set");
    let agent::AgentError::MalformedBrief { key, message } = err else {
        panic!("a brief refuses as its own typed error")
    };
    assert_eq!(key, agent::STAGE_VERIFY);
    assert!(message.contains("public/stages/verify.md"), "{message}");
}

/// (c) A file that is there but says nothing is the same failure with better
/// manners — the stage would enter with an empty instruction and nobody would
/// know. Trimmed, because a file of blank lines is a file that says nothing.
#[test]
fn a_blank_brief_is_refused_like_a_missing_one() {
    let blanked: Vec<(String, String)> = common::brief_pairs()
        .into_iter()
        .map(|(k, t)| match k == agent::STAGE_PLAN {
            true => (k, "   \n\n \n".to_string()),
            false => (k, t),
        })
        .collect();
    let err = agent::load_briefs(blanked).expect_err("an empty brief is no brief");
    let agent::AgentError::MalformedBrief { key, message } = err else { panic!("typed") };
    assert_eq!(key, agent::STAGE_PLAN);
    assert!(message.contains("public/stages/plan.md"), "{message}");
}

/// (d) …and a key nothing reads is refused too. A `public/stages/review.md`
/// that loads clean and is never used is a file somebody will edit for an hour.
#[test]
fn a_key_no_stage_answers_to_is_refused() {
    let mut pairs = common::brief_pairs();
    pairs.push(("review".to_string(), "read it back".to_string()));
    let err = agent::load_briefs(pairs).expect_err("no stage is called review");
    let agent::AgentError::MalformedBrief { key, .. } = err else { panic!("typed") };
    assert_eq!(key, "review");
}

/// (e) THE LOUD ONE. A turn whose first stage has no brief does not take the
/// stage: no model call, an ending with its own kind, and a note naming the
/// file. Before this the words were compiled in and this state was impossible;
/// now it is a deploy that forgot a directory.
#[test]
fn a_stage_with_no_brief_ends_the_turn_instead_of_entering_it() {
    let state = staged(&[agent::STAGE_PLAN], false);
    let (state, effects) = step(state, user("build me a thing"));
    assert!(
        !effects.iter().any(|e| matches!(e, Effect::CallModel { .. })),
        "an unbriefed stage must not reach the model"
    );
    assert_eq!(ended_why(&effects).as_deref(), Some(agent::BRIEF_MISSING));
    let said = notes(&effects);
    assert!(said.contains("public/stages/plan.md"), "{said}");
    assert!(state.task.is_none(), "the turn ended");
}

/// …and the same refusal reaches a stage the turn walks INTO, not only the one
/// it opens on. The route the strategy vote installs is chosen mid-turn, so a
/// half-briefed deploy would otherwise fail four calls in.
#[test]
fn a_later_stage_with_no_brief_refuses_too() {
    let mut state = staged(&[agent::STAGE_WORK, agent::STAGE_CRITIQUE], false);
    state.task = Some("do it".into());
    let (_, effects) = step(
        state,
        ev(EventKind::ModelReplied { text: "done".into(), agent: String::new() }),
    );
    assert_eq!(ended_why(&effects).as_deref(), Some(agent::BRIEF_MISSING));
    assert!(notes(&effects).contains("public/stages/critique.md"));
}

/// (f) `work` and `answer` have NO brief by design — the person's own request
/// is the instruction, and a second one would compete with it. So they enter
/// with an empty directive and the block disappears, which is the behaviour
/// every agent had before stages existed.
#[test]
fn work_and_answer_enter_with_no_directive_at_all() {
    for stage in [agent::STAGE_WORK, agent::STAGE_ANSWER] {
        let state = staged(&[stage], false);
        let (_, effects) = step(state, user("hello"));
        assert!(ended_why(&effects).is_none(), "{stage} needs no brief");
        assert!(!asked(&effects).contains("## directive"), "{stage} writes no directive block");
    }
}

/// (g) THE DURABLE PARAGRAPH IS APPENDED, AND ONLY WHERE IT CAN BE ACTED ON.
/// It tells the model to call `remember`, which an agent with no space was
/// never granted — telling it to call a tool it does not have is noise in the
/// window. It is its own file because the alternative is core splitting
/// `plan.md` on a separator, which is core parsing a brief.
#[test]
fn the_durable_paragraph_is_appended_only_for_an_agent_with_a_space() {
    let with_space = {
        let mut state = staged(&[agent::STAGE_PLAN], true);
        state.space = agent::Space::named("research");
        assert!(state.space.is_some(), "the fixture needs a real space");
        let (_, effects) = step(state, user("build me a thing"));
        asked(&effects)
    };
    let without = {
        let state = staged(&[agent::STAGE_PLAN], true);
        let (_, effects) = step(state, user("build me a thing"));
        asked(&effects)
    };
    let durable = include_str!("../../../public/stages/durable.md").trim();
    assert!(with_space.contains(durable), "the space agent is told to write the goal down");
    assert!(!without.contains(durable), "the lone agent is not told to call `remember`");
    // Both carry the plan brief itself, and the appended one carries it FIRST.
    let plan = include_str!("../../../public/stages/plan.md").trim();
    assert!(without.contains(plan));
    assert!(with_space.contains(&format!("{plan}\n\n{durable}")), "joined by the appender");
}
