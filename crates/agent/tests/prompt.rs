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
/// `stages` overrides the loop the file declares — BOTH copies of it. `main`
/// now declares `[strategy]`, and a turn begins by resetting the working list
/// back to the declared one (`stages::open`), so setting only `stages` here
/// would be overwritten before the first call was built. It matters because
/// `strategy` and `plan` are granted no tools on purpose: a test that wants to
/// see the toolbox has to ask for a stage that has one.
fn rendered_at(question: &str, stages: &[&str]) -> String {
    rendered_from(MAIN, question, stages)
}

/// The same, from a given agent FILE — so a test can ask what an agent that
/// named no space is shown, without a second fixture drifting away from the
/// shipped one.
fn rendered_from(file: &str, question: &str, stages: &[&str]) -> String {
    let spec = parse_agent_file("main", file).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    state.declared = stages.iter().map(|s| (*s).to_string()).collect();
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

/// The paper's own headings. A heading is a line that STARTS with `## `;
/// `main`'s file mentions block names inline, in backticks, and matching those
/// would have this file assert against its own documentation.
fn heads(prompt: &str) -> Vec<&str> {
    prompt.lines().filter(|l| l.starts_with("## ")).collect()
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
    let headings = heads(&prompt);
    assert_eq!(
        headings.last(),
        Some(&"## response_contract"),
        "the shape of the reply is the last instruction before writing one: {headings:?}"
    );
}

/// Every one of the ten appears exactly once, in slot order. A missing
/// block is a capability the model silently lost; a duplicated one is two
/// sources of truth for the same question.
#[test]
fn every_component_appears_exactly_once_in_slot_order() {
    let prompt = rendered("hello");
    let headings = heads(&prompt);
    assert_eq!(
        headings,
        vec![
            "## soul",
            "## identity",
            "## operating_rules",
            "## affordances",
            "## space",
            "## environment",
            "## task",
            "## history",
            "## observations",
            "## response_contract",
        ]
    );
}

/// THE SHARED SPACE IS ITS OWN BLOCK (increment 26, gap 8). It used to be
/// three paragraphs appended to `## environment` by `now::environment` — 22
/// lines of `push_str` prompt prose in a file that is not a component, which
/// is the ad-hoc string building I13 forbids. It sits at slot 55 now, between
/// the toolbox and the clock, and the two say different things.
#[test]
fn the_space_is_a_block_of_its_own_and_not_a_paragraph_of_the_clock() {
    let prompt = rendered("hello");
    let block = |head: &str| {
        prompt
            .split(&format!("\n{head}\n"))
            .nth(1)
            .unwrap_or_else(|| panic!("{head} is present"))
            .split("\n## ")
            .next()
            .expect("…and ends at the next heading")
            .to_string()
    };
    let space = block("## space");
    assert!(space.contains("space: research"), "{space}");
    assert!(space.contains("workspace: /root/spaces/research"), "{space}");
    // The clock block is the clock, the day and the device, and nothing else.
    let environment = block("## environment");
    assert!(environment.contains("current time:"), "{environment}");
    assert!(!environment.contains("workspace"), "the space has left: {environment}");
    assert!(!environment.contains("shared facts"), "…all of it: {environment}");
}

/// An agent that named no space renders no space block — not an empty heading
/// and not an apology, which is what the other two dead blocks used to do.
#[test]
fn an_agent_with_no_space_has_no_space_block() {
    let alone = MAIN.replace("\nspace: research\n", "\n");
    assert!(!alone.contains("space: research"), "the fixture really dropped it");
    let prompt = rendered_from(&alone, "hello", &["work"]);
    let headings = heads(&prompt);
    assert!(!headings.contains(&"## space"), "{headings:?}");
    assert!(headings.contains(&"## environment"), "…and the clock still runs");
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

/// A STAGE IS SHOWN EXACTLY WHAT IT MAY CALL, and for `plan` that is two
/// things. Its brief tells it to list the installed skills and read the ones
/// that apply, so showing it no tools would make that instruction a lie; the
/// whole toolbox would let it start the work it is supposed to be planning.
/// The words and the grant agree because the grant is what produces the words.
#[test]
fn a_planning_turn_is_shown_the_skills_and_nothing_else() {
    let planning = rendered_at("what is in this folder?", &["plan", "work"]);
    assert!(planning.contains("list_skills("), "it can see what instruction exists");
    assert!(planning.contains("read_skill("), "…and pull one in");
    assert!(!planning.contains("exec("), "but it cannot start the work");
    assert!(!planning.contains("write_file("), "nor change anything");
    assert!(!planning.contains("now({})"), "…not even the harmless ones");
}

/// The strategy vote is shown nothing at all: it is one decision about the
/// message, and a model shown a toolbox tends to reach for it instead.
#[test]
fn the_strategy_vote_is_shown_no_tools_at_all() {
    let voting = rendered_at("what is in this folder?", &[agent::STAGE_STRATEGY]);
    assert!(
        voting.contains("No tools are installed; answer from what you know."),
        "the vote offers nothing to call"
    );
    // …and it asks for the two lines the machine reads, in the block that is
    // always last.
    let contract = voting.split("\n## response_contract").nth(1).expect("a contract block");
    assert!(contract.contains("ROUTE: one word"), "the shape is stated as fields: {contract}");
    assert!(contract.contains("WHY: one short clause"));
}

/// The agent file's own headings sit BELOW the paper's. Without this the file's
/// "## Tools" prose and the assembled "## affordances" list read as two
/// sections of equal standing describing the same thing.
#[test]
fn the_agent_files_own_headings_do_not_compete_with_the_frame() {
    let prompt = rendered("hello");
    let top = heads(&prompt);
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

/// The stage brief is its OWN block, not a turn somebody took. It used to be
/// pushed into the transcript as a bracketed `user:` line, which put words the
/// person never said into the record of what they said.
#[test]
fn a_stage_brief_is_a_block_and_not_a_forged_user_turn() {
    let planning = rendered_at("add a health check", &["plan", "work"]);
    assert!(
        heads(&planning).contains(&"## directive"),
        "the instruction for this turn has a block of its own"
    );
    assert!(planning.contains("OUTCOME"), "…carrying the brief");
    let history = planning
        .split("## history")
        .nth(1)
        .expect("a history block")
        .split("\n## ")
        .next()
        .unwrap();
    assert!(
        !history.contains("OUTCOME"),
        "…and the transcript records only what was actually said: {history}"
    );
    // The brief sits after the conversation and immediately before the shape
    // of the reply — the last instruction read before writing one.
    // Anchored to the line start, because the agent's own prose NAMES the
    // block — an unanchored search finds the sentence explaining the directive
    // rather than the directive.
    let at = |head: &str| planning.find(&format!("\n{head}")).expect(head);
    assert!(at("## history") < at("## directive") && at("## directive") < at("## response_contract"));
}

/// A turn with no brief renders no empty block. A component with nothing to
/// say vanishes rather than heading a blank space.
#[test]
fn a_turn_with_no_brief_has_no_directive_block() {
    assert!(!heads(&rendered("hello")).contains(&"## directive"));
}

/// STATIC ONCE, DYNAMIC EVERY CALL — the property that makes a prompt cheap to
/// rebuild and cacheable at the provider.
///
/// The static head (`soul`, `identity`, `operating_rules`) is rendered when the
/// agent file is adopted and never again: two calls a turn apart produce
/// byte-identical bytes up to the first thing that can change. Only the
/// components that CAN differ are rebuilt before a call, and this asserts both
/// halves — a build that re-rendered everything would still pass a test that
/// only checked the output was correct.
#[test]
fn the_static_head_is_byte_identical_between_calls() {
    let first = rendered_at("what is the time", &["work"]);
    let second = rendered_at("something else entirely", &["work"]);
    let head = |p: &str| p.split("\n## environment").next().unwrap().to_string();
    assert_eq!(head(&first), head(&second), "nothing above the clock may differ");
    // …and the parts that must differ, do.
    assert!(first.contains("what is the time"));
    assert!(!second.contains("what is the time"));
}
