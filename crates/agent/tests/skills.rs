//! SKILLS: instruction loaded on demand, and every rule that makes it safe to
//! load. Pure — no browser, no network (I3).
//!
//! The four rules under test are the ones the increment is FOR: nothing
//! installed says so in words (I15), a load is a fact a reader can see in the
//! trace and in the window (I8), a skill that is gone is a refusal that NAMES
//! it rather than a failed turn (the allowlist's rule), and a skill runs
//! nothing — its whole result is text.

use agent::{
    catalogue, instruction, parse_skill_file, skills, step, toolbox_for, AgentState, Effect, Skill,
    LIST_SKILLS, NONE_INSTALLED, READ_SKILL,
};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

const MANIFEST: &str = include_str!("../../../public/skills/index.json");

fn ev(kind: EventKind) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    }
}

/// An agent with the two skill tools granted, mid-turn, ready to reply.
fn asked(tools: &str) -> AgentState {
    let mut state = AgentState::new();
    let file = format!("---\nname: main\ndescription: d\ntools: [{tools}]\n---\nbody");
    let spec = agent::parse_agent_file("main", &file).expect("spec parses");
    agent::adopt_spec(&mut state, &spec, &[]);
    let (state, _) = step(
        state,
        ev(EventKind::UserMessage {
            text: "write me an agent".into(),
            agent: String::new(),
            from: String::new(),
        }),
    );
    state
}

/// The one effect a reply produces.
fn only(state: AgentState, reply: &str) -> (AgentState, Effect) {
    let (state, effects) = step(
        state,
        ev(EventKind::ModelReplied {
            text: reply.into(),
            agent: String::new(),
        }),
    );
    assert_eq!(effects.len(), 1, "one call, one effect: {effects:?}");
    let effect = effects.into_iter().next().expect("one");
    (state, effect)
}

/// The `ToolInvoked` fact an effect carries, or a panic naming what it was.
fn fact(effect: &Effect) -> (&str, bool, &str) {
    match effect {
        Effect::Emit {
            kind: EventKind::ToolInvoked { tool, ok, output, .. },
        } => (tool.0.as_str(), *ok, output.as_str()),
        other => panic!("a skill tool answers with a recorded result: {other:?}"),
    }
}

/// A static host cannot list a directory, so the manifest IS the listing — and
/// a manifest that disagrees with what the build holds is the failure mode that
/// makes the file worthless. It names exactly the installed skills.
#[test]
fn the_manifest_names_exactly_the_installed_skills() {
    let listed: Vec<String> = serde_json::from_str::<serde_json::Value>(MANIFEST)
        .expect("the manifest is JSON")
        .get("skills")
        .and_then(|s| serde_json::from_value(s.clone()).ok())
        .expect("it has a skills list");
    let built: Vec<String> = skills().into_iter().map(|s| s.name).collect();
    assert_eq!(listed, built, "public/skills/index.json vs the build");
    assert!(listed.len() >= 2, "two real skills ship: {listed:?}");
}

/// Every shipped skill parses, says what it is for, and carries instruction —
/// the description is what a model reads when deciding to spend the context.
#[test]
fn every_shipped_skill_says_what_it_is_for_and_carries_instruction() {
    for skill in skills() {
        assert!(!skill.description.is_empty(), "{} has no description", skill.name);
        assert!(skill.body.len() > 400, "{} is a placeholder", skill.name);
        assert!(!skill.body.starts_with("---"), "{}: the frontmatter is not the body", skill.name);
    }
    let rules = skills().into_iter().find(|s| s.name == "agent-file").expect("shipped");
    // It is the house rules for an agent file, so it must hold the refusals
    // `spec.rs` actually makes — a skill that describes a different product is
    // worse than none.
    for rule in ["engine: base", "stages", "passes", "tools: []", "space:"] {
        assert!(rules.body.contains(rule), "agent-file omits {rule}");
    }
    let calls = skills().into_iter().find(|s| s.name == "tool-calls").expect("shipped");
    assert!(calls.body.contains("\\n"), "the escaping rule is the point of it");
}

