//! The space's rules, on the host with no browser and no store (I3): what a
//! name may be, what replaces what, what the board keeps, and what an agent is
//! told back. Every one of these is a rule `core/space.py` guarantees.

use agent::{parse_agent_file, toolbox_for, AgentSpec, Space, NOTE_LIMIT};

fn spec(space: &str, tools: &str) -> AgentSpec {
    let text =
        format!("---\nname: one\ndescription: an agent\nspace: {space}\ntools: {tools}\n---\nbody");
    parse_agent_file("one", &text).expect("the file parses")
}

/// A space name becomes a directory name, so it may only be a name. Each of
/// these would write somewhere the space is not (Python `NAME_PATTERN`).
#[test]
fn a_name_that_could_escape_the_spaces_directory_is_refused() {
    for bad in ["../etc", "a/b", "", "   ", ".", "res earch", "a\\b"] {
        assert!(Space::named(bad).is_none(), "{bad:?} should be refused");
    }
    assert_eq!(Space::named("research").map(|s| s.name), Some("research".into()));
    assert_eq!(Space::named("re-search_2").map(|s| s.name), Some("re-search_2".into()));
}

/// One space per NAME: a stray space around it must not split the group in two
/// (Python `get_space` strips before it looks the space up).
#[test]
fn whitespace_around_the_name_does_not_split_the_group() {
    let padded = Space::named(" research ").expect("a usable name");
    let plain = Space::named("research").expect("a usable name");
    assert_eq!(padded.name, plain.name);
    assert_eq!(padded.path(), plain.path());
}

/// Writing the same key twice REPLACES it. The Python test asserts the prompt
/// holds the key exactly once after an overwrite, and so does this one — a
/// stale value that lingered beside the new one would let the model pick.
#[test]
fn a_fact_written_twice_replaces_it_and_the_prompt_holds_it_once() {
    let mut space = Space::named("research").expect("a usable name");
    space.remember("port", "8000");
    let (said, _) = space.remember("port", "8873");
    assert_eq!(said, "Recorded in the research space: port = 8873");
    let context = space.context();
    assert_eq!(context.matches("port:").count(), 1, "{context}");
    assert!(context.contains("port: 8873"), "{context}");
    assert!(!context.contains("8000"), "{context}");
    assert_eq!(space.facts.len(), 1);
}

/// A fact needs a key, and an empty note is not posted — both are said plainly
/// rather than swallowed.
#[test]
fn an_empty_key_or_note_is_refused_in_words() {
    let mut space = Space::named("research").expect("a usable name");
    let (said, change) = space.remember("  ", "8873");
    assert_eq!(said, "Nothing recorded: a fact needs a key.");
    assert!(change.is_none());
    let (said, change) = space.post("main", "   ");
    assert_eq!(said, "Nothing posted: the note was empty.");
    assert!(change.is_none());
    assert!(space.context().contains("space: research"));
    assert!(!space.context().contains("shared facts"));
}

/// `forget` removes a fact, and reports PLAINLY when there was nothing to
/// remove — a silent success would leave the agent believing it had corrected
/// something (Python `Space.forget`).
#[test]
fn forget_removes_a_fact_and_says_so_when_there_was_none() {
    let mut space = Space::named("research").expect("a usable name");
    space.remember("port", "8873");
    space.remember("host", "localhost");
    let (said, _) = space.forget("port");
    assert_eq!(said, "Removed 'port' from the research space.");
    assert!(!space.context().contains("port"), "{}", space.context());

    let (said, change) = space.forget("port");
    assert_eq!(said, "No fact called 'port'. The space holds: host");
    assert!(change.is_none(), "nothing was removed, so nothing is written");

    space.forget("host");
    let (said, _) = space.forget("anything");
    assert_eq!(said, "No fact called 'anything'. The space holds: nothing");
}

/// Notes are ATTRIBUTED — the author is bound where the tool runs, never
/// written by the model — and the board keeps the newest twenty.
#[test]
fn notes_are_attributed_and_the_board_keeps_the_newest_twenty() {
    let mut space = Space::named("research").expect("a usable name");
    for i in 0..25 {
        let author = match i % 2 {
            0 => "main",
            _ => "researcher",
        };
        let (said, change) = space.post(author, &format!("note {i}"));
        assert_eq!(
            said,
            "Posted to the research space. Everyone working here will see it."
        );
        assert!(change.is_some());
    }
    assert_eq!(space.notes.len(), NOTE_LIMIT);
    assert_eq!(space.notes.first().unwrap(), "[researcher] note 5"); // 0..4 fell off
    assert_eq!(space.notes.last().unwrap(), "[main] note 24");
    let context = space.context();
    assert!(context.contains("recent notes:"), "{context}");
    assert!(!context.contains("note 4"), "the oldest fell off: {context}");
}

