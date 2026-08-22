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

use agent::{
    adopt_spec, memory_parts, parse_agent_file, space_parts, step, AgentState, Effect, Memory,
    MEMORY_FACULTY, SPACE_FACULTY,
};
use context::{render, ContentPart, ProviderFormat, Role};

mod common;
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
    rendered_with(file, question, stages, &[])
}

/// The same again, with a ROSTER around it — because a `tools:` list names
/// built-ins and peer agents in one breath, and "the list resolves to what it
/// named and nothing else" is only half-tested against an empty roster.
fn rendered_with(file: &str, question: &str, stages: &[&str], peers: &[&str]) -> String {
    let spec = parse_agent_file("main", file).expect("the shipped main agent parses");
    let peers: Vec<agent::AgentSpec> = peers
        .iter()
        .map(|text| parse_agent_file("peer", text).expect("a peer parses"))
        .collect();
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &peers);
    sensed_by_the_host(&mut state);
    // A BRIEFED STAGE REFUSES TO BE ENTERED WITHOUT ITS WORDS (T1). The words
    // are `public/stages/*.md` now, not Rust constants, so a test that walks a
    // stage installs them exactly as `core` does — and reads the shipped files,
    // so a brief deleted from the repo fails here rather than in a browser.
    common::brief(&mut state);
    state.declared = stages.iter().map(|s| (*s).to_string()).collect();
    state.stages = stages.iter().map(|s| (*s).to_string()).collect();
    bytes_of(state, question)
}

