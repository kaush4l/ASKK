//! FACULTIES: what an agent file declares it can do, and the one constraint
//! check every faculty — present and future — passes without its author having
//! to rediscover it by red test.
//!
//! A faculty is a name in a file that brings tools and prompt blocks with it.
//! Two of its properties are structural rather than stylistic, and both are
//! checked once here rather than per faculty: a block's slot and its stability
//! are ONE decision, and a block that can be absent must be able to render
//! nothing. Getting either wrong does not spoil the block — it makes the whole
//! document illegal, which is why the check walks the whole registry —
//! `faculty_names()`, which is DERIVED from the one table `faculty_of` answers
//! from, so a faculty cannot exist and be missing from this walk.

use agent::{
    adopt_spec, blocks_of, declared_faculties, faculty_names, faculty_of, parse_agent_file, step,
    unresolved_tools, AgentState, Block, Effect, Memory, Sensed, MEMORY_FACULTY, MEMORY_LIMIT,
    SPACE_FACULTY,
};
use context::{Budget, Component, ContextError, Form, SectionSource, State};
use kernel::{Event, EventId, EventKind, PhaseId, Timestamp};

const AT: Timestamp = Timestamp(1_753_800_000_000);

/// The seeded paper with one faculty block attached, exactly as
/// `paper::set_component` attaches one: appended, and sorted into place by its
/// own declared slot.
fn attached(block: Block, parts: Vec<context::Part>) -> Result<(), ContextError> {
    let mut paper: State = AgentState::new().paper;
    let sensed = Sensed { block, parts };
    paper.sources.push(SectionSource {
        section: sensed.section(AT, Form::DEFAULT),
        summary: None,
    });
    context::validate(&context::assemble(&paper, PhaseId::Work, Budget::unlimited()))
}

/// What a faculty author needs to read when their block breaks the paper. The
/// two reachable failures each have exactly one fix, and the message says it —
/// otherwise every new faculty pays the same afternoon to find it out.
fn explain(faculty: &str, block: &Block, filled: bool, err: ContextError) -> String {
    let state = match filled {
        true => "with parts written",
        false => "with no parts written (which is what an unrefreshed block is)",
    };
    format!(
        "faculty '{faculty}' block '{}' makes an ILLEGAL DOCUMENT {state}: {err:?}\n\n\
         InterleavedStability — slot and stability are ONE decision, not two. The \
         cacheable head must stay monotonic, so a block sorting at or after \
         `observations` (Slot(90)) has to declare Stability::Volatile. Either declare \
         Volatile, or move the block above the clock (Slot(60)) where SemiStatic \
         belongs. Change `slot` or `stability` on the Block in your faculty.\n\n\
         BelowFloor — the block rendered nothing and something demanded more than \
         Elided. `Sensed::floor` is Elided unconditionally and Block carries no floor \
         to override it with, so this can only mean the faculty contributed a \
         Component of its own instead of a Block; contribute a Block.\n\n\
         DuplicateSection — id '{}' is already in the paper. Two faculties cannot \
         share a block id, and no faculty may reuse a seeded one.",
        block.id, block.id
    )
}

/// EVERY BLOCK OF EVERY SHIPPED FACULTY, both ways round. Empty first, because
/// an unrefreshed block is the state every faculty starts in and the one an
/// author is least likely to try.
#[test]
fn every_faculty_block_makes_a_legal_document_written_or_not() {
    assert!(
        faculty_names().len() >= 2,
        "the walk is over the whole registry; a collapse back to one faculty is visible here"
    );
    for name in faculty_names() {
        let faculty = faculty_of(name).unwrap_or_else(|| {
            panic!("the table lists '{name}' but faculty::of does not answer to it")
        });
        for block in faculty.blocks {
            if let Err(err) = attached(block, Vec::new()) {
                panic!("{}", explain(name, &block, false, err));
            }
            let parts = context::text("whatever a host most recently sensed");
            if let Err(err) = attached(block, parts) {
                panic!("{}", explain(name, &block, true, err));
            }
        }
    }
}

fn spec_of(frontmatter: &str) -> agent::AgentSpec {
    let file = format!("---\nname: main\ndescription: d\n{frontmatter}---\nbody");
    parse_agent_file("main", &file).expect("the file parses")
}

