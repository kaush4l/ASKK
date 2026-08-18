//! THE CRITIC AS AN AGENT, NOT AS A STAGE (increment 25).
//!
//! Two things are asserted here and they are the whole increment. First: the
//! shipped `critic` file can read and cannot change, run, start or delegate
//! anything — by ALLOWLIST, so a call is refused at dispatch rather than
//! depending on the model having believed its own prompt. Second: a caller
//! cannot report a turn as `answered` over a verdict that was not a pass.
//!
//! Host-only, through the pure `step`: what is pinned is the ending a real turn
//! produces, not the predicate underneath it.

use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

use agent::{adopt_spec, ended_why, parse_agent_file, step, AgentState, Effect};

const CRITIC: &str = include_str!("agents/critic.md");
const BUILDER: &str = include_str!("agents/builder.md");
const INDEX: &str = include_str!("../../../public/agents/index.json");

/// A caller that may call the critic, cut to the bone.
const CALLER: &str = "---\nname: lead\ndescription: d\nmodel: local\nspace: research\n\
                      tools: [exec, write_file, critic]\n---\nbody";

fn ev(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: Timestamp(1_753_800_000_000), kind }
}

fn said(text: &str) -> Event {
    ev(EventKind::ModelReplied { text: text.into(), agent: String::new() })
}

fn came_back(tool: &str, ok: bool, output: &str) -> Event {
    ev(EventKind::ToolInvoked {
        tool: ToolId(tool.into()),
        args: "{\"query\": \"review this\"}".into(),
        ok,
        output: output.into(),
    })
}

