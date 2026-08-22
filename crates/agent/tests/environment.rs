//! **(c) EVERY DECLARED FACT REACHES THE MODEL — the omission half of I16.**
//!
//! `tests/stated.rs` checks that what IS said is true. This checks that what
//! the system depends on the model knowing is said at all, which is the half
//! that had no test anywhere: a model told nothing about a constraint does not
//! treat it as unknown, it treats it as absent and plans accordingly. Four
//! true things about this workspace were never told to any agent (T48) and
//! nothing in the suite could notice.
//!
//! It iterates `agent::guest_facts` rather than naming five sentences, so the
//! rule it holds is "a fact declared and not rendered fails", not "these five
//! appear". A sixth fact added to the declaration is covered the moment it is
//! written, and a renderer that quietly drops one is a red gate.
//!
//! The prompt is the REAL one: the shipped `public/agents/main/agent.md`,
//! through the real `step`, rendered for a real provider — the same path
//! `tests/prompt.rs` uses, because a fact that reaches a component and not the
//! bytes has not reached the model.

use agent::{
    adopt_spec, guest_facts, parse_agent_file, space_parts, step, toolbox_for, AgentState, Effect,
    Toolbox, SPACE_FACULTY,
};
use context::{render, ContentPart, ProviderFormat};
use kernel::{Event, EventId, EventKind, Timestamp};

mod common;

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const CRITIC: &str = include_str!("../../../public/agents/critic/agent.md");
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