/// `space:` IS a faculty declaration, which is what keeps this a
/// generalisation of the old key rather than a second mechanism beside it —
/// and naming it twice declares it ONCE, because a duplicated block id is
/// `DuplicateSection` and that refuses the whole document.
#[test]
fn a_space_key_and_a_faculties_key_together_declare_one_faculty_once() {
    assert_eq!(declared_faculties(&spec_of("space: research\n")), [SPACE_FACULTY]);
    assert_eq!(declared_faculties(&spec_of("faculties: [space]\n")), [SPACE_FACULTY]);
    let both = spec_of("space: research\nfaculties: [space]\n");
    assert_eq!(declared_faculties(&both), [SPACE_FACULTY], "declared twice, once");
    // …and the paper that produces is legal, which is the failure being avoided.
    let mut state = AgentState::new();
    adopt_spec(&mut state, &both, &[]);
    let document = context::assemble(&state.paper, PhaseId::Work, Budget::unlimited());
    assert!(context::validate(&document).is_ok(), "one id, one section");
}

/// A name that is not a faculty costs its own blocks and tools and NOTHING
/// else (I15). It is not refused at parse time either: refusing would make the
/// name a rule about load order rather than about capability, which is
/// `subagent::unresolved_tools`' ruling one key over.
#[test]
fn an_unknown_faculty_is_carried_and_contributes_nothing() {
    let spec = spec_of("space: research\nfaculties: [browser, space]\n");
    assert_eq!(spec.faculties, ["browser", "space"], "the file's line is kept as written");
    let declared = declared_faculties(&spec);
    assert_eq!(declared, [SPACE_FACULTY, "browser"], "the space's key is read first");
    assert!(faculty_of("browser").is_none());
    let blocks = blocks_of(&declared);
    assert_eq!(blocks.len(), 1, "one known faculty, one block: {blocks:?}");
    assert_eq!(blocks[0].id, SPACE_FACULTY);
    // And the agent still runs: it adopts, and its toolbox is the space's.
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    assert!(state.toolbox.get("exec").is_some(), "an absent faculty broke nothing");
}

/// A space name that could walk out of `spaces/` declares nothing, because the
/// gate has to stay exactly where `Space::named` put it: a faculty that
/// granted the workspace tools to an agent with no folder would be a widening
/// dressed as a refactor.
#[test]
fn a_space_name_that_resolves_to_nothing_declares_no_faculty() {
    let spec = spec_of("space: ../etc\n");
    assert!(declared_faculties(&spec).is_empty(), "no space, no faculty");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    assert!(state.toolbox.get("exec").is_none(), "…and no workspace (ADR-006)");
}

/// The `faculties:` key in BOTH shapes, like `tools:` and `stages:` — and the
/// block-list branch keeping them apart, which it used to do by treating
/// everything that was not `stages` as `tools`.
#[test]
fn faculties_parses_inline_and_as_a_block_list_without_feeding_the_toolbox() {
    assert_eq!(spec_of("faculties: [space, browser]\n").faculties, ["space", "browser"]);
    let block = spec_of("faculties:\n  - space\n  - browser\ntools:\n  - now\n");
    assert_eq!(block.faculties, ["space", "browser"]);
    assert_eq!(block.tools, ["now"], "a faculty item must not land in the toolbox");
    // A shape it cannot read is still refused, exactly as `tools:` is.
    let file = "---\nname: main\ndescription: d\nfaculties: space\n---\nbody";
    let refusal = parse_agent_file("main", file).expect_err("a bare scalar is not a list");
    assert!(format!("{refusal:?}").contains("faculties"), "{refusal:?}");
}

fn at(kind: EventKind) -> Event {
    Event { id: EventId(0), seq: 0, at: AT, kind }
}

/// One agent file adopted, asked a question, and given a reply to act on.
fn replying(frontmatter: &str, reply: &str) -> Vec<Effect> {
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec_of(frontmatter), &[]);
    let (state, _) = step(
        state,
        at(EventKind::UserMessage {
            text: "get this done".into(),
            agent: String::new(),
            from: String::new(),
        }),
    );
    step(state, at(EventKind::ModelReplied { text: reply.into(), agent: String::new() })).1
}