/// A caller mid-turn, with the shipped critic among its peers.
fn caller(file: &str) -> AgentState {
    let spec = parse_agent_file("lead", file).expect("the caller parses");
    let critic = parse_agent_file("critic", CRITIC).expect("critic parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[critic]);
    step(
        state,
        ev(EventKind::UserMessage {
            text: "write notes.md".into(),
            agent: String::new(),
            from: String::new(),
        }),
    )
    .0
}

fn ending(effects: &[Effect]) -> String {
    let Some(Effect::Emit { kind: EventKind::Custom { payload_json, .. } }) = effects
        .iter()
        .find(|e| matches!(e, Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == agent::ENDED))
    else {
        panic!("no ending in {effects:?}");
    };
    ended_why(payload_json)
}

/// One turn: write a file, run the check, ask the critic, answer.
fn reviewed(verdict: &str, ok: bool) -> String {
    let state = caller(CALLER);
    let state = step(state, said("write_file({\"path\": \"notes.md\"})")).0;
    let state = step(state, came_back("write_file", true, "wrote notes.md")).0;
    let state = step(state, said("exec({\"command\": \"cat notes.md\"})")).0;
    let state = step(state, came_back("exec", true, "hello")).0;
    let state = step(state, said("critic({\"query\": \"I wrote notes.md; cat printed hello\"})")).0;
    let state = step(state, came_back("critic", ok, verdict)).0;
    ending(&step(state, said("Done — notes.md is written and reads back.")).1)
}

/// THE SHIPPED FILE IS READ-ONLY BY ALLOWLIST. Every name it grants reads and
/// nothing else — no shell, no write, no process, no space write, and no other
/// agent, so it cannot delegate its way around any of them.
#[test]
fn the_shipped_critic_can_read_and_can_change_nothing() {
    let critic = parse_agent_file("critic", CRITIC).expect("critic parses");
    assert_eq!(critic.role, agent::ROLE_CRITIC, "the machine looks the role up, not the name");
    assert_eq!(critic.tools, ["read_file", "list_files", "find_files"]);
    assert_eq!(critic.engine, agent::ENGINE_REACT);
    // The peers include everything it could name, so a granted tool here would
    // be a real capability and not an unresolved word.
    let peers: Vec<agent::AgentSpec> = [("builder", BUILDER)]
        .iter()
        .map(|(d, t)| parse_agent_file(d, t).expect("peer parses"))
        .collect();
    let box_ = agent::toolbox_for(&critic, &peers);
    let granted: Vec<&str> = box_.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(granted, ["read_file", "list_files", "find_files"], "the allowlist IS the mode");
    for forbidden in [
        "exec", "write_file", "write_agent", "start_process", "stop_process", "remember",
        "forget", "post_note", "web_search", "builder",
    ] {
        assert!(!granted.contains(&forbidden), "the critic must not be granted `{forbidden}`");
    }
    assert!(box_.tools.iter().all(|t| !t.agent), "a critic that can delegate is not read-only");
    // …AND NOTHING SHIPS IT ANY MORE. The reviewer is the `critique` stage now:
    // one call in the same window instead of a second agent, a second Worker
    // and a second model to load, for a reading of the turn that is the same
    // model's either way. The machinery below it — `role: critic`, the verdict
    // fold, the ending a fault earns — is all still here and still tested
    // against this fixture, because an agent installed in a browser can hold
    // the role. The manifest names one agent, and that is the design.
    let index: serde_json::Value = serde_json::from_str(INDEX).expect("the manifest parses");
    let names = index["agents"].as_array().expect("agents is a list");
    assert_eq!(names.len(), 1, "one agent ships: {names:?}");
    assert_eq!(names[0].as_str(), Some("main"));
}

/// AND IT IS NOT THE `critique` STAGE. The stage is the same model in the same
/// window; this is a separate agent. The two must not be confused into one, so
/// the file that ships the reviewer declares no stage list of its own, and the
/// agent that calls it does not run the stage.
#[test]
fn the_reviewer_is_a_different_agent_and_not_the_critique_stage() {
    let critic = parse_agent_file("critic", CRITIC).expect("critic parses");
    assert!(critic.stages.is_empty(), "one goal, one review; there is no loop to declare");
    assert_ne!(critic.name, agent::STAGE_CRITIQUE, "the agent and the stage are two things");
    let builder = parse_agent_file("builder", BUILDER).expect("builder parses");
    assert!(builder.tools.contains(&"critic".to_string()), "the builder can call it");
    assert!(
        !builder.stages.contains(&agent::STAGE_CRITIQUE.to_string()),
        "the builder marks no homework of its own; it hands the work to the critic"
    );
}

/// THE VERDICT DECIDES THE ENDING, AND THE CALLER'S OWN PROSE DOES NOT. Same
/// turn, same confident answer, three different verdicts.
#[test]
fn a_turn_the_critic_did_not_clear_is_not_a_turn_that_answered() {
    assert_eq!(reviewed("PASS\nnotes.md exists and cat printed it.", true), agent::ANSWERED);
    assert_eq!(reviewed("FAULT\nnotes.md is empty.", true), agent::CRITIC_FAULTED);
    // NOT A PASS IS NOT A PASS. A verdict that never says the word, and a
    // critic whose own turn raised, both fail towards the fault: a false fault
    // is a word somebody can disagree with, a false pass is never looked at.
    assert_eq!(reviewed("It seems broadly reasonable to me.", true), agent::CRITIC_FAULTED);
    assert_eq!(reviewed("critic failed: the endpoint could not be reached", false), agent::CRITIC_FAULTED);
}

/// A REVIEW OF WHAT THE FILE USED TO SAY IS NOT A REVIEW OF THIS ONE. The same
/// freshness rule the verify gate runs on: log order, no clock, no ledger.
#[test]
fn a_write_after_a_pass_makes_the_pass_stale() {
    let state = caller(CALLER);
    let state = step(state, said("critic({\"query\": \"review the plan\"})")).0;
    let state = step(state, came_back("critic", true, "PASS\nlooks right")).0;
    let state = step(state, said("write_file({\"path\": \"notes.md\"})")).0;
    let state = step(state, came_back("write_file", true, "wrote notes.md")).0;
    assert_eq!(state.reviewed, None, "the edit postdates the review");
    // Two nudges, and then the answer lands as unchecked — never as answered,
    // and never as though the earlier pass had covered the later write.
    let state = step(state, said("Done.")).0;
    let state = step(state, said("Done.")).0;
    assert_eq!(ending(&step(state, said("Done.")).1), agent::UNCHECKED);
}

/// AND THE VERDICT BELONGS TO ONE TURN. Last turn's pass cannot clear this
/// turn's work, exactly as last turn's `cat` cannot vouch for this turn's write.
#[test]
fn a_verdict_does_not_survive_the_turn_that_earned_it() {
    let state = caller(CALLER);
    let state = step(state, said("critic({\"query\": \"review it\"})")).0;
    let state = step(state, came_back("critic", true, "FAULT\nnothing was written")).0;
    let state = step(state, said("Right — I will stop there.")).0;
    assert_eq!(state.reviewed, None, "an ended turn holds no verdict");
    let state = step(
        state,
        ev(EventKind::UserMessage {
            text: "now write it".into(),
            agent: String::new(),
            from: String::new(),
        }),
    )
    .0;
    let state = step(state, said("exec({\"command\": \"ls\"})")).0;
    let state = step(state, came_back("exec", true, "notes.md")).0;
    assert_eq!(ending(&step(state, said("There it is.")).1), agent::ANSWERED);
}

/// AN AGENT THAT NEVER CALLS THE CRITIC IS EXACTLY THE TURN IT ALWAYS WAS. The
/// compatibility rule: no critic in the toolbox, no verdict, no new ending.
#[test]
fn an_agent_with_no_critic_ends_the_way_it_always_did() {
    const ALONE: &str = "---\nname: lead\ndescription: d\nmodel: local\nspace: research\n\
                         tools: [exec]\n---\nbody";
    let state = caller(ALONE);
    assert_eq!(state.critic, "critic", "the role holder is known even where it is not granted");
    let state = step(state, said("exec({\"command\": \"ls\"})")).0;
    let state = step(state, came_back("exec", true, "notes.md")).0;
    assert_eq!(ending(&step(state, said("One file.")).1), agent::ANSWERED);
}
