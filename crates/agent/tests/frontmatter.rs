//! A KEY NOTHING READS IS A SETTING THAT LOOKS APPLIED.
//!
//! `spec::yaml` refuses every VALUE it cannot honour — `engine: reakt`,
//! `compact_at: lots`, a `tools:` line that is not a list — and until this
//! increment it silently dropped every KEY it did not know. That is the same
//! bug one level up: `temprature: 0.7` parses clean, changes nothing, and stays
//! in the file being believed. A frontmatter key is a small closed vocabulary,
//! so an unknown one is a mistake and never an extension.
//!
//! The shipped files are read here too, because a refusal this strict is only
//! safe if what the app actually deploys goes through it.

use agent::{parse_agent_file, AgentError};

const MAIN: &str = include_str!("../../../public/agents/main/agent.md");

fn refusal(file: &str) -> String {
    match parse_agent_file("fixture", file) {
        Err(AgentError::MalformedAgentFile { message, .. }) => message,
        Err(other) => panic!("an agent file refuses as its own typed error: {other:?}"),
        Ok(_) => panic!("that file should not have parsed"),
    }
}

/// The key is named, and so are the keys that exist — a refusal a person can
/// act on without opening the source.
#[test]
fn an_unknown_frontmatter_key_is_refused_and_says_what_the_keys_are() {
    let message = refusal("---\nname: helper\ntemprature: 0.7\n---\n\nBody.\n");
    assert!(message.contains("temprature"), "{message}");
    assert!(message.contains("temperature"), "the real key is offered: {message}");
    // A near-miss on a LIST key is the dangerous one: `stage:` would have left
    // the loop empty and the agent silently stage-less.
    let message = refusal("---\nname: helper\nstage: [plan]\n---\n\nBody.\n");
    assert!(message.contains("stage"), "{message}");
}

/// …and the two things that are NOT keys still are not. A YAML comment and a
/// blank line are skipped before any of this, which is what lets the shipped
/// `main` explain itself in its own frontmatter.
#[test]
fn comments_and_blank_lines_are_not_keys() {
    let file = "---\nname: helper\n\n# stages: [plan] — why this file does not\n---\n\nBody.\n";
    let spec = parse_agent_file("fixture", file).expect("a comment is not a setting");
    assert_eq!(spec.name, "helper");
    assert!(spec.stages.is_empty(), "a commented-out key is not applied");
}

/// THE SHIPPED FILE GOES THROUGH IT. A parser this strict is only trustworthy
/// if the app's own agents pass — a refusal nobody runs against the real files
/// is a deploy that comes up with no agents at all.
#[test]
fn the_shipped_agent_file_carries_only_keys_that_are_read() {
    parse_agent_file("main", MAIN).expect("the shipped main agent parses");
}

/// TWO LISTS OF THE SAME VOCABULARY, HELD IN AGREEMENT BY A TEST.
///
/// `yaml::KEYS` is what the refusal above prints; the `match` in
/// `yaml::set_field` is what actually accepts a key. Nothing in the compiler
/// keeps them the same, and `agent::faculty` documents what this codebase paid
/// for the last time a `match` and a separate `const` drifted: a new entry got
/// ZERO structural coverage while every gate stayed green. So every name the
/// refusal offers is walked through the reader here, and a name outside both is
/// refused — a key added to one and not the other fails HERE rather than
/// shipping as a setting that looks applied.
///
/// The values are the least each key will accept: this asserts the KEY is
/// known, and the value rules have their own tests.
#[test]
fn every_key_the_refusal_offers_is_a_key_the_reader_accepts() {
    let offered = refusal("---\nname: helper\nnosuchkey: x\n---\nBody.\n");
    let names: Vec<String> = offered
        .split("the keys are: ")
        .nth(1)
        .expect("the refusal prints the vocabulary")
        .split(", ")
        .map(|k| k.trim().to_string())
        .collect();
    assert!(names.len() >= 17, "every key is offered, goal.* included: {names:?}");
    for key in &names {
        let value = match key.as_str() {
            "stages" => "[work]",
            "tools" | "faculties" => "[]",
            "compact_at" | "keep_recent" | "max_rounds" | "passes" => "1",
            "temperature" => "0.1",
            "engine" => "react",
            "role" => "entry",
            // A goal needs its other halves to survive `refuse_contradictions`;
            // this test is about the READER knowing the key, so the shape it
            // is given is a whole legal goal.
            k if k.starts_with("goal.") => "x",
            _ => "x",
        };
        let goal = match key.starts_with("goal.") {
            true => "space: research\nstages: [work]\ngoal.outcome: o\ngoal.check: c\n",
            false => "",
        };
        let file = format!("---\nname: helper\n{goal}{key}: {value}\n---\nBody.\n");
        parse_agent_file("fixture", &file)
            .unwrap_or_else(|e| panic!("'{key}' is offered by the refusal but not read: {e:?}"));
    }
    // …and a name in neither place is still refused.
    assert!(parse_agent_file("fixture", "---\nname: h\ngoal.chck: x\n---\nB.\n").is_err());
}

