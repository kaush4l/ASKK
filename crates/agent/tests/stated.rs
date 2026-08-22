//! **PROSE, ASSERTED AGAINST THE MACHINE (I16).** The first test in this tree
//! that does it, and the reason five instances of one defect accumulated
//! without a red gate: every other test here asks whether a capability
//! RESOLVES. None asked whether the sentence describing it is TRUE.
//!
//! Two class rules, neither of them a list of today's cases:
//!
//! - **(b) No shipped prose names a binary the guest does not have.** Every
//!   command-looking token in every string this build shows a model or a
//!   person must be a binary `agent::environment` declares, a tool the agent
//!   can call, or a word of this product's own vocabulary. Unknown FAILS.
//! - **(d) Nothing claims the guest keeps anything.** `durable()` is false
//!   permanently (owner ruling, 2026-08-20), so a string saying otherwise is a
//!   defect by ruling rather than by judgement.
//!
//! **THE TOKEN RULE, AND WHY IT IS THIS ONE.** A claim is not any occurrence
//! of a word: "find the file" is English and `find -name` is an assertion that
//! the guest has `find`. So a token counts as a CLAIM in exactly three
//! positions, each of which is a writer saying "this is something to run":
//!
//! 1. the first word inside a backtick span — `ls -1Ap`;
//! 2. the first word after a shell prompt — `$ python3 x.py`;
//! 3. the first word of a JSON example for a `"command"` key — which is the
//!    shape T20's defect shipped in.
//!
//! It is conservative in the direction of CATCHING: anything that looks like a
//! command in one of those positions must be accounted for, and a name nobody
//! recognises fails rather than being waved through. It is deliberately silent
//! about shell SCRIPTS we write ourselves (`proc/convention.rs`'s liveness
//! function), which are not claims made to a reader. The rule is pinned by
//! cases in `the_token_rule_reads_a_claim_and_not_an_english_word`, so it can
//! be argued with rather than guessed at.

use std::fs;

use agent::{
    builtin_tools, guest_lines, is_workspace_tool, memory_tools, space_tools, workspace_tools,
    SharedSpace, Space, Toolbox, GUEST_ABSENT, GUEST_BINARIES,
};

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

/// Every tool this build can grant anybody, so "a granted tool name" is a set
/// and not a guess.
fn every_tool() -> Toolbox {
    Toolbox::of(
        [
            builtin_tools().tools,
            workspace_tools(),
            space_tools(),
            memory_tools(),
        ]
        .concat(),
    )
}

/// THE PROSE THIS BUILD SHIPS, gathered from where it actually lives.
///
/// Read from disk rather than `include_str!`ed one path at a time, so an agent
/// file or a stage brief ADDED to the repo is swept without anybody
/// remembering to add it here — which is the difference between a class test
/// and a regression test.
fn corpus() -> Vec<(String, String)> {
    let mut out = Vec::new();
    for dir in fs::read_dir(format!("{ROOT}/public/agents")).expect("public/agents") {
        let path = dir.expect("a roster entry").path().join("agent.md");
        if let Ok(text) = fs::read_to_string(&path) {
            out.push((path.display().to_string(), text));
        }
    }
    for file in fs::read_dir(format!("{ROOT}/public/stages")).expect("public/stages") {
        let path = file.expect("a stage brief").path();
        out.push((path.display().to_string(), fs::read_to_string(&path).expect("a brief")));
    }
    // What the model reads about its own tools, and the two blocks that
    // describe the folder — asked through the real API, so no copy of the
    // wording can drift from the shipped one.
    let tools = every_tool();
    out.push(("agent::Tool::usage".into(), tools.usages().join("\n")));
    out.push(("agent::guest_lines".into(), guest_lines(&tools)));
    out.push((
        "agent::SharedSpace".into(),
        SharedSpace {
            space: Some(Space::named("research").expect("a usable name")),
            tools: tools.clone(),
        }
        .text(),
    ));
    for file in PROSE_FILES {
        let path = format!("{ROOT}/{file}");
        let source = fs::read_to_string(&path).unwrap_or_else(|_| panic!("{path} is readable"));
        out.push((file.to_string(), literals(&source).join("\n")));
    }
    out
}

/// The core files whose STRING LITERALS are refusals and advice a model or a
/// person reads. Their doc comments are not swept: a comment addressed to the
/// next engineer may name `ps aux` as a thing we refuse to parse, and reading
/// that as a claim would be a test of the documentation.
const PROSE_FILES: [&str; 13] = [
    "crates/core/src/proc/convention.rs",
    "crates/core/src/workspace/gate.rs",
    "crates/core/src/failure/card.rs",
    "crates/core/src/failure/dedupe.rs",
    "crates/core/src/failure/ending.rs",
    "crates/core/src/failure/ending_kind.rs",
    "crates/core/src/failure/from_worker.rs",
    "crates/core/src/failure/local_network.rs",
    "crates/core/src/failure/loop_note.rs",
    "crates/core/src/failure/second_tab.rs",
    "crates/core/src/failure/stopped_notice.rs",
    "crates/core/src/failure/what_to_do.rs",
    "crates/core/src/failure/within_turn.rs",
];

