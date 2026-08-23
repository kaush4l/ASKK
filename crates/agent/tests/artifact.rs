//! THE SHELF, PURE (I3): the type this tree did not have, the words it renders,
//! what a full one costs, and the one thing every faculty block must be — the
//! same in every flow the turn could take.
//!
//! `grep -rn 'struct Artifact\|enum Artifact' crates` returned 0 before this
//! increment. That is the whole reason it exists, so the first test is the
//! headline read back as an assertion rather than as a grep.

use agent::{
    adopt_spec, artifact_parts, parse_agent_file, step, unresolved_tools, AgentState, Artifact,
    Effect, Route, Shelf, Toolbox, ARTIFACTS_FACULTY, SHELF_LIMIT,
};
use context::{render, ContentPart, ProviderFormat, Role};
use kernel::{Event, EventId, EventKind, Timestamp};

mod common;

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");
const AT: Timestamp = Timestamp(1_753_800_000_000);
const FMT: ProviderFormat = ProviderFormat::OpenAiChat { vision: false, audio: false };

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

/// One artifact, deterministic, so a rendered cost has a number and not a mood.
fn one(n: usize) -> Artifact {
    let mut shelf = Shelf::default();
    let (_, recorded) = shelf.record(
        "research",
        "main",
        Artifact {
            name: format!("out/report-{n:02}.md"),
            kind: "report".into(),
            description: "what the survey found and what it did not settle".into(),
            audience: "the person who asked".into(),
            bytes: Some(4096),
            ..Artifact::default()
        },
    );
    recorded.expect("a named, described artifact records")
}

fn shelf_of(count: usize) -> Shelf {
    let mut shelf = Shelf::default();
    for n in 0..count {
        shelf.items.push(one(n));
    }
    shelf
}