/// THE GLOSS IS PART OF THE PARSER'S VOCABULARY, AND NOW SOMETHING SAYS SO.
///
/// `ui/authoring/key_help.rs` claims in its own doc comment that "a key that
/// exists in the parser and not here is a visible gap rather than a silent
/// one". That was true only of a reader who happened to compare the two lists:
/// nothing enforced it, and five keys — `faculties`, `passes` and the three
/// dotted `goal.*` — had already gone missing, while `role` was still glossed
/// with `summarizer`, a job deleted from `spec::ROLES`. The panel whose whole
/// subject is what an agent file may say was the thing saying it wrongly (I16).
///
/// The source is read as TEXT because the gloss lives in the UI crate, which
/// this pure one cannot depend on (I3). The refusal is the same machine-read
/// vocabulary `every_key_the_refusal_offers_is_a_key_the_reader_accepts` uses,
/// so neither side of this comparison is typed out here.
const KEY_HELP: &str = include_str!("../../ui/src/authoring/key_help.rs");

fn glossed() -> Vec<(String, String)> {
    let block = KEY_HELP
        .split("const KEYS: &[(&str, &str)] = &[")
        .nth(1)
        .expect("the gloss list is where this test says it is")
        .split("\n];")
        .next()
        .expect("…and it ends");
    block
        .lines()
        .filter_map(|l| l.trim().strip_prefix("(\""))
        .filter_map(|l| l.split_once("\", \""))
        .map(|(key, said)| (key.to_string(), said.trim_end_matches("\"),").to_string()))
        .collect()
}

#[test]
fn every_key_the_parser_reads_is_glossed_for_the_person_writing_the_file() {
    let offered = refusal("---\nname: helper\nnosuchkey: x\n---\nBody.\n");
    let mut parser: Vec<String> = offered
        .split("the keys are: ")
        .nth(1)
        .expect("the refusal prints the vocabulary")
        .split(", ")
        .map(|k| k.trim().to_string())
        .collect();
    let mut shown: Vec<String> = glossed().into_iter().map(|(k, _)| k).collect();
    assert!(!shown.is_empty(), "the gloss list was found and parsed");
    parser.sort();
    shown.sort();
    assert_eq!(shown, parser, "the Agents panel glosses exactly the keys the parser reads");
}

/// …and the gloss of `role` names the jobs that EXIST. It named `summarizer`
/// for three increments after the role was deleted, which is worse than a
/// missing key: a person following it writes a line the parser now refuses.
#[test]
fn the_role_gloss_names_every_role_and_no_deleted_one() {
    let (_, said) = glossed()
        .into_iter()
        .find(|(k, _)| k == "role")
        .expect("`role` is glossed");
    for role in agent::ROLES {
        assert!(said.contains(role), "the gloss of `role` names `{role}`: {said}");
    }
    assert!(
        !KEY_HELP.contains("summarizer"),
        "`summarizer` is not a role any more; the panel must not offer it"
    );
}
