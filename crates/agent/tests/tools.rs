//! The `core/tools.py` guarantees, pinned on the host (I3): no browser, no
//! network. These are the Python project's behaviours, not this build's —
//! each was found there by test rather than by reading, which is exactly why
//! each gets its own test here.

use agent::{builtin_tools, has_calls, parse_batches, step, AgentState, Effect, Tool, Toolbox};
use kernel::{Event, EventId, EventKind, Timestamp, ToolId};

fn names(batches: &[Vec<agent::Call>]) -> Vec<Vec<&str>> {
    batches
        .iter()
        .map(|b| b.iter().map(|c| c.tool.as_str()).collect())
        .collect()
}

/// Layout carries the schedule: one line is one batch (independent, run
/// together); a newline means "after everything above".
#[test]
fn calls_on_one_line_are_one_batch_and_a_new_line_starts_another() {
    let batches = parse_batches(
        "navigate_page({\"url\": \"https://example.com\"})\ntake_snapshot(), list_pages()",
    );
    assert_eq!(
        names(&batches),
        vec![vec!["navigate_page"], vec!["take_snapshot", "list_pages"]],
        "one navigation, THEN a snapshot and a page list at the same time"
    );
    // A comma or a space keeps calls together; only a newline splits them.
    assert_eq!(names(&parse_batches("a(), b() c()")), vec![vec!["a", "b", "c"]]);
    assert_eq!(names(&parse_batches("a()\nb()\nc()")), vec![vec!["a"], vec!["b"], vec!["c"]]);
    // Prose around the calls does not change the schedule, and prose alone is
    // not a call at all — that is what makes "just answer" a legal reply.
    assert_eq!(names(&parse_batches("First I will a(), b().")), vec![vec!["a", "b"]]);
    assert!(parse_batches("I don't need a tool for that.").is_empty());
    assert!(!has_calls("Nothing to call here (honestly)."));
}

/// A JSON argument may span several lines without becoming two batches: the
/// split is on the GAPS between calls, never on lines.
#[test]
fn a_multi_line_argument_stays_one_call() {
    let batches = parse_batches("read_agent({\n  \"name\": \"main\"\n})");
    assert_eq!(names(&batches), vec![vec!["read_agent"]]);
    assert_eq!(batches[0][0].args_error, None, "valid JSON, whatever its layout");
    assert!(batches[0][0].args_json.contains("\"name\""));
}

/// The bug the Python found by test: an unreadable argument used to arrive as
/// `args={}` — a silent empty call, which a sub-agent answers regardless. It
/// must be REFUSED, with the text that lets the model rewrite it.
#[test]
fn unreadable_arguments_are_refused_with_a_repair_message() {
    let box_ = Toolbox::of(vec![Tool::new("search", "Search the web.", &["query"])]);
    // Unescaped quotes inside a string, the exact Python case.
    let batches = parse_batches("search({\"query\": \"say \"hi\" twice\"})");
    let call = &batches[0][0];
    assert!(call.args_error.is_some(), "the arguments did not parse");
    let refusal = box_.check(call).expect_err("a call with unreadable args must not run");
    assert!(!refusal.ok);
    assert_eq!(refusal.tool, "search");
    assert!(
        refusal.error.contains("Could not read the arguments"),
        "{}",
        refusal.error
    );
    assert!(
        refusal.error.contains("search({\"query\": \"<query>\"}): Search the web."),
        "the refusal quotes the tool's own usage line: {}",
        refusal.error
    );
    // A call that genuinely had no arguments is NOT this case.
    let empty = &parse_batches("search()")[0][0];
    assert_eq!(empty.args_error, None);
    assert!(box_.check(empty).is_ok(), "no arguments is not unreadable arguments");
    // A name the toolbox does not know is refused with what IS available.
    let unknown = &parse_batches("teleport({})")[0][0];
    let err = box_.check(unknown).expect_err("unknown tool");
    assert!(err.error.contains("Tool not found. Available: search"), "{}", err.error);
}

/// THE MODEL TEXT THAT WROTE FIFTY CORRUPT BYTES, and the finding that the
/// parser is not the one at fault (R13-2).
///
/// Measured in a browser against gemma-4-12B: the file `budget.csv` came out as
/// ONE line — a leading `"`, literal backslash-n where the newlines should be,
/// and the call's own `"})` on the end — so `wc -l` said 0 and the `awk` meant
/// to sum it printed nothing. The reply below is the only text that produces
/// those exact bytes, and every stage of this parser handles it CORRECTLY:
/// `scan_object` is string- and escape-aware and finds the right `}`, the slice
/// is strictly valid JSON, `serde_json` decodes it, `args_error` is rightly
/// `None`, and `path` comes out clean beside it. The model escaped one argument
/// one level too many and swallowed its own terminator into the value.
///
/// So there is no parser bug to fix here, and inventing one would be its own
/// fabrication. What is fixable is the UI: `swallowed_close` is the page
/// reading the bytes it is already displaying, so no row can print `"})` and
/// stamp `ok` beside it (`core::vouch`).
#[test]
fn a_model_that_escapes_its_own_terminator_parses_and_is_seen_for_what_it_is() {
    let reply = r#"write_file({"path": "budget.csv", "contents": "\"item,cost\\ncoffee,4.50\\nrent,1800\\ninternet,60\"})"})"#;
    let call = &parse_batches(reply)[0][0];
    assert_eq!(call.tool, "write_file");
    assert_eq!(call.args_error, None, "strictly valid JSON: the parser is right to take it");
    let args: serde_json::Value = serde_json::from_str(&call.args_json).expect("valid JSON");
    assert_eq!(args["path"], "budget.csv", "the other argument decodes cleanly");
    let contents = args["contents"].as_str().expect("a string");
    assert_eq!(
        contents,
        "\"item,cost\\ncoffee,4.50\\nrent,1800\\ninternet,60\"})",
        "the value the tool is handed"
    );
    assert_eq!(contents.len(), 50, "the fifty bytes `od -c` counted in the browser");
    assert_eq!(contents.lines().count(), 1, "one line: `wc -l` said 0, so `awk NR>1` never fired");

    // …and the page can see it, off the arguments alone.
    assert!(agent::swallowed_close(&call.args_json), "the call's own terminator is in the value");
    let honest = r#"{"path": "budget.csv", "contents": "item,cost\ncoffee,4.50\n"}"#;
    assert!(!agent::swallowed_close(honest), "a real CSV is not flagged");
    assert!(!agent::swallowed_close("not json at all"), "and neither is a non-object");
}