/// SPAWNING IS DELEGATING. A spawned agent is a goal handed to an agent that
/// already exists, so it produces the same `Effect::Delegate` a sub-agent tool
/// does and every downstream guarantee — the concurrent batch, the callee's
/// own Worker, the board status, the `ToolInvoked` envelope — is inherited
/// rather than rebuilt.
#[test]
fn spawn_agent_hands_the_named_agent_the_goal_it_was_given() {
    let effects = replying(
        "tools: [spawn_agent]\n",
        "spawn_agent({\"agent\": \"researcher\", \"goal\": \"find what the licence costs\"})",
    );
    match &effects[0] {
        Effect::Delegate { agent, goal, .. } => {
            assert_eq!(agent, "researcher");
            assert_eq!(goal, "find what the licence costs", "what it was given, verbatim");
        }
        other => panic!("spawning is a delegation: {other:?}"),
    }
}

/// AN EMPTY GOAL IS NEVER DELIVERED. A sub-agent handed one answers it anyway,
/// which is the failure the refusal machinery exists to prevent — so it comes
/// back as a recorded tool RESULT naming the fix, never as a dropped call.
#[test]
fn a_spawn_with_no_goal_is_refused_in_words_that_say_how_to_rewrite_it() {
    for reply in [
        "spawn_agent({\"agent\": \"researcher\"})",
        "spawn_agent({\"agent\": \"researcher\", \"goal\": \"   \"})",
        "spawn_agent({\"goal\": \"find what the licence costs\"})",
    ] {
        let effects = replying("tools: [spawn_agent]\n", reply);
        match &effects[0] {
            Effect::Emit { kind: EventKind::ToolInvoked { tool, ok, output, .. } } => {
                assert_eq!((tool.0.as_str(), *ok), ("spawn_agent", false), "{reply}");
                assert!(output.contains("spawn_agent({\"agent\":"), "the shape: {output}");
                assert!(output.contains("\"goal\""), "…including the field: {output}");
            }
            other => panic!("an unreadable call is a recorded refusal: {other:?}"),
        }
    }
}

/// It is subject to the allowlist like any other tool. A faculty and a
/// built-in both only make a name AVAILABLE; a non-empty `tools:` list is what
/// grants it (ALIGNMENT §1).
#[test]
fn spawn_agent_is_allowlisted_like_every_other_tool() {
    let effects = replying("tools: [now]\n", "spawn_agent({\"agent\": \"a\", \"goal\": \"b\"})");
    match &effects[0] {
        Effect::Emit { kind: EventKind::ToolInvoked { ok, output, .. } } => {
            assert!(!ok);
            assert!(output.contains("Tool not found"), "{output}");
        }
        other => panic!("an ungranted tool is refused, not run: {other:?}"),
    }
}

/// THE TABLE IS THE WHOLE ANSWER, both directions. `of` answers to every name
/// the registry lists and to nothing else — no near-miss, no empty string, and
/// no name that merely sounds like a capability this build might have.
#[test]
fn of_answers_to_every_name_in_the_table_and_to_nothing_outside_it() {
    for name in faculty_names() {
        assert!(faculty_of(name).is_some(), "the table lists '{name}'");
    }
    for missing in ["memory_", "", "browser", "Memory", " memory"] {
        assert!(faculty_of(missing).is_none(), "'{missing}' is not a faculty");
    }
}

/// THE SECOND FACULTY, declared by one word in one file: it contributes its
/// block at the slot that was declared for it and never filled, and it offers
/// its two tools. No edit to `components::dynamic`, no edit to the toolbox.
#[test]
fn a_memory_faculty_contributes_its_block_and_offers_its_two_tools() {
    let spec = spec_of("faculties: [memory]\n");
    let declared = declared_faculties(&spec);
    assert_eq!(declared, [MEMORY_FACULTY], "one word declares it");
    let blocks = blocks_of(&declared);
    assert_eq!(blocks.len(), 1, "one faculty, one block: {blocks:?}");
    assert_eq!(blocks[0].id, MEMORY_FACULTY);
    assert_eq!(blocks[0].slot, context::Slot::MEMORY, "the slot that waited for it");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    assert!(state.toolbox.get("keep").is_some(), "keep is offered");
    assert!(state.toolbox.get("discard").is_some(), "discard is offered");
}