/// Rust string literals, decoded. Line comments are skipped, which is the
/// whole of the "prose, not documentation" rule above.
fn literals(source: &str) -> Vec<String> {
    let chars: Vec<char> = source.chars().collect();
    let (mut i, mut out) = (0, Vec::new());
    while i < chars.len() {
        if chars[i] == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if chars[i] != '"' {
            i += 1;
            continue;
        }
        let mut text = String::new();
        i += 1;
        while i < chars.len() && chars[i] != '"' {
            if chars[i] != '\\' {
                text.push(chars[i]);
                i += 1;
                continue;
            }
            // A backslash-newline eats the newline and the indent after it —
            // which is how every long refusal in this codebase is written.
            match chars.get(i + 1) {
                Some('\n') => {
                    i += 2;
                    while matches!(chars.get(i), Some(' ') | Some('\t')) {
                        i += 1;
                    }
                }
                Some(c) => {
                    text.push(*c);
                    i += 2;
                }
                None => i += 1,
            }
        }
        out.push(text);
        i += 1;
    }
    out
}

/// Every CLAIM in one piece of text: the three positions, in order.
fn claims(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    // Over the WHOLE text and not line by line: `main`'s own prose wraps a
    // span across a line break (`recent\nnotes`), and a line-wise scanner
    // reads the two halves of that as three claims that are not there.
    let mut parts = text.split('`');
    parts.next();
    // Odd-numbered fragments are the ones between a pair of backticks.
    for span in parts.step_by(2) {
        found.extend(head(span));
    }
    for after in text.split("$ ").skip(1) {
        found.extend(head(after));
    }
    for after in text.split("\"command\"").skip(1) {
        let value = after.trim_start().trim_start_matches(':').trim_start();
        if let Some(rest) = value.strip_prefix('"') {
            found.extend(head(rest.split('"').next().unwrap_or_default()));
        }
    }
    found
}

/// The first word of a span, if it looks like something to run: lowercase
/// letters, digits, `-` and `_`, and nothing else. A path (`crates/x.rs`), a
/// key (`model:`), a type (`WorkspacePort`) and a placeholder (`{command}`)
/// are all excluded by that shape, which is what keeps the rule about
/// commands.
fn head(span: &str) -> Option<String> {
    let word = span.trim().split_whitespace().next()?;
    let shaped = word.starts_with(|c: char| c.is_ascii_lowercase())
        && word.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    shaped.then(|| word.to_string())
}

/// THE RULE ITSELF, PINNED. A rule nobody can argue with is a rule nobody
/// checked; these are the cases it was designed against, including the two
/// shapes the T20 defect actually shipped in.
#[test]
fn the_token_rule_reads_a_claim_and_not_an_english_word() {
    let claimed = |text: &str| claims(text);
    // A claim: something a reader is being told to run.
    assert_eq!(claimed("run `python3 -m http.server` there"), ["python3"]);
    assert_eq!(claimed("$ curl https://x"), ["curl"]);
    assert_eq!(claimed("exec({\"command\": \"ls -l\"})"), ["ls"]);
    assert_eq!(claimed("start_process({\"name\": \"web\", \"command\": \"make all\"})"), ["make"]);
    // Not a claim: English, a path, a key, a type, a template hole.
    assert!(claimed("find the file yourself, then make a note").is_empty());
    assert!(claimed("see `crates/agent/src/now.rs` and `WorkspacePort`").is_empty());
    assert!(claimed("its `model:` line, and `{command}`").is_empty());
    // …and a tool name in backticks IS read as a claim, deliberately: the rule
    // cannot tell a tool from a binary, so both are checked against what
    // exists, which is the point.
    assert_eq!(claimed("`web_search` is the way out"), ["web_search"]);
}

/// **(b) NO SHIPPED PROSE NAMES A BINARY THE GUEST DOES NOT HAVE.**
///
/// The failure this catches is not cosmetic. A model told to run `python3`
/// runs it, reads "not found", and spends the rest of the turn debugging a
/// computer that was never there — which is exactly what `proc/convention.rs`
/// shipped, in a refusal, where a model reads it at its least certain moment.
#[test]
fn no_shipped_prose_names_a_binary_this_guest_does_not_have() {
    let tools = every_tool();
    let roster: Vec<String> = fs::read_dir(format!("{ROOT}/public/agents"))
        .expect("public/agents")
        .map(|e| e.expect("an entry").file_name().to_string_lossy().to_string())
        .collect();
    for (where_, text) in corpus() {
        for word in claims(&text) {
            let known = GUEST_BINARIES.contains(&word.as_str())
                || tools.get(&word).is_some()
                || roster.contains(&word)
                || VOCABULARY.contains(&word.as_str());
            assert!(
                known,
                "{where_} tells a reader to run `{word}`, which is neither a binary \
                 `agent::environment::BINARIES` declares nor a tool anybody can call. \
                 Either the sentence is wrong, or the declaration is missing a name \
                 the image really has (I16, I15)."
            );
            assert!(
                !GUEST_ABSENT.contains(&word.as_str()),
                "{where_} names `{word}`, which `agent::environment::ABSENT` says the \
                 guest does not have."
            );
        }
    }
}