/// A usage line is GENERATED from name, description and argument names — so a
/// sub-agent, a script tool and a built-in are indistinguishable to the model
/// (I9). Nobody hand-writes one, which is what stops them drifting apart.
#[test]
fn a_usage_line_is_generated_not_hand_written() {
    let f = Tool::new("read_file", "Read one file.", &["path", "encoding"]);
    assert_eq!(
        f.usage(),
        "read_file({\"path\": \"<path>\", \"encoding\": \"<encoding>\"}): Read one file."
    );
    assert_eq!(Tool::new("ping", "Say hi.", &[]).usage(), "ping({}): Say hi.");
    // A sub-agent takes the whole task as one string, and reads identically.
    let sub = Tool::from_engine("researcher", "Digs up sources.");
    assert_eq!(
        sub.usage(),
        "researcher({\"query\": \"<your detailed task description>\"}): Digs up sources."
    );
    // The instructions are those same lines and the layout rule, nothing else.
    let text = Toolbox::of(vec![f, sub]).instructions();
    assert!(text.contains("read_file({\"path\": \"<path>\", \"encoding\": \"<encoding>\"})"));
    assert!(text.contains("researcher({\"query\""));
    assert!(text.contains("one line, separated by commas, and run at the same time"));
}

/// The phase's grant decides what the model is told it has (ADR-010). A phase
/// with `ToolScope::None` renders no tool at all — it cannot act even if the
/// model asks, because it was never shown anything to ask for.
#[test]
fn a_phase_that_grants_nothing_shows_nothing() {
    let all = builtin_tools();
    let none = all.scoped(&agent::ToolScope::None);
    assert!(none.is_empty());
    assert!(!none.instructions().contains("read_agent"));
    let one = all.scoped(&agent::ToolScope::Only(vec![ToolId("now".into())]));
    assert_eq!(one.tools.len(), 1);
    assert!(one.instructions().contains("now({})"));
    assert!(!one.instructions().contains("read_agent"));
}

/// The whole loop through the pure machine: a reply that calls tools becomes
/// InvokeTool effects in BATCH ORDER, the model is not asked again until the
/// last result lands, and a refusal is a recorded result rather than a call.
#[test]
fn a_tool_reply_becomes_effects_and_the_model_waits_for_every_result() {
    let ev = |kind| Event {
        id: EventId(0),
        seq: 0,
        at: Timestamp(1_753_800_000_000),
        kind,
    };
    // An agent's toolbox comes from its own file now (increment 06); an
    // empty `tools:` list means every built-in, exactly as the Python's
    // `declared or all locals` does.
    let mut fresh = AgentState::new();
    let spec = agent::parse_agent_file(
        "main",
        "---\nname: main\ndescription: d\ntools: []\n---\nbody",
    )
    .expect("spec parses");
    agent::adopt_spec(&mut fresh, &spec, &[]);
    let (state, _) = step(
        fresh,
        ev(EventKind::UserMessage {
            text: "what is loaded?".into(),
            agent: String::new(),
            from: String::new(),
        }),
    );
    let (state, effects) = step(
        state,
        ev(EventKind::ModelReplied {
            text: "now(), list_agents()\nnope({})".into(),
            agent: String::new(),
        }),
    );
    assert_eq!(effects.len(), 3, "two on the first line, one on the second");
    assert!(matches!(&effects[0], Effect::InvokeTool { tool, .. } if tool.0 == "now"));
    assert!(matches!(&effects[1], Effect::InvokeTool { tool, .. } if tool.0 == "list_agents"));
    match &effects[2] {
        Effect::Emit {
            kind: EventKind::ToolInvoked { tool, ok, output, .. },
        } => {
            assert_eq!((tool.0.as_str(), *ok), ("nope", false));
            assert!(output.contains("Tool not found"), "{output}");
        }
        other => panic!("an unknown tool is a refused RESULT, not a call: {other:?}"),
    }
    assert_eq!(state.pending_tools, 3);
    // Two results in: still waiting, so the model has seen nothing yet.
    let result = |tool: &str| {
        ev(EventKind::ToolInvoked {
            tool: ToolId(tool.into()),
            args: "{}".into(),
            ok: true,
            output: "…".into(),
        })
    };
    let (state, effects) = step(state, result("now"));
    assert!(effects.is_empty(), "the batch is not done");
    let (state, effects) = step(state, result("list_agents"));
    assert!(effects.is_empty(), "still not done");
    let (state, effects) = step(state, result("nope"));
    assert_eq!(state.pending_tools, 0);
    assert!(
        matches!(effects.as_slice(), [Effect::CallModel { .. }]),
        "the last result asks the model again, once: {effects:?}"
    );
}