/// The bytes a shipped agent's file produces on a given stage.
fn rendered(file: &str, stage: &str) -> String {
    let spec = parse_agent_file("main", file).expect("a shipped agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    // The host, stood in for: a faculty block renders what a host last wrote
    // under its id, and there is no host in this crate.
    let parts = space_parts(&state.space, &state.toolbox);
    state.senses.insert(SPACE_FACULTY.to_string(), parts);
    common::brief(&mut state);
    state.declared = vec![stage.to_string()];
    state.stages = vec![stage.to_string()];
    let (_, effects) = step(state, user("what is in this folder?"));
    let document = effects
        .iter()
        .find_map(|e| match e {
            Effect::CallModel { document, .. } => Some(document),
            _ => None,
        })
        .expect("asking a question calls the model");
    let messages = render(document, FMT);
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

/// The toolbox the shipped `main` resolves to, which is what the working
/// stage is granted and therefore what the declaration is asked about.
fn main_toolbox() -> Toolbox {
    let spec = parse_agent_file("main", MAIN).expect("main parses");
    toolbox_for(&spec, &[])
}

/// **EVERY DECLARED FACT IS IN THE PROMPT.** Named by id when it is not, so a
/// dropped fact says which one it was.
#[test]
fn every_fact_the_declaration_holds_reaches_the_working_prompt() {
    let prompt = rendered(MAIN, "work");
    let facts = guest_facts(&main_toolbox());
    assert!(facts.len() >= 4, "the declaration is not empty: {}", facts.len());
    for fact in facts {
        assert!(
            prompt.contains(&fact.says),
            "the `{}` fact is declared and never reaches the model.\nDeclared: {}\n\
             It is rendered by `agent::environment::lines`, which the `## environment` \
             component calls — a fact that is declared and not rendered is the omission \
             I16 names (T48).",
            fact.id,
            fact.says
        );
    }
}

/// …and it reaches it in the `## environment` block, not scattered. One block
/// is one answer to one question; a fact that landed in the transcript or in
/// the toolbox listing would satisfy a `contains` and teach the model nothing
/// about where to look next time.
#[test]
fn the_facts_are_the_environment_block_and_not_loose_text() {
    let prompt = rendered(MAIN, "work");
    let block = prompt
        .split("\n## environment\n")
        .nth(1)
        .expect("the environment block is present")
        .split("\n## ")
        .next()
        .expect("…and ends at the next heading")
        .to_string();
    assert!(block.contains("current time:"), "the clock is still the clock: {block}");
    for fact in guest_facts(&main_toolbox()) {
        assert!(block.contains(&fact.says), "`{}` is outside the block: {block}", fact.id);
    }
    // The T48 sentences, by their subject rather than by their wording, so a
    // rewrite that keeps the meaning keeps this test green. `180 seconds` is
    // T53's: an agent that does not know the ceiling writes commands that
    // cannot finish, and one that does not know a cut-off answer is MARKED
    // reads a truncated build log as the whole of it.
    for subject in ["one shell", "network: none", "web_search", "busybox", "180 seconds"] {
        assert!(
            block.to_lowercase().contains(&subject.to_lowercase()),
            "the block never mentions {subject}: {block}"
        );
    }
    // …AND THE SUBSTRATE TRUTH IS STILL TOLD, from the block that owns it.
    // It is `## space`'s, not this one's: `guest_facts` is a function of the
    // TOOLBOX and says nothing for an agent that has a folder and no workspace
    // tools, so a folder would have been described without the one property
    // that matters. Asserted against the WHOLE prompt on purpose — the truth
    // must reach the model, and which block carries it is the components' business.
    let whole = rendered(MAIN, "work");
    assert!(
        whole.contains("survives a reload"),
        "nothing tells the model the filesystem is ephemeral: {whole}"
    );
}

/// **AND AN AGENT WITH NO SHELL IS TOLD NOTHING ABOUT ONE (I15).** The shipped
/// critic runs `engine: base` with an empty toolbox and its own body says
/// there is nothing here to call by any route. Describing a queue it cannot
/// join would be the same defect this file exists to catch, pointing the other
/// way — and the strategy vote that opens every turn is granted nothing
/// either, which is T25's rule applied to this block from the start.
#[test]
fn an_agent_that_cannot_run_a_command_is_told_nothing_about_the_shell() {
    // Asserted against the DECLARED sentences rather than against keywords:
    // `main`'s own body says the words "one shell" while teaching the agent to
    // read this block, and a keyword search would call that a defect.
    for prompt in [rendered(CRITIC, "answer"), rendered(MAIN, "strategy")] {
        for fact in guest_facts(&main_toolbox()) {
            assert!(
                !prompt.contains(&fact.says),
                "a stage granted no shell is told `{}` about one",
                fact.id
            );
        }
    }
    assert!(guest_facts(&Toolbox::default()).is_empty());
}

/// **THE DEADLINE IS ONE NUMBER, DECLARED HERE AND ENFORCED IN THE .JS.**
///
/// `RUN_MS` lives in `crates/adapters_web/src/c2w.js`, which Rust cannot
/// import: it is a wasm-bindgen snippet, loaded by the browser, in a crate the
/// pure core is forbidden to depend on (I3). So the number is DECLARED in
/// `agent::environment` — the file that already declares what the guest
/// contains, for the same reason and with the same honest limit — and this
/// test reads the JavaScript and asserts the two agree. A number typed twice
/// is a number that will drift; this is the gate that turns red when it does.
///
/// It greps a source file, which is the weaker half of I17 and is said out
/// loud: it pins the DECLARATION against the SOURCE, not against a running
/// engine. What a booted container2wasm actually does at 180 seconds is
/// unpinnable from this crate and from the browser suite alike — the machine
/// fact that would settle it is a cross-origin-isolated document serving the
/// ~48 MB guest image inside the test harness, and no gate command has one.
#[test]
fn the_deadline_the_model_is_told_is_the_one_the_engine_enforces() {
    let js = std::fs::read_to_string(C2W_JS).expect("c2w.js is readable");
    let ms = after(&js, "RUN_MS = ").expect("c2w.js declares RUN_MS");
    assert_eq!(
        ms.parse::<u64>().expect("RUN_MS is a number of milliseconds"),
        agent::GUEST_RUN_LIMIT_SECS * 1000,
        "the engine's watchdog and the sentence the model reads disagree: \
         c2w.js says {ms}ms, `agent::environment::RUN_LIMIT_SECS` says {}s",
        agent::GUEST_RUN_LIMIT_SECS
    );
}

/// …AND THE MARK ON A TRUNCATED ANSWER IS ONE STRING TOO. The model is told to
/// look for it, so a rewording in the JavaScript that never reached the prompt
/// would teach the model to watch for a mark that no longer appears — the
/// drift I16 exists to stop, in the one place a model is least able to notice
/// it: an answer that looks complete.
#[test]
fn the_mark_on_a_truncated_answer_is_the_one_the_engine_writes() {
    let js = std::fs::read_to_string(C2W_JS).expect("c2w.js is readable");
    assert!(
        js.contains(agent::GUEST_PARTIAL_MARK),
        "c2w.js never writes {:?}, which the prompt tells the model means the \
         output above it was cut off",
        agent::GUEST_PARTIAL_MARK
    );
    let block = std::fs::read_to_string(C2W_JS).expect("c2w.js");
    assert!(
        block.contains("status: KILLED"),
        "a timeout must come back as an EXECUTION carrying what the command printed, \
         not as a `WorkspaceError::Failed` that has nowhere to put it"
    );
}

/// Where the watchdog actually lives. Relative to this crate, because the
/// suite is run from anywhere.
const C2W_JS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../adapters_web/src/c2w.js");

/// The digits immediately after `needle`, if it is there.
fn after(text: &str, needle: &str) -> Option<String> {
    let rest = text.split_once(needle)?.1;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    (!digits.is_empty()).then_some(digits)
}
