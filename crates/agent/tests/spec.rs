//! `agent.md` parsing and loading (increment 03). Host-only, pure crates,
//! no browser and no network (I3) — the files arrive as bytes either way.

use agent::{load_agents, parse_agent_file};

/// The real shipped file, with every frontmatter key the Python loader
/// knows: name, description, model, temperature, engine, tools, space.
const REAL: &str = include_str!("../../../public/agents/main/agent.md");
const SUMMARIZER: &str = include_str!("agents/summarizer.md");

#[test]
fn parses_every_frontmatter_key_and_the_body() {
    let spec = parse_agent_file("main", REAL).expect("the shipped main agent parses");
    assert_eq!(spec.name, "main");
    assert_eq!(
        spec.description,
        "General-purpose assistant, the agent this page talks to."
    );
    assert_eq!(spec.model, "local");
    assert_eq!(spec.temperature, Some(0.7));
    assert_eq!(spec.engine, "react");
    assert_eq!(spec.space, "research");
    // The shipped file now NAMES its toolkit, and that list is what decides
    // the agent's toolbox (increment 06) rather than a hardcoded phase list —
    // including the space's tools, which `space:` makes nameable but no longer
    // appends after the filter (ALIGNMENT §5 item 1).
    assert_eq!(
        spec.tools,
        [
            "now",
            "list_agents",
            "read_agent",
            // The entry agent opted into skills: instruction it can pull in
            // when a job calls for it, and that costs nothing until it does.
            "list_skills",
            "read_skill",
            // The one call that leaves the browser for something other than
            // the model (increment 28 grants it; 21 built it). It is named
            // here and it still REFUSES until a person sets a search endpoint
            // in Settings — I2 keeps the allowlist theirs, so what shipped is
            // the capability and never the destination.
            "web_search",
            "remember",
            "forget",
            "post_note",
            "exec",
            "read_file",
            "write_file",
            // Granted in this increment, and only once the budget had room for
            // it: `edit_file` is named BESIDE `write_file`, not instead of it.
            // A whole-file write is right when a file is being authored and
            // wrong when one line of a large file is being changed.
            "edit_file",
            "list_files",
            "start_process",
            "list_processes",
            "read_process",
            "stop_process",
            "observe",
            "find_files",
            // The memory faculty's two (increment 27). They are nameable here
            // ONLY because `faculties: [memory]` is in the same frontmatter —
            // a faculty widens what a list may pick from, and this list picks.
            "keep",
            "discard",
            // Author a role, then set it working. Two turns, not one.
            "write_agent",
            "spawn_agent",
            // A PEER, not a built-in — and the one peer whose reply the
            // machine reads differently (increment 28). `critic` holds
            // `role: critic`, so its result is folded as a verdict and a turn
            // it did not clear cannot end as `answered`. Invocation is named:
            // without this line the whole seam is installed and unreachable.
            "critic"
        ]
    );
    // …and the key that made the last two of those nameable. `space: research`
    // above declares the space faculty under its older spelling; this is the
    // general form, and both end up in `declared_faculties`.
    assert_eq!(spec.faculties, ["memory"]);
    // The body after the frontmatter IS the system prompt — no fence, no
    // frontmatter, and not truncated.
    assert!(spec.prompt.starts_with("You are a helpful assistant."));
    assert!(spec.prompt.contains("## The shared space"));
    assert!(spec.prompt.contains("## Your own memory"));
    assert!(!spec.prompt.contains("---"));
}

#[test]
fn list_frontmatter_reads_both_yaml_forms() {
    let block = "---\nname: a\ntools:\n  - one\n  - two\n---\nbody";
    let inline = "---\nname: a\ntools: [one, two]\n---\nbody";
    for text in [block, inline] {
        let spec = parse_agent_file("a", text).expect("parses");
        assert_eq!(spec.tools, vec!["one".to_string(), "two".to_string()]);
        assert_eq!(spec.prompt, "body");
    }
}

#[test]
fn missing_or_unterminated_frontmatter_is_an_error() {
    assert!(parse_agent_file("a", "no frontmatter here").is_err());
    assert!(parse_agent_file("a", "---\nname: a\nstill going").is_err());
}

#[test]
fn name_defaults_to_the_folder_and_engine_to_the_loop_that_runs() {
    let spec = parse_agent_file("scout", "---\ndescription: x\n---\nbody").expect("parses");
    assert_eq!(spec.name, "scout");
    // NOT `base` any more (increment 19): `base` now means "no tools at all",
    // so a file that omits the line must default to the loop this build runs.
    assert_eq!(spec.engine, agent::ENGINE_REACT);
    assert_eq!(spec.temperature, None);
}

#[test]
fn a_project_agent_replaces_the_builtin_of_the_same_name() {
    let builtin = ("summarizer".to_string(), SUMMARIZER.to_string());
    let project = (
        "summarizer".to_string(),
        "---\nname: summarizer\ndescription: mine\n---\nMy own summarizer.".to_string(),
    );
    // Built-ins FIRST, project second — the Python `_agent_dirs` walk order.
    let (loaded, problems) = load_agents(vec![builtin, project]);
    assert_eq!(loaded.len(), 1, "one summarizer, not two");
    assert_eq!(loaded[0].description, "mine");
    assert_eq!(loaded[0].prompt, "My own summarizer.");
    assert!(problems.is_empty(), "nothing was skipped");
}