/// A note is ONE line: the board is read inside a prompt, and a note with
/// newlines in it would look like several context keys.
#[test]
fn a_note_is_folded_onto_one_line() {
    let mut space = Space::named("research").expect("a usable name");
    space.post("main", "found it\n\n  on page   two");
    assert_eq!(space.notes[0], "[main] found it on page two");
}

/// The same note twice is one note (09 walk, finding 4): identical lines
/// rendered as identical lines, and each one spends prompt budget saying what
/// the one above it already said. Refused in words, never silently.
#[test]
fn the_same_note_twice_is_one_note() {
    let mut space = Space::named("research").expect("a usable name");
    let (_, first) = space.post("main", "the port is 8873");
    let (said, again) = space.post("main", "the port is 8873");
    assert!(first.is_some(), "the first one landed");
    assert!(again.is_none(), "the second one did not");
    assert_eq!(space.notes.len(), 1);
    assert!(said.contains("already on the research board"), "{said}");
    // …but the same words from ANOTHER agent are another agent's note.
    let (_, theirs) = space.post("researcher", "the port is 8873");
    assert!(theirs.is_some());
    assert_eq!(space.notes.len(), 2);
}

/// Naming the space is what makes its tools available (Python `load_agent`) —
/// but an EMPTY `tools:` list is what takes all of them. Empty means
/// "everything this agent could have locally", and the space's folder is local
/// capability; `spec.rs` refuses a malformed `tools:` line rather than
/// emptying it, so an empty list is always something somebody wrote.
#[test]
fn an_empty_list_with_a_space_takes_every_builtin_and_the_whole_space_set() {
    let named = toolbox_for(&spec("research", "[]"), &[]);
    let names: Vec<&str> = named.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "now",
            "list_agents",
            "read_agent",
            "write_agent",
            // Increment 21: a built-in like any other, so an empty list takes
            // it — whether it can reach anything is the allowlist's business.
            "web_search",
            "remember",
            "forget",
            "post_note",
            "exec",
            "read_file",
            "write_file",
            "list_files",
            "start_process",
            "list_processes",
            "read_process",
            "stop_process",
            "observe",
            "find_files"
        ]
    );
}

/// THE CAPABILITY BOUNDARY (ALIGNMENT §5 item 1). A non-empty `tools:` list is
/// the WHOLE allowlist. The space makes its tools available to name; it does
/// not append them after the filter has run. Appended — which is what
/// `subagent.rs` did — a read-only agent that can still see the filesystem is
/// unrepresentable, because asking for `read_file` also hands over `exec`.
#[test]
fn a_non_empty_list_is_not_widened_by_the_space() {
    let read_only = toolbox_for(&spec("research", "[read_file, list_files]"), &[]);
    let names: Vec<&str> = read_only.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["read_file", "list_files"], "exactly what the file named");
    for mutating in ["exec", "write_file", "start_process", "stop_process", "write_agent"] {
        assert!(
            read_only.get(mutating).is_none(),
            "the space must not out-grant the allowlist: {mutating}"
        );
    }
    // The space's own three are named like anything else, and one named tool
    // does not drag the other two in with it.
    let one_space_tool = toolbox_for(&spec("research", "[post_note]"), &[]);
    assert_eq!(one_space_tool.tools.len(), 1);
    assert!(one_space_tool.get("post_note").is_some());
    assert!(one_space_tool.get("remember").is_none());
    // A named tool that the space did NOT bring is still not a tool.
    assert!(toolbox_for(&spec("research", "[now]"), &[]).get("exec").is_none());
}

/// No space, no workspace — default deny (ADR-006), whatever the list says.
#[test]
fn without_a_usable_space_no_list_can_reach_the_workspace() {
    for space in ["", "../etc"] {
        for tools in ["[]", "[now]", "[exec, write_file, remember]"] {
            let box_ = toolbox_for(&spec(space, tools), &[]);
            for granted in ["exec", "write_file", "start_process", "observe", "remember"] {
                assert!(
                    box_.get(granted).is_none(),
                    "space {space:?} tools {tools} must not grant {granted}"
                );
            }
        }
    }
}

/// An empty space renders its name and its workspace and nothing else — the
/// Python renders no `shared facts` key at all until there is one.
#[test]
fn an_empty_space_renders_no_empty_headings() {
    let space = Space::named("research").expect("a usable name");
    let context = space.context();
    assert!(
        context.starts_with("space: research\nworkspace: /root/spaces/research"),
        "{context}"
    );
    assert!(!context.contains("shared facts"), "{context}");
    assert!(!context.contains("recent notes"), "{context}");
}
