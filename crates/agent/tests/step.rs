//! agent test contract (MODULES/agent.md), G4 slice: the one Work-phase turn
//! as an effect-sequence golden — UserInput → CallModel → ModelReplied → done.

use agent::{step, AgentState, Effect};
use context::{validate, Part, ProviderFormat};
use kernel::{Event, EventId, EventKind, PhaseId, Timestamp};

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

/// The Work-turn effect sequence, asserted end to end.
#[test]
fn work_turn_user_message_to_call_model_to_reply() {
    // The agent's `model:` catalogue key rides out on the effect (increment
    // 04) — the adapter resolves it, nothing here knows a URL.
    let mut start = AgentState::new();
    start.model = "local".into();
    let (state, effects) = step(start, user("Hello there"));
    assert_eq!(state.phase, PhaseId::Work);
    assert_eq!(state.task.as_deref(), Some("Hello there"));
    assert_eq!(effects.len(), 1, "one coarse effect per turn (§1c)");
    let Effect::CallModel {
        document,
        format,
        endpoint,
        model,
        ..
    } = &effects[0]
    else {
        panic!("expected CallModel, got {effects:?}");
    };
    assert_eq!(endpoint.0, "model");
    assert_eq!(model, "local", "the catalogue key the agent file named");
    assert_eq!(
        *format,
        ProviderFormat::OpenAiChat {
            vision: false,
            audio: false
        }
    );
    // The document is a real, law-abiding paper carrying the task: the nine
    // standing blocks plus `directive`, Elided on a turn with no stage
    // instruction and so reaching the model as nothing at all.
    validate(document).unwrap();
    assert_eq!(document.sections.len(), 10);
    let directive = document.sections.iter().find(|s| s.id.0 == "directive").unwrap();
    assert_eq!(directive.fidelity, context::Fidelity::Elided, "no brief, no block");
    // `space` is not merely empty — it is ABSENT (increment 27). It used to be
    // seeded for every agent and render Elided for the ones that named none;
    // it is a FACULTY's block now, so an agent that declared no faculty never
    // has the section at all. The bytes are the same either way, which is what
    // made the migration safe; the paper is one section honester.
    assert!(
        !document.sections.iter().any(|s| s.id.0 == "space"),
        "no faculty declared it, so nothing reserved it a place"
    );
    let task = document.sections.iter().find(|s| s.id.0 == "task").unwrap();
    assert!(matches!(&task.parts[0], Part::Text { text } if text == "Hello there"));

    // The reply ends the turn: history records it, and the ONE effect is the
    // ending fact saying the turn was answered (R17-P0-2).
    let (state, effects) = step(
        state,
        ev(EventKind::ModelReplied {
            text: "Hi. What should we do first?".into(),
            agent: String::new(),
        }),
    );
    assert!(
        matches!(effects.as_slice(), [Effect::Emit { .. }]),
        "Answer contract ends the turn, saying so: {effects:?}"
    );
    assert_eq!(state.task, None);
    let history = state
        .paper
        .sources
        .iter()
        .find(|s| s.section.id.0 == "history")
        .unwrap();
    let joined: String = history
        .section
        .parts
        .iter()
        .filter_map(|p| match p {
            Part::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(joined.contains("user: Hello there"));
    assert!(joined.contains("assistant: Hi. What should we do first?"));
}

/// (4) step determinism: same state + event ⇒ same (state, effects).
#[test]
fn step_is_deterministic() {
    let a = step(AgentState::new(), user("same input"));
    let b = step(AgentState::new(), user("same input"));
    assert_eq!(a, b);
}

/// Events the machine does not consume leave it quiescent and unchanged.
#[test]
fn unconsumed_events_are_quiescent() {
    let before = AgentState::new();
    let (after, effects) = step(
        before.clone(),
        ev(EventKind::RequestHandled {
            path: "/".into(),
            status: 200,
        }),
    );
    assert!(effects.is_empty());
    assert_eq!(before, after);
}