#[test]
fn a_malformed_file_costs_that_agent_and_nothing_else() {
    let files = vec![
        ("main".to_string(), REAL.to_string()),
        ("broken".to_string(), "I forgot the frontmatter".to_string()),
        (
            "worse".to_string(),
            "---\nname: worse\ntemperature: hot\n---\nbody".to_string(),
        ),
        ("summarizer".to_string(), SUMMARIZER.to_string()),
    ];
    let (loaded, problems) = load_agents(files);
    let names: Vec<&str> = loaded.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["main", "summarizer"]);
    // Skipping is correct; silence is not (`ux-walker`). Each skipped file is
    // named, with the reason it could not be read.
    assert_eq!(problems.len(), 2, "both broken files are reported: {problems:?}");
    assert!(problems.iter().any(|p| p.contains("broken/agent.md") && p.contains("frontmatter")));
    assert!(problems.iter().any(|p| p.contains("worse/agent.md") && p.contains("temperature")));
}

#[test]
fn the_loaded_prompt_becomes_the_agents_own_words() {
    let spec = parse_agent_file("main", REAL).expect("parses");
    let mut state = agent::AgentState::new();
    let before = format!("{:?}", state.paper);
    assert!(before.contains("You are HARNESS"), "seeded prompt to start");
    agent::adopt_spec(&mut state, &spec, &[]);
    let after = format!("{:?}", state.paper);
    assert!(!after.contains("You are HARNESS"), "hardcoded prompt is gone");
    assert!(after.contains("You are a helpful assistant."));
    assert!(after.contains("Name: main."));
}

/// A `tools:` value that is not a list is REFUSED, not discarded. Discarding
/// it left the list empty, and an empty list is every built-in — so
/// `tools: now` granted `write_agent` as well (11b walk). The same parser
/// already refuses `compact_at: lots`; failing towards MORE capability is the
/// one direction a silent default must never take.
#[test]
fn a_tools_line_that_is_not_a_list_is_refused_rather_than_granting_everything() {
    let file = "---\nname: narrow\ndescription: d\ntools: now\n---\nYou are narrow.";
    let error = parse_agent_file("narrow", file).expect_err("refused");
    let message = format!("{error:?}");
    assert!(message.contains("tools 'now' is not a list"), "{message}");

    // The two shapes it DOES read still read, and both mean what they say.
    let inline = parse_agent_file(
        "narrow",
        "---\nname: narrow\ntools: [now]\n---\nYou are narrow.",
    )
    .expect("inline list");
    assert_eq!(inline.tools, vec!["now".to_string()]);
    let block = parse_agent_file(
        "narrow",
        "---\nname: narrow\ntools:\n  - now\n  - read_agent\n---\nYou are narrow.",
    )
    .expect("block list");
    assert_eq!(block.tools, vec!["now".to_string(), "read_agent".to_string()]);
    // …and the empty list is the maximal grant it has always been.
    let all = parse_agent_file("wide", "---\nname: wide\ntools: []\n---\nYou are wide.")
        .expect("empty list");
    assert!(all.tools.is_empty());
}

/// An empty `name:` falls back to the folder — which is what the browser
/// editor's "Folder name" field is (11b walk). It used to be an error, so the
/// blank template the pane ships could not be saved at all.
#[test]
fn an_empty_frontmatter_name_falls_back_to_the_folder() {
    let spec = parse_agent_file("scribe", "---\nname: \ndescription: d\n---\nYou write.")
        .expect("parses");
    assert_eq!(spec.name, "scribe");
    let nameless = parse_agent_file("", "---\nname: \n---\nbody").expect_err("no name anywhere");
    assert!(format!("{nameless:?}").contains("name"), "{nameless:?}");
}

/// TWO FILES CLAIMING ONE JOB IS A PROBLEM, AND SAYING SO IS THE FIX.
///
/// Copying `public/agents/main/agent.md` is how a person writes a new agent —
/// there is no template and no scaffold — and that file carries `role: entry`
/// buried in its frontmatter. The copy then held the role too, `problems` came
/// back empty, and `role_holder` handed the conversation to whichever name
/// sorted first: a new `librarian` silently became the agent this page talks
/// to. Determinism was never the defect; SILENCE was.
#[test]
fn two_agents_claiming_one_role_is_reported_and_only_one_keeps_it() {
    let entry = |dir: &str| {
        (
            dir.to_string(),
            format!("---\nname: {dir}\ndescription: d\nrole: entry\n---\nYou answer."),
        )
    };
    let (loaded, problems) = load_agents(vec![entry("main"), entry("librarian")]);
    assert_eq!(loaded.len(), 2, "both agents still load: a collision is not a parse failure");
    assert_eq!(problems.len(), 1, "the collision is reported: {problems:?}");
    let said = &problems[0];
    assert!(said.contains("entry"), "the job is named: {said}");
    assert!(said.contains("librarian") && said.contains("main"), "both files are named: {said}");
    // FIRST BY NAME WINS, on `loader`'s determinism rule, and the loser does
    // not go on carrying a job it does not hold.
    let holder = agent::role_holder(&loaded, agent::ROLE_ENTRY).expect("someone holds it");
    assert_eq!(holder.name, "librarian", "sorted first, as it resolves on every boot");
    let loser = loaded.iter().find(|s| s.name == "main").expect("still loaded");
    assert_eq!(loser.role, "", "the loser's card no longer claims a job it does not hold");
}

/// …and the same hole was open on `critic`, whose loser is `state.critic`.
#[test]
fn a_second_critic_is_reported_too() {
    let file = |dir: &str| {
        (
            dir.to_string(),
            format!("---\nname: {dir}\ndescription: d\nrole: critic\n---\nYou judge."),
        )
    };
    let (loaded, problems) = load_agents(vec![file("critic"), file("auditor")]);
    assert_eq!(problems.len(), 1, "reported: {problems:?}");
    assert!(problems[0].contains("critic"), "{problems:?}");
    assert_eq!(loaded.iter().filter(|s| s.role == agent::ROLE_CRITIC).count(), 1, "one holder");
}