/// A file that cannot say what it is for is REFUSED, not defaulted: an empty
/// description is a skill nothing can decide to load.
#[test]
fn a_skill_that_cannot_say_what_it_is_for_is_refused() {
    let ok = parse_skill_file("x", "---\nname: x\ndescription: does a thing\n---\nDo the thing.")
        .expect("parses");
    assert_eq!(ok.name, "x");
    assert_eq!(ok.body, "Do the thing.");
    assert!(parse_skill_file("x", "---\nname: x\n---\nbody").is_err(), "no description");
    assert!(parse_skill_file("x", "no frontmatter").is_err(), "no frontmatter");
    assert!(parse_skill_file("x", "---\nname: x\ndescription: d\n---\n  ").is_err(), "no body");
    // The folder names the skill when the frontmatter does not.
    let fallback = parse_skill_file("folder", "---\ndescription: d\n---\nbody").expect("parses");
    assert_eq!(fallback.name, "folder");
}

/// I15: nothing installed is SAID, in words, and never an empty list dressed as
/// a result — and a name asked for against an empty shelf still comes back
/// naming the name.
#[test]
fn with_no_skill_installed_the_tool_says_exactly_that() {
    assert_eq!(catalogue(&[]), NONE_INSTALLED);
    assert_eq!(NONE_INSTALLED, "No skills are installed in this browser.");
    let refusal = instruction(&[], "{\"name\": \"agent-file\"}").expect_err("nothing to read");
    assert!(refusal.contains("agent-file"), "it names what was asked for: {refusal}");
    assert!(refusal.contains(NONE_INSTALLED), "and why there is none: {refusal}");
    // The populated catalogue is names AND descriptions: the description is
    // the whole basis for choosing, so a bare list would not be one.
    let one = Skill {
        name: "brewing".into(),
        description: "How this house makes tea.".into(),
        body: "Warm the pot.".into(),
    };
    let text = catalogue(std::slice::from_ref(&one));
    assert!(text.contains("brewing: How this house makes tea."), "{text}");
    assert!(!text.contains("Warm the pot."), "the body costs nothing until it is read: {text}");
}

/// The load is a FACT (I8): calling `read_skill` emits a `ToolInvoked` with the
/// skill's body in it, so the trace shows which skill entered the context and
/// when — and the next model call carries that body in its Document (I13).
#[test]
fn loading_a_skill_is_a_recorded_fact_and_the_body_reaches_the_next_call() {
    let state = asked("read_skill, list_skills");
    let (state, effect) = only(state, "read_skill({\"name\": \"agent-file\"})");
    let (tool, ok, output) = fact(&effect);
    assert_eq!((tool, ok), (READ_SKILL, true));
    assert!(output.starts_with("SKILL agent-file — "), "the fact names the skill: {output}");
    assert!(output.contains("engine: base"), "and holds the instruction");

    let (state, effects) = step(
        state,
        ev(EventKind::ToolInvoked {
            tool: ToolId(READ_SKILL.into()),
            args: "{\"name\": \"agent-file\"}".into(),
            ok: true,
            output: output.into(),
        }),
    );
    let window = agent::window(&state.paper).join("\n");
    assert!(window.contains("read_skill: SKILL agent-file"), "the window shows it: {window}");
    match effects.as_slice() {
        [Effect::CallModel { document, .. }] => {
            let sent = format!("{document:?}");
            assert!(sent.contains("frontmatter"), "the instruction reached the model: {sent}");
        }
        other => panic!("the result asks the model again: {other:?}"),
    }
}

/// The listing is one call and it holds every description — this is the whole
/// context economy: an agent pays two lines to know what it could load.
#[test]
fn listing_costs_the_descriptions_and_not_the_bodies() {
    let (_, effect) = only(asked("list_skills"), "list_skills({})");
    let (tool, ok, output) = fact(&effect);
    assert_eq!((tool, ok), (LIST_SKILLS, true));
    for skill in skills() {
        assert!(output.contains(&skill.description), "{} is not offered", skill.name);
        assert!(!output.contains(&skill.body), "{}'s body is in the list", skill.name);
    }
    assert!(output.contains("read_skill({\"name\": \"<skill>\"})"), "how to read one: {output}");
}

