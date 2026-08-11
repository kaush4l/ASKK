//! Export is the same format as `public/agents/` — the increment 11 promise
//! that an agent written in the browser can be dropped into the repo and an
//! agent from the repo edited in the browser. Pure, host-only (I3).

use agent::{new_spec, parse_agent_file, render_agent_file, usable_agent_name, AgentSpec};

/// Every agent this build ships, read from the real files.
fn shipped() -> Vec<(&'static str, &'static str)> {
    vec![
        ("main", include_str!("../../../public/agents/main/agent.md")),
        (
            "researcher",
            include_str!("../../../public/agents/researcher/agent.md"),
        ),
        (
            "summarizer",
            include_str!("../../../public/agents/summarizer/agent.md"),
        ),
        (
            "author",
            include_str!("../../../public/agents/author/agent.md"),
        ),
    ]
}

/// The round trip that makes the two directions one format: a SHIPPED file
/// parsed, rendered back out and parsed again is the same agent — so exporting
/// an agent and committing the export changes nothing about it.
#[test]
fn a_shipped_agent_file_survives_the_round_trip_through_export() {
    for (dir, text) in shipped() {
        let original: AgentSpec = parse_agent_file(dir, text).expect("the shipped file parses");
        let exported = render_agent_file(&original);
        assert!(
            exported.starts_with("---\n") && exported.contains("\n---\n"),
            "an export is frontmatter + body, like every agent.md: {exported}"
        );
        let reread = parse_agent_file(dir, &exported).expect("the export parses");
        assert_eq!(reread, original, "{dir} changed on the way out and back");
        // …and it is stable: exporting the re-read agent gives the same bytes,
        // so a file that has been through the browser once does not keep
        // drifting each time it goes through again.
        assert_eq!(render_agent_file(&reread), exported, "{dir} is not stable");
    }
}

/// A spec written from the five things an author chooses is a normal agent
/// file — the model's `write_agent` and a person's textarea converge on one
/// format, with the compaction defaults the parser would have supplied.
#[test]
fn an_authored_spec_renders_a_file_the_loader_reads_back() {
    let spec = new_spec(
        "note-taker",
        "Keeps notes for the group.",
        "You keep notes.\n\nBe brief.",
        &["now".into(), "".into(), " post_note ".into()],
        "research",
    );
    let text = render_agent_file(&spec);
    let back = parse_agent_file("ignored-because-the-file-names-itself", &text).unwrap();
    assert_eq!(back.name, "note-taker");
    assert_eq!(back.space, "research");
    assert_eq!(back.tools, vec!["now", "post_note"], "blanks are not tools");
    assert_eq!(back.prompt, "You keep notes.\n\nBe brief.");
    assert_eq!(back, spec, "the renderer and the parser are inverses");
}

/// A description or a name with a newline in it would close the frontmatter
/// early and produce a file that will not load. Folded to one line rather than
/// silently truncated, because a truncated description is a wrong one.
#[test]
fn a_multi_line_frontmatter_value_cannot_break_the_export() {
    let spec = new_spec("x", "line one\nline two", "prompt", &[], "");
    let text = render_agent_file(&spec);
    let back = parse_agent_file("x", &text).expect("still a readable file");
    assert_eq!(back.description, "line one line two");
}

/// An agent name becomes a folder name on export, so it is checked like a
/// space name and for the same reason.
#[test]
fn an_agent_name_must_be_able_to_be_a_folder() {
    for good in ["main", "note-taker", "a_1"] {
        assert!(usable_agent_name(good), "{good}");
    }
    for bad in ["", "  ", "../etc", "a/b", "a.b", "a b"] {
        assert!(!usable_agent_name(bad), "{bad}");
    }
}

/// A provider may answer in its own `tool_calls` shape even though this build
/// asks for calls as text — omlx does, for a prompt whose affordances mention
/// tools. Reading that as "no reply" discarded a call the model really made
/// and stalled the turn on "unrecognizable completion body" (increment 11).
#[test]
fn a_native_tool_call_reply_is_read_as_the_call_it_is() {
    let body = r#"{"choices":[{"message":{"role":"assistant","tool_calls":[
        {"type":"function","function":{"name":"tools:list_agents","arguments":"{}"}},
        {"type":"function","function":{"name":"write_agent","arguments":"{\"name\": \"x\"}"}}
    ]},"finish_reason":"tool_calls"}]}"#;
    let text = context::openai_reply_text(body).expect("a reply, not nothing");
    // The ONE call syntax the parser reads, one per line — which is also the
    // layout rule's "run these in order".
    assert_eq!(text, "list_agents({})\nwrite_agent({\"name\": \"x\"})");
    let batches = agent::parse_batches(&text);
    assert_eq!(batches.len(), 2, "{batches:?}");
    assert_eq!(batches[0][0].tool, "list_agents");
    assert_eq!(batches[1][0].tool, "write_agent");

    // Ordinary content still wins, and an empty content with no calls is still
    // an unrecognizable body rather than an invented empty answer.
    let plain = r#"{"choices":[{"message":{"content":"hello"}}]}"#;
    assert_eq!(context::openai_reply_text(plain).unwrap(), "hello");
    assert!(context::openai_reply_text(r#"{"choices":[{"message":{}}]}"#).is_none());
}