/// MEMORY NEEDS NO SPACE, AND DRAGS NO WORKSPACE. That is the whole reason it
/// is a faculty of its own rather than three more tools on the space: an agent
/// that names no folder has somewhere to keep something, and keeping it does
/// not hand anyone a shell (ADR-006, default deny).
#[test]
fn memory_without_a_space_offers_its_own_tools_and_nothing_of_the_spaces() {
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec_of("faculties: [memory]\n"), &[]);
    assert!(state.toolbox.get("keep").is_some());
    assert!(state.toolbox.get("discard").is_some());
    assert!(state.toolbox.get("exec").is_none(), "no space, no workspace");
    assert!(state.toolbox.get("remember").is_none(), "…and no shared space");
}

/// A FACULTY WIDENS WHAT MAY BE PICKED FROM AND GRANTS NOTHING. The same
/// allowlist decides, so `tools: [keep]` grants exactly `keep` — and without
/// the faculty the same line grants nothing at all and is REPORTED as
/// unresolved rather than silently dropped.
#[test]
fn a_faculty_only_widens_the_allowlist_it_never_grants() {
    let with = spec_of("faculties: [memory]\ntools: [keep]\n");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &with, &[]);
    assert!(state.toolbox.get("keep").is_some(), "the list named it and it was offered");
    assert!(state.toolbox.get("discard").is_none(), "the list is the whole grant");
    assert!(unresolved_tools(&with, &[]).is_empty(), "nothing was dropped");

    let without = spec_of("tools: [keep]\n");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &without, &[]);
    assert!(state.toolbox.get("keep").is_none(), "no faculty, nothing to pick");
    assert_eq!(unresolved_tools(&without, &[]), ["keep"], "and it is said out loud");
}

/// EVERY REFUSAL IS SPOKEN. A silent success leaves the agent believing it
/// wrote something it did not, and it spends the next turn acting on a memory
/// that is not there — so each of the three no-ops says which one it was, and
/// the failed discard names what is actually held.
#[test]
fn memory_says_plainly_when_nothing_was_kept_or_dropped() {
    let mut memory = Memory::default();
    let (said, change) = memory.keep("   ");
    assert_eq!(said, "Nothing kept: the note was empty.");
    assert!(change.is_none() && memory.notes.is_empty());

    let (_, change) = memory.keep("  she   prefers   short   answers ");
    assert!(change.is_some(), "and it is collapsed to one line");
    assert_eq!(memory.notes, ["she prefers short answers"]);

    let (said, change) = memory.keep("she prefers short answers");
    assert_eq!(said, "That line is already in your memory.");
    assert!(change.is_none(), "one line, not two");
    assert_eq!(memory.notes.len(), 1);

    let (said, change) = memory.discard("something else entirely");
    assert!(change.is_none(), "nothing was there to drop");
    assert!(said.contains("she prefers short answers"), "it names what IS held: {said}");

    let (_, change) = memory.discard("she prefers short answers");
    assert!(change.is_some() && memory.notes.is_empty(), "word for word, it goes");
    let (said, _) = memory.discard("anything");
    assert!(said.contains("nothing"), "an empty memory says so: {said}");
}

/// THE OLDEST FALLS OFF, not the newest. A memory read inside every prompt may
/// never become the prompt, and which end is dropped is the whole decision.
#[test]
fn memory_keeps_the_newest_and_drops_the_oldest() {
    let mut memory = Memory::default();
    for i in 0..MEMORY_LIMIT + 3 {
        memory.keep(&format!("line {i}"));
    }
    assert_eq!(memory.notes.len(), MEMORY_LIMIT, "the ceiling holds");
    assert_eq!(memory.notes[0], "line 3", "the three oldest went");
    assert_eq!(memory.notes[MEMORY_LIMIT - 1], format!("line {}", MEMORY_LIMIT + 2));
}