/// A SKILL THAT IS GONE COSTS A RESULT, NOT A TURN. Deleting or renaming one
/// must not break an agent that names it: the call comes back refused, naming
/// what was asked and what is here, and the loop carries straight on — the same
/// rule the tool allowlist already follows.
#[test]
fn a_skill_that_is_not_installed_is_refused_by_name_and_the_turn_carries_on() {
    let state = asked("read_skill");
    let (state, effect) = only(state, "read_skill({\"name\": \"brewing\"})");
    let (tool, ok, output) = fact(&effect);
    assert_eq!((tool, ok), (READ_SKILL, false));
    assert!(output.contains("No skill called 'brewing'"), "{output}");
    assert!(output.contains("agent-file"), "it lists what IS installed: {output}");
    // …and an empty name is refused in the words that name the fix, never
    // delivered as a load of nothing (`read_agent`'s discipline).
    let empty = instruction(&skills(), "{}").expect_err("no name");
    assert!(empty.contains("read_skill({\"name\": \"<skill>\"})"), "{empty}");

    let (state, effects) = step(
        state,
        ev(EventKind::ToolInvoked {
            tool: ToolId(READ_SKILL.into()),
            args: "{\"name\": \"brewing\"}".into(),
            ok: false,
            output: output.into(),
        }),
    );
    assert_eq!(state.pending_tools, 0);
    assert!(
        matches!(effects.as_slice(), [Effect::CallModel { .. }]),
        "the refusal is a result the model reads, not a failed turn: {effects:?}"
    );
}

/// A skill is opted into like everything else — through `tools:`. No second
/// allowlist, and no skill anywhere near an agent that did not name it.
#[test]
fn an_agent_gets_the_skill_tools_only_when_its_file_names_them() {
    let spec = |tools: &str| {
        let file = format!("---\nname: a\ndescription: d\ntools: [{tools}]\n---\nbody");
        agent::parse_agent_file("a", &file).expect("parses")
    };
    let named = toolbox_for(&spec("now, read_skill"), &[]);
    assert!(named.get(READ_SKILL).is_some(), "named, so granted");
    assert!(named.get(LIST_SKILLS).is_none(), "not named, not granted");
    let all = toolbox_for(&spec(""), &[]);
    assert!(all.get(READ_SKILL).is_some(), "an empty list is every built-in");
    // The refusal an ungranted call gets is the allowlist's, unchanged.
    let call = &agent::parse_batches("read_skill({\"name\": \"agent-file\"})")[0][0];
    let refused = toolbox_for(&spec("now"), &[]).check(call).expect_err("not granted");
    assert!(refused.error.contains("Tool not found. Available: now"), "{}", refused.error);
}

/// The shipped agents that opted in, asserted off the shipped files — the
/// increment is not done if the capability ships with nobody holding it.
///
/// `author` is NOT in this list and wants the `agent-file` skill more than
/// either of them: `crates/core/tests/capability32.rs` asserts that agent's
/// resolved toolset as an exact string, which is outside this increment's
/// files. Its own frontmatter says the same, beside the line that would change.
#[test]
fn the_shipped_agents_that_opted_in_name_both_tools() {
    for (dir, text) in [
        ("builder", include_str!("../../../public/agents/builder/agent.md")),
        ("main", include_str!("../../../public/agents/main/agent.md")),
    ] {
        let spec = agent::parse_agent_file(dir, text).expect("the shipped file parses");
        assert!(spec.tools.iter().any(|t| t == LIST_SKILLS), "{dir} cannot list skills");
        assert!(spec.tools.iter().any(|t| t == READ_SKILL), "{dir} cannot read one");
    }
}

/// THE PROMPT THAT TEACHES THE TOOL LIST CANNOT BE SHORT OF ONE (34 walk).
///
/// `author` writes other agents' files, so its prompt enumerates the built-ins
/// for the model to choose from — and that list went stale the moment this
/// increment added two. A tool the writer has never heard of is a tool no
/// written agent will ever name, which is a feature shipped and then hidden.
/// Asserted against the registry rather than against a copy of it, so the next
/// built-in fails here instead of quietly narrowing what can be built.
#[test]
fn the_agent_that_writes_agents_is_told_every_builtin_there_is() {
    let prompt = include_str!("../../../public/agents/author/agent.md");
    for tool in agent::builtin_tools().tools {
        assert!(
            prompt.contains(&format!("`{}`", tool.name)),
            "author's prompt never names the built-in `{}`, so no agent it \
             writes can ask for it",
            tool.name
        );
    }
}