/// The bytes a PREPARED state produces when it is asked something — the half
/// of `rendered_with` below building `main`. Split out so a test can prepare a
/// different agent entirely and still go through the one real path, rather
/// than a second rendering that could drift from this one.
fn bytes_of(state: AgentState, question: &str) -> String {
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

/// THE HOST, STOOD IN FOR. A faculty block renders whatever a host last left
/// under its id, and there is no host in this crate — in the running app
/// `core::space::sense::SpaceSense` writes this before every pass, through the
/// same port a browser faculty would use.
///
/// It is written HERE rather than in `adopt_spec` on purpose. `adopt_spec` used
/// to fill the space block itself, which made the one faculty the pure crate
/// knows by name a special case inside the very seam that exists to have none.
/// Moving it into the test says what the test was always relying on: a host ran.
fn sensed_by_the_host(state: &mut AgentState) {
    // The GRANT travels with the space: the block names the tools that reach
    // into that folder, so it is rendered against what this agent actually
    // holds (I15), exactly as `core::space::sense::SpaceSense` renders it.
    let parts = space_parts(&state.space, &state.toolbox);
    state.senses.insert(SPACE_FACULTY.to_string(), parts);
}

/// The same again, with the host having left LINES IN MEMORY. Memory is a
/// faculty like the space, so it is rendered from whatever a host last wrote
/// under its name — `sensed_by_the_host` leaves it empty, and this is the only
/// place that does not.
fn rendered_remembering(question: &str, kept: &[&str]) -> String {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    sensed_by_the_host(&mut state);
    let memory = Memory { notes: kept.iter().map(|k| (*k).to_string()).collect() };
    state.senses.insert(MEMORY_FACULTY.to_string(), memory_parts(&memory));
    state.declared = vec!["work".to_string()];
    state.stages = vec!["work".to_string()];
    let (_, effects) = step(state, user(question));
    let document = effects
        .iter()
        .find_map(|e| match e {
            Effect::CallModel { document, .. } => Some(document),
            _ => None,
        })
        .expect("asking a question calls the model");
    render(document, FMT)[0]
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
    // The KEY is gone, not every mention of it: the file's own frontmatter
    // comment quotes `space: research` in backticks when it explains that
    // naming a space declares the space faculty, and a substring search here
    // would be a test of the documentation rather than of the fixture.
    assert!(
        !alone.lines().any(|l| l.trim_end() == "space: research"),
        "the fixture really dropped the key"
    );
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
    // The roster pair and the memory pair are named now, so what the file
    // grants is what the model is shown how to call.
    for name in ["write_agent", "spawn_agent", "keep", "discard"] {
        assert!(
            spec.tools.iter().any(|t| t == name),
            "the shipped file grants {name}"
        );
        assert!(
            prompt.contains(&format!("{name}(")),
            "…and the prompt shows how to call it: {name}"
        );
    }
    // …AND `web_search` JOINS THEM (increment 28). It stood on the other side
    // of this test until now, as the ungranted built-in that proved a named
    // list resolves to what it named and nothing else.
    for name in [agent::WEB_SEARCH] {
        assert!(spec.tools.iter().any(|t| t == name), "the shipped file grants {name}");
        assert!(prompt.contains(&format!("{name}(")), "…and shows how to call it: {name}");
    }
    // WHICH MOVES THE NEGATIVE CONTROL, and does not retire it. Every built-in
    // this build ships is now named by `main`, so the ungranted thing has to be
    // a PEER — which is the better target anyway, because a `tools:` list
    // filters built-ins and agents in the same breath. `critic` is named and
    // resolves; `builder`, loaded beside it, is not named and must not appear.
    const CRITIC: &str = include_str!("../../../public/agents/critic/agent.md");
    const BUILDER: &str = include_str!("agents/builder.md");
    let peopled = rendered_with(MAIN, "hello", &["work"], &[CRITIC, BUILDER]);
    assert!(spec.tools.iter().any(|t| t == "critic"), "the shipped file names critic");
    assert!(peopled.contains("critic("), "…and a named peer is shown as a call");
    assert!(
        !spec.tools.iter().any(|t| t == "builder"),
        "the shipped file does not name builder"
    );
    assert!(
        !peopled.contains("builder("),
        "an agent this one was never granted must not appear: {peopled}"
    );
}

/// THE SECOND FACULTY REACHES THE SHIPPED PROMPT (increment 27). `main`
/// declares `faculties: [memory]`, so the lines its host left under that name
/// are read back to it — and when it has kept nothing there is no heading at
/// all, because an empty component elides rather than announcing its own
/// emptiness (`crates/agent/src/components/memory.rs`).
#[test]
fn the_shipped_agent_is_shown_what_it_kept_and_nothing_when_it_kept_nothing() {
    let blank = rendered("hello");
    assert!(
        !heads(&blank).contains(&"## memory"),
        "an agent that has kept nothing gets no memory block: {:?}",
        heads(&blank)
    );

    let kept = rendered_remembering("hello", &["they prefer metric units"]);
    let headings = heads(&kept);
    assert!(headings.contains(&"## memory"), "{headings:?}");
    let block = kept
        .split("\n## memory\n")
        .nth(1)
        .expect("the memory block is present")
        .split("\n## ")
        .next()
        .expect("…and ends at the next heading");
    assert!(
        block.contains("- they prefer metric units"),
        "the kept line is shown verbatim: {block}"
    );
    // …at slot 50 (`crates/context/src/slot.rs:47`): inside the cacheable head,
    // above the clock, and above the shared space it is deliberately not a
    // corner of — what this agent kept is read before what the group posted.
    let at = |head: &str| kept.find(&format!("\n{head}\n")).expect(head);
    assert!(at("## affordances") < at("## memory"), "{headings:?}");
    assert!(at("## memory") < at("## space"), "{headings:?}");
    assert!(at("## space") < at("## environment"), "{headings:?}");
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

/// Every tool name this build ships: the built-in table, plus every faculty's
/// own set — the space's three and the workspace's, which is where `observe`
/// and `find_files` live. A WALK and not a list of three names typed by hand,
/// so a built-in added next year cannot slip past the test below by not having
/// been thought of when it was written.
fn every_tool_name() -> Vec<String> {
    let mut names: Vec<String> =
        agent::builtin_tools().tools.iter().map(|t| t.name.clone()).collect();
    for faculty in agent::faculty_names() {
        let tools = agent::faculty_of(faculty).map(|f| f.tools).unwrap_or_default();
        names.extend(tools.into_iter().map(|t| t.name));
    }
    names
}

/// THE SHIPPED CRITIC'S OWN PROMPT (I15). Nothing rendered it before this:
/// `tests/critic.rs` asserts the space faculty is DECLARED, and the test above
/// loads this file only as a peer of `main`. The suite proved the block was
/// reachable and never asked what it said — and what it said, to an agent with
/// an empty toolbox by construction, was that `observe` reports the machine and
/// `find_files` searches the folder. Its own body says "you have no tools. Not
/// a restriction to work around — there is nothing here to call, by any route."
/// A prompt that contradicts itself over what the agent can do is the setting
/// that looks applied, in the block the verdict is judged against.
///
/// It fails if any tool this build ships is shown to this agent AS A CALL —
/// `name(` and not the bare word, because the critic's prose legitimately talks
/// about the space, about processes and about files.
#[test]
fn the_shipped_critic_is_shown_no_tool_it_was_never_granted() {
    const CRITIC: &str = include_str!("../../../public/agents/critic/agent.md");
    let spec = parse_agent_file("critic", CRITIC).expect("the shipped critic parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    assert!(
        state.toolbox.is_empty(),
        "`engine: base` is an empty toolbox by construction, and that is the premise here"
    );
    sensed_by_the_host(&mut state);
    common::brief(&mut state);
    let prompt = bytes_of(state, "I wrote the file and the tests pass.");

    // The space block IS there — that is the point. It is live in a Worker,
    // it carries the shared facts the verdict is judged against, and this test
    // would be vacuous if the block had simply vanished.
    let headings = heads(&prompt);
    assert!(headings.contains(&"## space"), "{headings:?}");
    assert!(prompt.contains("space: research"), "{prompt}");
    assert!(
        prompt.contains("nothing written there survives a reload"),
        "…and the folder is still described truthfully: {prompt}"
    );

    let harness = what_the_harness_says(&prompt);
    for name in every_tool_name() {
        assert!(
            !names_a_tool(&harness, &name),
            "the critic was granted nothing and must be told about nothing: {name} in\n{harness}"
        );
    }
}

/// The prompt MINUS the agent's own body.
///
/// `## soul` is the file's prose, written by whoever wrote the agent; every
/// block after it is the HARNESS describing the world to that agent, and the
/// world is what this test governs. The distinction is not a convenience: the
/// critic's own body says "not against how the report describes the goal now",
/// and `now` is a built-in tool — scanning the author's English for tool names
/// would be a test of the file's vocabulary rather than of what it was told it
/// can do.
fn what_the_harness_says(prompt: &str) -> String {
    prompt
        .split("\n## identity\n")
        .nth(1)
        .expect("the identity block follows the agent's own words")
        .lines()
        // …and without the FRAME either. A heading and its one-line intent are
        // written once for every agent and say nothing about this one's grant;
        // `## environment`'s reads "what is available right now", and `now` is
        // a built-in. What is left is only what the harness said about THIS
        // agent's world, which is the sentence a false grant would live in.
        .filter(|l| !l.starts_with("## "))
        .filter(|l| !(l.starts_with('(') && l.ends_with(')')))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Does this prompt NAME that tool — as a call, or as the word itself?
///
/// `prompt.rs` matches `name(` everywhere else, because a signature is how the
/// affordances block writes one. That is too narrow HERE: the sentence this
/// test was written for named its three tools in running prose, as bare words,
/// and matched nothing. So a whole-word hit counts too, and the boundary is
/// what keeps it from being a substring search — `now` must not fire on
/// "known", and `keep` must not fire on "keeps its filesystem in memory".
fn names_a_tool(prompt: &str, name: &str) -> bool {
    if prompt.contains(&format!("{name}(")) {
        return true;
    }
    let inside = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    prompt.match_indices(name).any(|(at, _)| {
        !inside(prompt[..at].chars().next_back()) && !inside(prompt[at + name.len()..].chars().next())
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CLASS, NOT THE CASE (T25, I16).
//
// The test above governs ONE agent and knows nothing about stages. This section
// governs the CLASS the defect belonged to: for EVERY agent this build ships,
// in EVERY stage that agent can enter, the prompt must name no tool that stage
// cannot call. It is the falsifier the tree did not have — `docs/CRITIQUE-04`'s
// through-line is that a test naming one instance passes over the rule, and
// I16's is that a truth held and not stated is a defect. A prompt that says a
// capability is there when the grant says it is not fails both at once.
//
// Nothing below names `space`, `observe`, `main` or `strategy`. A new agent, a
// new stage, a new faculty block or a new sentence in an old one is checked the
// moment it exists, because every list here is derived: the agents from
// `public/agents/index.json`, the stages from `agent::STAGES` and the routes,
// the tool universe from `every_tool_name`'s walk, and the grant itself from
// the `## affordances` block the machine rendered from `ask::scoped_tools`.
// ─────────────────────────────────────────────────────────────────────────────

const INDEX: &str = include_str!("../../../public/agents/index.json");
const CRITIC: &str = include_str!("../../../public/agents/critic/agent.md");

/// Every shipped agent, as (folder, file). A static host cannot list a
/// directory, so `index.json` is the listing — and `include_str!` needs a
/// literal, so this table is compiled in and CHECKED against that listing by
/// [`the_manifest_and_this_table_name_the_same_agents`]. A third agent added to
/// the manifest fails there, loudly, rather than being silently unexamined
/// here; being unexamined is the failure this whole section exists about.
const SHIPPED: [(&str, &str); 2] = [("main", MAIN), ("critic", CRITIC)];

fn manifest_agents() -> Vec<String> {
    let json: serde_json::Value =
        serde_json::from_str(INDEX).expect("the shipped agent manifest is JSON");
    json["agents"]
        .as_array()
        .expect("the manifest lists agents")
        .iter()
        .map(|n| n.as_str().expect("an agent name is a string").to_string())
        .collect()
}

#[test]
fn the_manifest_and_this_table_name_the_same_agents() {
    let listed = manifest_agents();
    let known: Vec<String> = SHIPPED.iter().map(|(n, _)| (*n).to_string()).collect();
    assert_eq!(
        listed, known,
        "an agent this build ships is not being checked by the class test below"
    );
}

/// EVERY STAGE THIS AGENT CAN ENTER — derived, never typed out.
///
/// An empty `stages:` is the bare react loop, which `stages::current` reads as
/// `work`. A file that declares `strategy` declares a VOTE, not a loop: the
/// list it walks for the rest of the turn is whichever `Route` the vote names,
/// so every stage of every route is reachable from that one word.
fn stages_of(spec: &agent::AgentSpec) -> Vec<String> {
    let mut out = match spec.stages.is_empty() {
        true => vec![agent::STAGE_WORK.to_string()],
        false => spec.stages.clone(),
    };
    if out.iter().any(|s| s == agent::STAGE_STRATEGY) {
        let routes = [agent::Route::Answer, agent::Route::React, agent::Route::Project];
        for stage in routes.into_iter().flat_map(agent::Route::stages) {
            if !out.contains(&stage) {
                out.push(stage);
            }
        }
    }
    out
}

/// The bytes one shipped agent is shown in ONE stage, with every other shipped
/// agent loaded beside it — because a `tools:` list names built-ins and peers
/// in one breath, and a grant only half-resolved is a grant only half-tested.
fn shipped_prompt(name: &str, file: &str, stage: &str) -> String {
    let spec = parse_agent_file(name, file).expect("a shipped agent parses");
    let peers: Vec<agent::AgentSpec> = SHIPPED
        .iter()
        .filter(|(n, _)| *n != name)
        .map(|(n, f)| parse_agent_file(n, f).expect("a shipped peer parses"))
        .collect();
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &peers);
    sensed_by_the_host(&mut state);
    common::brief(&mut state);
    state.declared = vec![stage.to_string()];
    state.stages = vec![stage.to_string()];
    bytes_of(state, "what is in this folder?")
}

/// One block of the rendered prompt, heading excluded, up to the next heading.
fn block_of<'a>(prompt: &'a str, head: &str) -> &'a str {
    prompt
        .split(&format!("\n## {head}\n"))
        .nth(1)
        .unwrap_or("")
        .split("\n## ")
        .next()
        .unwrap_or("")
}

/// WHAT THIS STAGE MAY CALL, TAKEN FROM THE MACHINE AND NOT FROM A LIST.
///
/// `## affordances` is rendered from `ask::scoped_tools` and from nothing else
/// (`components::dynamic`), so the block IS the machine's own statement of this
/// call's grant. Reading the oracle out of the artifact under test is what
/// keeps this from being a second copy of the scoping rules, which could agree
/// with itself while both copies were wrong.
fn granted_in_this_stage(prompt: &str) -> Vec<String> {
    let shown = block_of(prompt, "affordances");
    every_tool_name()
        .into_iter()
        .filter(|name| shown.contains(&format!("{name}(")))
        .collect()
}

/// THE BLOCKS THAT SAY WHAT IS TRUE, as opposed to the blocks that say what to
/// do about it. Four things are taken out, and each exclusion is a claim.
///
/// `## soul` is the agent's own body, for `what_the_harness_says`' reason: it
/// is the author's English, and scanning it would test the file's vocabulary.
///
/// [`NOT_THE_WORLD`] is the other three, and they are excluded as a CLASS
/// rather than one by one: none of them describes the world, so none of them
/// can misdescribe it. `affordances` IS the grant, so every name in it is true
/// by construction and it is the oracle above besides. `directive` is one
/// instruction for a whole TURN and may legitimately speak of a later stage —
/// `public/stages/durable.md` tells the `plan` stage to call `remember` "in the
/// work that follows", true of the turn and false of the stage; it gets its own
/// weaker rule below rather than going unchecked. `response_contract` is the
/// shape of the REPLY, and it is built from the same toolbox as the affordances
/// (`ask::contract` offers the envelope form only when there is something to
/// call).
///
/// THE LIMIT, RECORDED WITH THE RULE (I16). That third exclusion is also a
/// concession to the token rule: `now` is a shipped tool AND an ordinary
/// English word, and the strategy stage's contract used to say "you can answer
/// it now from what you already know" — a sentence that has since moved into
/// `public/stages/strategy.md`, which is excluded on the line above for its own
/// reason. The concession stands whether or not that particular sentence is
/// still there: rewording harness prose to dodge a tool's name is the tail
/// wagging the dog. So a tool named in the response contract and nowhere else
/// is not caught here.
const NOT_THE_WORLD: [&str; 3] = ["affordances", "directive", "response_contract"];

fn the_world_as_described(prompt: &str) -> String {
    let after = prompt
        .split("\n## identity\n")
        .nth(1)
        .expect("the identity block follows the agent's own words");
    let mut head = "identity".to_string();
    let mut kept: Vec<&str> = Vec::new();
    for line in after.lines() {
        if let Some(name) = line.strip_prefix("## ") {
            head = name.trim().to_string();
            continue;
        }
        if line.starts_with('(') && line.ends_with(')') {
            continue;
        }
        if NOT_THE_WORLD.contains(&head.as_str()) {
            continue;
        }
        kept.push(line);
    }
    kept.join("\n")
}

/// THE ROUND'S ARTIFACT. Every shipped agent × every stage it can enter: the
/// world the harness describes may name a tool only if this stage can call it.
///
/// T25 was one instance — `## space` fed the AGENT's toolbox while the TURN ran
/// under `ask::scoped_tools` — and it shipped green because no test in this
/// tree asserted PROSE against the MACHINE. This one does, in both directions
/// and over the whole cross product.
#[test]
fn no_shipped_agent_is_told_of_a_tool_the_stage_it_is_in_cannot_call() {
    let universe = every_tool_name();
    let mut walked: Vec<String> = Vec::new();
    for (name, file) in SHIPPED {
        let spec = parse_agent_file(name, file).expect("a shipped agent parses");
        for stage in stages_of(&spec) {
            assert!(agent::is_stage(&stage), "{stage} is not a stage");
            if !walked.contains(&stage) {
                walked.push(stage.clone());
            }
            let prompt = shipped_prompt(name, file, &stage);
            let granted = granted_in_this_stage(&prompt);
            let world = the_world_as_described(&prompt);
            for tool in &universe {
                assert!(
                    !names_a_tool(&world, tool) || granted.contains(tool),
                    "{name} in the {stage} stage is told about `{tool}`, which it cannot call \
                     there — the grant is {granted:?}. The sentence is in:\n{world}"
                );
            }
        }
    }
    // …AND THE CROSS PRODUCT REALLY COVERED THE VOCABULARY. A seventh stage
    // added to `STAGES` that no shipped agent can reach is a stage nothing
    // above examines, which is how this test would quietly stop being a class
    // test. It fails here instead, and the fix is a route that reaches it or a
    // stage deleted from the list.
    for stage in agent::STAGES {
        assert!(
            walked.contains(&stage.to_string()),
            "no shipped agent can enter `{stage}`, so nothing checked its prompt: {walked:?}"
        );
    }
}

/// THE DIRECTIVE'S OWN, WEAKER RULE. A brief is one instruction for a whole
/// turn and may name a tool a LATER stage will call — so it is not held to the
/// stage's grant. It is held to the AGENT's: a brief naming a tool this agent
/// was never granted at all is an instruction it can never carry out, in any
/// stage, which is `engine: base`'s lesson said in prose.
#[test]
fn a_stage_brief_names_no_tool_the_agent_was_never_granted() {
    for (name, file) in SHIPPED {
        let spec = parse_agent_file(name, file).expect("a shipped agent parses");
        for stage in stages_of(&spec) {
            let prompt = shipped_prompt(name, file, &stage);
            let brief = block_of(&prompt, "directive");
            for tool in every_tool_name() {
                assert!(
                    !names_a_tool(brief, &tool) || spec.tools.iter().any(|t| *t == tool),
                    "the {stage} brief tells {name} to call `{tool}`, which it does not have"
                );
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE INSTRUCTIONS FOR ADDING AN AGENT, CHECKED AGAINST WHAT IT ACTUALLY TAKES
//
// Three documents tell a person how to ship an agent — the manifest's own
// `comment`, the Agents panel's repository fold, and `progress.md`'s increment
// 03 entry — and all three said TWO steps: write the file, list it in the
// manifest. Doing exactly that exits 101, because [`SHIPPED`] above is a
// compiled-in table of every shipped agent and
// [`the_manifest_and_this_table_name_the_same_agents`] compares the two.
//
// THE RULING. The tripwire STAYS and the documents change. It cannot be
// derived away: `include_str!` takes a literal, so the file contents of a third
// agent cannot enter this suite without somebody typing its path — a derived
// roster would mean the class tests below silently stop examining the new
// agent, which is the exact failure that comment says the table exists to
// prevent. What was wrong was never the tripwire; it was three documents
// describing a two-step process that has been a three-step one since increment
// 25 shipped `critic`.
//
// (`tests/critic.rs`'s `assert_eq!(listed, ["main", "critic"])` was a FOURTH
// step and is not one any more: its stated subject is that both jobs ship, and
// a third agent joining the roster does not make that false. It now asserts
// what it says. The exact-roster tripwire is here, once, where the table it
// guards lives.)
//
// Each document is read as text and must name this file, so the instructions
// cannot quietly go back to two steps.
// ─────────────────────────────────────────────────────────────────────────────

const KEY_HELP: &str = include_str!("../../ui/src/authoring/key_help.rs");
const PROGRESS: &str = include_str!("../../../progress.md");

#[test]
fn every_document_that_says_how_to_add_an_agent_names_the_table_it_must_also_edit() {
    let manifest: serde_json::Value =
        serde_json::from_str(INDEX).expect("the shipped agent manifest is JSON");
    let comment = manifest["comment"].as_str().expect("the manifest explains itself");
    for (what, said) in [("index.json", comment), ("key_help.rs", KEY_HELP), ("progress.md", PROGRESS)]
    {
        assert!(
            said.contains("crates/agent/tests/prompt.rs"),
            "{what} tells a person how to add an agent and does not mention the compiled-in \
             roster table they must edit for `cargo test` to pass"
        );
    }
    // …and none of them still calls it a two-step job.
    assert!(!comment.contains("Two entries"), "the manifest's comment counts the agents it lists");
}
