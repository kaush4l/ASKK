//! THE RENDERED PROMPT. Not the sections, not the document — the actual bytes
//! the model receives, produced by the real shipped agent file through the
//! real step function.
//!
//! This file exists because every other test here checks a piece. A prompt can
//! pass every piecewise assertion and still be wrong as a whole: the order can
//! bury the instruction that mattered, two blocks can contradict each other, a
//! heading can promise something the body never delivers. The only way to know
//! is to render it and read it, so this test renders it and, with
//! `SHOW_PROMPT=1`, prints it.
//!
//!     SHOW_PROMPT=1 cargo test -p agent --test prompt -- --nocapture

use agent::{adopt_spec, parse_agent_file, step, AgentState, Effect};
use context::{render, ContentPart, ProviderFormat, Role};
use kernel::{Event, EventId, EventKind, Timestamp};

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const AT: Timestamp = Timestamp(1_753_800_000_000);

const FMT: ProviderFormat = ProviderFormat::OpenAiChat {
    vision: false,
    audio: false,
};

fn user(text: &str) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: AT,
        kind: EventKind::UserMessage {
            text: text.into(),
            agent: String::new(),
            from: String::new(),
        },
    }
}

/// The real `main` agent, asked a real question, rendered for a real provider.
///
/// `stages` overrides the loop the file declares. It matters here because
/// `main` opens on `plan`, which is granted no tools on purpose — so the first
/// prompt of a turn legitimately shows none, and a test that wants to see the
/// toolbox has to ask for the stage that has one.
fn rendered_at(question: &str, stages: &[&str]) -> String {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    state.stages = stages.iter().map(|s| (*s).to_string()).collect();
    let (_, effects) = step(state, user(question));
    let document = effects
        .iter()
        .find_map(|e| match e {
            Effect::CallModel { document, .. } => Some(document),
            _ => None,
        })
        .expect("asking a question calls the model");
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

/// The working turn — the one that can act, and so the one whose prompt has
/// everything in it.
fn rendered(question: &str) -> String {
    rendered_at(question, &["work"])
}

/// Print it, so a person can judge whether the instructions are what they
/// should be. An automated assertion cannot tell you that a sentence is badly
/// worded; it can only tell you the sentence is still there.
#[test]
fn the_rendered_prompt_can_be_read() {
    let prompt = rendered("what is in this folder?");
    if std::env::var("SHOW_PROMPT").is_ok() {
        println!("\n=== RENDERED PROMPT ({} bytes) ===\n{prompt}", prompt.len());
    }
    assert!(!prompt.is_empty());
}

/// The pinned ends, in the bytes rather than in the document. Soul opens,
/// contract closes — and it is the LAST heading, not merely present.
#[test]
fn the_prompt_opens_with_who_and_closes_with_how_to_reply() {
    let prompt = rendered("hello");
    assert!(
        prompt.starts_with("## soul\n"),
        "the first thing the model reads is who it is: {:?}",
        &prompt[..prompt.len().min(80)]
    );
    let headings: Vec<&str> = prompt
        .lines()
        .filter(|l| l.starts_with("## "))
        .collect();
    assert_eq!(
        headings.last(),
        Some(&"## response_contract"),
        "the shape of the reply is the last instruction before writing one: {headings:?}"
    );
}

/// Every one of the eleven appears exactly once, in slot order. A missing
/// block is a capability the model silently lost; a duplicated one is two
/// sources of truth for the same question.
#[test]
fn every_component_appears_exactly_once_in_slot_order() {
    let prompt = rendered("hello");
    let headings: Vec<&str> = prompt
        .lines()
        .filter(|l| l.starts_with("## "))
        .collect();
    assert_eq!(
        headings,
        vec![
            "## soul",
            "## identity",
            "## operating_rules",
            "## affordances",
            "## user",
            "## memory",
            "## environment",
            "## task",
            "## history",
            "## observations",
            "## response_contract",
        ]
    );
}

/// Each block says what it is for. The intent line is the mechanism that stops
/// a prompt accreting: a section nobody can write one sentence about is a
/// section that should not be in the prompt.
#[test]
fn every_block_states_its_own_purpose() {
    let prompt = rendered("hello");
    for (heading, intent) in prompt
        .lines()
        .zip(prompt.lines().skip(1))
        .filter(|(h, _)| h.starts_with("## "))
    {
        assert!(
            intent.starts_with('(') && intent.ends_with(')') && intent.len() > 2,
            "{heading} does not say what it is for; got {intent:?}"
        );
    }
}

/// The tools the model is TOLD about are the tools it was GIVEN. Both come
/// from one toolbox, so this is a structural guarantee rather than a habit —
/// but it is the guarantee most worth a test, because the failure is a model
/// confidently calling something that does not exist.
#[test]
fn the_tools_shown_are_the_tools_granted() {
    let spec = parse_agent_file("main", MAIN).expect("main parses");
    let prompt = rendered("hello");
    // `main` names sub-agents too; with no peers loaded those resolve to
    // nothing, so only the built-ins it asked for can appear.
    for name in ["now", "remember", "read_file"] {
        assert!(
            spec.tools.iter().any(|t| t == name),
            "the shipped file grants {name}"
        );
        assert!(
            prompt.contains(&format!("{name}(")),
            "…and the prompt shows how to call it: {name}"
        );
    }
    // Nothing the file did not name is offered.
    assert!(
        !prompt.contains("write_agent("),
        "a tool this agent was never granted must not appear"
    );
}

/// A stage told in words to call nothing is SHOWN nothing. `main` opens on
/// `plan` for exactly this reason: the brief is written before anything can be
/// done, and a model shown a toolbox tends to reach for it. The words and the
/// grant agree because the grant is what produces the words.
#[test]
fn a_planning_turn_is_shown_no_tools_at_all() {
    let planning = rendered_at("what is in this folder?", &["plan", "work"]);
    assert!(
        planning.contains("No tools are installed; answer from what you know."),
        "the planning turn offers nothing to call"
    );
    assert!(!planning.contains("now({})"), "…not even the harmless ones");
}

/// The agent file's own headings sit BELOW the paper's. Without this the file's
/// "## Tools" prose and the assembled "## affordances" list read as two
/// sections of equal standing describing the same thing.
#[test]
fn the_agent_files_own_headings_do_not_compete_with_the_frame() {
    let prompt = rendered("hello");
    let top: Vec<&str> = prompt.lines().filter(|l| l.starts_with("## ")).collect();
    assert!(
        top.iter().all(|h| h.chars().nth(3).is_some_and(char::is_lowercase)),
        "only the paper's own blocks are top level; got {top:?}"
    );
    // The file's headings are still THERE, one level down.
    assert!(prompt.contains("### Tools"), "the file's own sections survive");
    assert!(prompt.contains("### The workspace"));
}

/// The affordances block shows call SIGNATURES, not prose about tools. A model
/// copies what it sees; showing it a description and asking for a call is a
/// translation step that buys nothing.
#[test]
fn tools_are_shown_as_the_literal_shape_of_a_call() {
    let prompt = rendered("hello");
    let block = prompt
        .split("## affordances")
        .nth(1)
        .expect("the affordances block is present")
        .split("\n## ")
        .next()
        .expect("…and ends at the next heading");
    assert!(block.contains("AVAILABLE TOOLS"));
    assert!(
        block.contains("now({}): "),
        "a usage line is name(args): description — got {block}"
    );
    assert!(
        block.contains("one line, separated by commas, and run at the same time"),
        "…and the rule for ordering calls travels with them"
    );
}