/// The toolbox of an agent granted exactly these names, resolved the real way.
fn holding(tools: &str) -> Toolbox {
    let file = format!(
        "---\nname: a\ndescription: d\nspace: research\nfaculties: [artifacts]\ntools: {tools}\n\
         ---\nbody"
    );
    let spec = parse_agent_file("a", &file).expect("the file parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    state.toolbox
}

fn flat(parts: &[context::Part]) -> String {
    parts
        .iter()
        .filter_map(|p| match p {
            context::Part::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

/// **THE HEADLINE, AS AN ASSERTION.** A typed, addressable object with the
/// eight fields the increment named — and `uri` and `revision` and `by`
/// assigned by the shelf rather than by whoever called it.
#[test]
fn an_artifact_is_a_typed_addressable_object_the_shelf_stamps_itself() {
    let mut shelf = Shelf::default();
    let (said, first) = shelf.record(
        "research",
        "main",
        Artifact {
            name: " out/report.md ".into(),
            description: "  the survey  ".into(),
            // A model that wrote its own uri, revision or author would be
            // writing three facts it does not own; they are overwritten.
            uri: "artifact://somewhere/else".into(),
            revision: 99,
            by: "somebody-else".into(),
            bytes: Some(12),
            ..Artifact::default()
        },
    );
    let first = first.expect("a named, described artifact records");
    assert_eq!(first.name, "out/report.md", "trimmed, because ' x ' is a typo");
    assert_eq!(first.uri, "artifact://research/out/report.md", "addressed by the shelf");
    assert_eq!(first.revision, 1);
    assert_eq!(first.by, "main", "the process, never the argument");
    assert_eq!(first.kind, "file", "a blank kind takes a plain word");
    assert_eq!(first.audience, "anyone working in this space");
    assert_eq!(first.bytes, Some(12));
    assert!(said.contains("On the shelf"), "{said}");

    // …and recording the same name REPLACES, counting up. Two entries for one
    // file would put both in every prompt and let the model pick.
    let (said, again) = shelf.record(
        "research",
        "main",
        Artifact {
            name: "out/report.md".into(),
            description: "the survey, corrected".into(),
            ..Artifact::default()
        },
    );
    assert_eq!(again.expect("it records").revision, 2);
    assert_eq!(shelf.items.len(), 1, "one file, one entry: {:?}", shelf.items);
    assert!(said.contains("Revision 2"), "and the agent is told it moved: {said}");
}

/// EVERY REFUSAL IS SPOKEN, and neither refusal touches the shelf. A silent
/// no-op leaves the agent believing it published something it did not, and it
/// spends the next turn telling somebody to go and read it.
#[test]
fn the_shelf_says_plainly_when_nothing_was_recorded() {
    let mut shelf = Shelf::default();
    let (said, none) = shelf.record("research", "main", Artifact::default());
    assert!(none.is_none() && shelf.items.is_empty());
    assert!(said.contains("record_artifact({"), "it ends in the line to write: {said}");

    let (said, none) = shelf.record(
        "research",
        "main",
        Artifact { name: "out/x.md".into(), ..Artifact::default() },
    );
    assert!(none.is_none() && shelf.items.is_empty());
    assert!(said.contains("description"), "and it names what was missing: {said}");
    assert_eq!(shelf.names(), "nothing", "an empty shelf says so");
}

/// **THE WORDS ARE TOOLBOX-DERIVED**, exactly as `space_parts` is: an agent
/// holding no reader is told what is on the shelf and never offered a call it
/// does not have (I15). Three grants, three closings.
#[test]
fn the_block_names_only_the_calls_this_agent_actually_holds() {
    let shelf = shelf_of(1);
    let both = flat(&artifact_parts(&shelf, &holding("[record_artifact, read_artifact]")));
    assert!(both.contains("read_artifact opens"), "{both}");
    assert!(both.contains("record_artifact puts"), "{both}");

    let reader = flat(&artifact_parts(&shelf, &holding("[read_artifact]")));
    assert!(reader.contains("read_artifact opens"), "{reader}");
    assert!(!reader.contains("record_artifact"), "not offered what it lacks: {reader}");

    let neither = flat(&artifact_parts(&shelf, &holding("[now]")));
    assert!(neither.contains("out/report-00.md"), "it is still TOLD: {neither}");
    assert!(!neither.contains("read_artifact"), "and offered nothing: {neither}");
    assert!(!neither.contains("record_artifact"), "{neither}");
}

/// AN EMPTY SHELF RENDERS NOTHING AT ALL — no heading, no apology. Emptiness
/// becomes `Fidelity::Elided`, which is how the paper already spells absent.
#[test]
fn a_group_that_has_produced_nothing_gets_no_block() {
    assert!(artifact_parts(&Shelf::default(), &holding("[read_artifact]")).is_empty());
}

/// **THE CAP HAS A NUMBER BEHIND IT** (and it is a RENDER cap, so nothing is
/// deleted to obtain it). A full shelf costs this, measured — and one past full
/// says how many it did not show, because a block that quietly truncated would
/// be the paper lying about what the group has (I16).
#[test]
fn a_full_shelf_costs_a_measured_number_and_an_overfull_one_says_so() {
    let full = flat(&artifact_parts(&shelf_of(SHELF_LIMIT), &holding("[read_artifact]")));
    assert_eq!(full.lines().count(), SHELF_LIMIT + 1, "twenty entries and one closing line");
    // PINNED. If this moves, the shelf got wordier and every agent in every
    // space is paying for it on every single call — `crates/agent/tests/
    // prompt.rs`'s budget guard is what turns that into a failure, and this is
    // what says by how much.
    assert_eq!(full.len(), 2_741, "a full shelf, in bytes:\n{full}");

    let over = flat(&artifact_parts(&shelf_of(SHELF_LIMIT + 3), &holding("[read_artifact]")));
    assert!(over.contains("…and 3 more on this shelf"), "{over}");
    assert_eq!(over.lines().count(), SHELF_LIMIT + 2, "twenty, the count, the closing");
}

/// THE PORT'S REAL ANSWER, IN THE WORDS. This is the cross-thread ruling read
/// at the vocabulary layer: a record made where no workspace would answer says
/// `unconfirmed` rather than a number nobody measured.
#[test]
fn an_artifact_nothing_confirmed_is_rendered_unconfirmed_and_not_sized() {
    let mut shelf = Shelf::default();
    shelf.record(
        "research",
        "worker",
        Artifact {
            name: "out/from-a-worker.md".into(),
            description: "written where no workspace answers".into(),
            bytes: None,
            ..Artifact::default()
        },
    );
    let block = flat(&artifact_parts(&shelf, &holding("[read_artifact]")));
    assert!(block.contains("unconfirmed"), "{block}");
    assert!(!block.contains("bytes"), "no size is claimed at all: {block}");
}

/// THE SHIPPED AGENT REALLY HOLDS BOTH CALLS. A faculty only widens what a
/// non-empty `tools:` list may PICK FROM (`tests/faculty.rs::
/// a_faculty_only_widens_the_allowlist_it_never_grants`), so the file has to
/// name them — and nothing it names may be dropped on the floor.
#[test]
fn the_shipped_main_agent_resolves_both_artifact_tools_and_drops_nothing() {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    assert!(spec.faculties.contains(&"artifacts".to_string()), "{:?}", spec.faculties);
    let critic = parse_agent_file("critic", include_str!("../../../public/agents/critic/agent.md"))
        .expect("the shipped critic parses");
    assert!(
        unresolved_tools(&spec, &[critic]).is_empty(),
        "every name in the shipped list resolves: {:?}",
        unresolved_tools(&spec, &[])
    );
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    assert!(state.toolbox.get("record_artifact").is_some(), "adopted");
    assert!(state.toolbox.get("read_artifact").is_some(), "adopted");
}

/// The rendered bytes of one paper, through the real `step`, with a host having
/// left the shelf's parts under the block's id — which is what a host does.
fn rendered(shelf: &Shelf, stages: &[String], phase_scoped: bool) -> String {
    let spec = parse_agent_file("main", MAIN).expect("the shipped main agent parses");
    let mut state = AgentState::new();
    adopt_spec(&mut state, &spec, &[]);
    common::brief(&mut state);
    state.senses.insert(agent::SPACE_FACULTY.to_string(), agent::space_parts(&state.space, &state.toolbox));
    // THE SENSE USES THE AGENT'S OWN TOOLBOX, which is what `Sensing.tools`
    // carries (`crates/core/src/faculty/run.rs`, `about`). `phase_scoped` is
    // the POSITIVE CONTROL below: it feeds the block something route-shaped
    // instead, which is the exact defect the byte-identity assertion guards.
    let tools = match (phase_scoped, agent::tools_on(&stages[0])) {
        (true, false) => Toolbox::of(Vec::new()),
        _ => state.toolbox.clone(),
    };
    state.senses.insert(ARTIFACTS_FACULTY.to_string(), artifact_parts(shelf, &tools));
    state.declared = stages.to_vec();
    state.stages = stages.to_vec();
    let (_, effects) = step(state, user("write up what you found"));
    let document = effects
        .iter()
        .find_map(|e| match e {
            Effect::CallModel { document, .. } => Some(document.clone()),
            _ => None,
        })
        .expect("asking a question calls the model");
    let messages = render(&document, FMT);
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

/// The paper's own headings, in order — a line that STARTS with `## `.
fn heads(prompt: &str) -> Vec<&str> {
    prompt.lines().filter(|l| l.starts_with("## ")).collect()
}

/// One `## <id>` section's body, exactly as the model reads it.
fn section(prompt: &str, id: &str) -> String {
    let at = prompt
        .find(&format!("## {id}\n"))
        .unwrap_or_else(|| panic!("no `## {id}` in:\n{prompt}"));
    let rest = &prompt[at..];
    match rest[3..].find("\n## ") {
        Some(end) => rest[..end + 4].to_string(),
        None => rest.to_string(),
    }
}

/// **THE ANTI-ONE-FLOW TEST.** The catalog renders for EVERY route, identically,
/// while the turn's own instruction does not — which is what makes
/// `## artifacts` a property of the group and not of the flow.
///
/// **THE ROADMAP'S WORDING DID NOT SURVIVE MEASUREMENT AND IS CORRECTED HERE.**
/// It asked for a `## directive` block that DIFFERS between the three routes.
/// `public/stages/` ships five briefs — strategy, plan, verify, critique,
/// durable (`agent::BRIEF_KEYS`) — and neither `answer` nor `work` is among
/// them, so `stages::enter` writes no directive at all under `Route::Answer` or
/// `Route::React`. Present-under-one-and-absent-under-two IS the difference the
/// criterion was reaching for; asserting three different bodies would have been
/// asserting something this build does not do.
///
/// BOTH HALVES CARRY A POSITIVE CONTROL, because either alone is vacuous: three
/// identical papers would satisfy "the artifacts match" trivially, and three
/// papers sharing nothing would satisfy "the flows differ". The controls are
/// the two tests below, and they are RUN rather than described (I17).
#[test]
fn the_catalog_renders_the_same_under_every_route_while_the_flow_does_not() {
    let shelf = shelf_of(2);
    let papers: Vec<(Route, String)> = [Route::Answer, Route::React, Route::Project]
        .iter()
        .map(|r| (*r, rendered(&shelf, &r.stages(), false)))
        .collect();
    let artifacts: Vec<String> = papers.iter().map(|(_, p)| section(p, "artifacts")).collect();

    assert!(artifacts[0].contains("out/report-00.md"), "it is really there: {}", artifacts[0]);
    for (route, block) in papers.iter().map(|(r, _)| r).zip(&artifacts) {
        assert_eq!(
            *block, artifacts[0],
            "`## artifacts` is not the same under {} as under answer",
            route.as_str()
        );
    }
    // …and the turn really is a different turn under each of them.
    let directive = |p: &str| heads(p).contains(&"## directive");
    assert!(!directive(&papers[0].1), "answer is briefed by nothing");
    assert!(!directive(&papers[1].1), "nor is work");
    assert!(directive(&papers[2].1), "plan is, and project opens on plan");
    assert_ne!(heads(&papers[0].1), heads(&papers[2].1), "two different papers");
}

/// POSITIVE CONTROL FOR THE FIRST HALF, RUN: three routes really do produce
/// three different papers, so "byte-identical artifacts" is a fact about the
/// block and not about the comparison.
#[test]
fn the_three_routes_really_do_produce_three_different_papers() {
    let shelf = shelf_of(2);
    let papers: Vec<String> = [Route::Answer, Route::React, Route::Project]
        .iter()
        .map(|r| rendered(&shelf, &r.stages(), false))
        .collect();
    assert_ne!(papers[0], papers[1]);
    assert_ne!(papers[1], papers[2]);
    assert_ne!(papers[0], papers[2]);
}

/// POSITIVE CONTROL FOR THE SECOND HALF, RUN: a sense fed something ROUTE-SHAPED
/// — the stage's granted toolbox rather than the agent's own — does make the
/// block differ between routes. That is the defect the byte-identity assertion
/// exists to catch, and this is it happening.
#[test]
fn a_sense_fed_the_stages_toolbox_would_make_the_catalog_differ_by_route() {
    let shelf = shelf_of(2);
    let answer = section(&rendered(&shelf, &Route::Answer.stages(), true), "artifacts");
    let react = section(&rendered(&shelf, &Route::React.stages(), true), "artifacts");
    assert_ne!(
        answer, react,
        "if this ever passes, the control is dead and the assertion it guards is vacuous"
    );
}