/// **(d) NOTHING CLAIMS THE GUEST KEEPS ANYTHING.** Every phrase below can
/// only mean "it is still there next time", so each is allowed only under a
/// negation — which is how the space block's own sentence passes.
#[test]
fn no_shipped_string_says_the_guest_keeps_what_is_written_there() {
    // A durability claim: any of these, in a sentence that is ABOUT the guest.
    const KEEPING: [&str; 5] =
        ["survives", "survive a reload", "stays there", "still there", "saved to disk"];
    // …and about the guest is decided by the sentence naming it. `keep`'s own
    // description says memory "survives this page being reloaded", which is
    // TRUE — memory is browser storage, not the guest — and a rule that could
    // not tell those apart would have to be switched off.
    const GUEST: [&str; 8] = [
        "linux",
        "workspace",
        "shell",
        "filesystem",
        "container",
        "write there",
        "written there",
        "writes there",
    ];
    const DENIED: [&str; 6] = ["nothing", "no ", "not ", "never", "gone", "lost"];
    for (where_, text) in corpus() {
        for sentence in text.to_lowercase().split(['\n', '.']) {
            if !GUEST.iter().any(|g| sentence.contains(g)) {
                continue;
            }
            for phrase in KEEPING {
                assert!(
                    !sentence.contains(phrase) || DENIED.iter().any(|no| sentence.contains(no)),
                    "{where_} says {phrase:?} of the guest, which keeps nothing: \
                     `WorkspacePort::durable()` is false permanently and by ruling. \
                     The sentence:{sentence}"
                );
            }
        }
    }
}

/// …and the declaration agrees with the port about it, so the sentence above
/// and the machine cannot drift apart in silence. The port's own answer is
/// asserted on the host in `crates/core/tests/guest_truth.rs`, which is the
/// crate that can hold a real one.
#[test]
fn the_declaration_says_the_guest_keeps_nothing() {
    assert!(!agent::GUEST_DURABLE);
    // THE SENTENCE LIVES IN `## space`, NOT IN THE GUEST BLOCK, and a test chose
    // that: `guest_lines` is a function of the TOOLBOX and says nothing at all
    // for an agent that has a folder and no workspace tools — the shipped
    // `critic` — which would have described its folder without this property.
    // Asserted where the truth actually is, so this cannot pass by pointing at
    // a block that happens to be empty.
    let space = SharedSpace {
        space: Some(Space::named("research").expect("a usable name")),
        tools: every_tool(),
    }
    .text();
    assert!(
        space.contains("nothing written there survives a reload"),
        "and the model is told so in the words the panes use: {space}"
    );
}

/// The declaration and the shipped tool set agree about what a workspace IS:
/// every tool the workspace faculty brings is one `is_workspace_tool` claims,
/// which is the predicate `environment::facts` gates the whole block on. If
/// those two ever disagree, an agent holding a real shell is told nothing
/// about it — the omission half of I16, one layer down.
#[test]
fn every_workspace_tool_is_one_the_declaration_gates_on() {
    for tool in workspace_tools() {
        assert!(is_workspace_tool(&tool.name), "{} is granted by the space", tool.name);
    }
    let bare = Toolbox::of(builtin_tools().tools);
    assert!(
        guest_lines(&bare).is_empty(),
        "an agent with no workspace tool is told nothing about a shell it cannot reach"
    );
    assert!(guest_lines(&Toolbox::default()).is_empty());
}

/// THIS PRODUCT'S OWN NOUNS. Every one is a word that appears in backticks in
/// shipped prose and is not a thing to run: a block name, a stage, an engine,
/// a role, a frontmatter key, a shared-fact key, an ending. Adding to this
/// list is a deliberate act — the test's whole value is that an unrecognised
/// word fails rather than passing.
const VOCABULARY: [&str; 28] = [
    // Blocks the prompt is made of.
    "affordances", "soul", "identity", "space", "environment", "history", "task",
    "observations", "directive", "memory", "workspace", "document",
    // Stages, routes, engines, roles, endings.
    "strategy", "plan", "work", "verify", "critique", "answer", "react", "project",
    "base", "critic-faulted",
    // Keys a person writes in a file or an agent writes to the space, and the
    // one function name a shipped agent file cites in its own frontmatter
    // comment (`faculty/mod.rs`, `declared`) — a citation, not an instruction.
    "outcome", "done_when", "declared",
    // Keys inside a block, quoted in the prose that teaches it: the space
    // block renders `shared facts` and `recent notes`, and an agent file's
    // frontmatter has a `tools` list.
    "shared", "recent", "tools",
];
