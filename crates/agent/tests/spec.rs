//! `agent.md` parsing and loading (increment 03). Host-only, pure crates,
//! no browser and no network (I3) — the files arrive as bytes either way.

use agent::{load_agents, parse_agent_file};

/// The real shipped file, with every frontmatter key the Python loader
/// knows: name, description, model, temperature, engine, tools, space.
const REAL: &str = include_str!("../../../public/agents/main/agent.md");
const SUMMARIZER: &str = include_str!("../../../public/agents/summarizer/agent.md");

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
    assert!(spec.tools.is_empty(), "tools: [] is an empty toolkit");
    // The body after the frontmatter IS the system prompt — no fence, no
    // frontmatter, and not truncated.
    assert!(spec.prompt.starts_with("You are a helpful assistant."));
    assert!(spec.prompt.contains("## The shared space"));
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
fn name_defaults_to_the_folder_and_engine_to_base() {
    let spec = parse_agent_file("scout", "---\ndescription: x\n---\nbody").expect("parses");
    assert_eq!(spec.name, "scout");
    assert_eq!(spec.engine, "base");
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
    agent::adopt_spec(&mut state, &spec);
    let after = format!("{:?}", state.paper);
    assert!(!after.contains("You are HARNESS"), "hardcoded prompt is gone");
    assert!(after.contains("You are a helpful assistant."));
    assert!(after.contains("Name: main."));
}
