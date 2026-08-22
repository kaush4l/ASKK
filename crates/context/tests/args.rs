//! THE ONE READER FOR TOOL ARGUMENTS, and mostly the boundary between its two
//! halves. `name` is for identifiers and trims; `text` is for content and does
//! not. Getting that backwards at a call site is silent data corruption, so the
//! first two tests here are the corruption guards themselves: the trailing
//! newline of a file an agent writes, and a value that is nothing but spaces.
//!
//! The rest pin the four answers the reader has to have — a missing key, a
//! null, a value that is not a string, and a string that is blank — because
//! sixteen hand-rolled copies had four different answers between them and no
//! test named any of them.
//!
//! POSITIVE CONTROLS, BOTH RUN (I17). One per half of the split.
//! `Args::text` was made `Ok(said.trim())` — the single-trimming-reader design
//! this file exists to forbid — and the three `text_…` tests went red
//! (`left: Ok("a")` against `right: Ok("a\n")`), `cargo test -p context --test
//! args` exiting 101. Then `Args::name` was made to skip its `.trim()` and
//! `name_trims_an_identifier` and `name_refuses_a_blank_identifier_and_names_the_key`
//! went red, 13 passed / 2 failed, exit 101. Both were restored and both halves
//! pass. A test that cannot go red for its own reason is not a control.

use context::{ArgError, Args};

/// THE BUG THIS INCREMENT EXISTS TO PREVENT. `workspace/gate.rs` writes files
/// with this argument; a reader that trimmed would strip the trailing newline
/// off every file an agent ever wrote, and nothing would have said so.
#[test]
fn text_keeps_a_trailing_newline_byte_for_byte() {
    let args = Args::parse(r#"{"contents":"a\n"}"#);
    assert_eq!(args.text("contents"), Ok("a\n"));
}

/// The same guard from the other side: whitespace is content when it is the
/// whole of the content. Two spaces are two spaces, not an empty string and
/// not an error.
#[test]
fn text_returns_a_blank_string_verbatim() {
    let args = Args::parse(r#"{"contents":"  "}"#);
    assert_eq!(args.text("contents"), Ok("  "));
}

#[test]
fn text_keeps_leading_and_interior_whitespace() {
    let args = Args::parse("{\"contents\":\"  indented\\n\\nbody\\n\"}");
    assert_eq!(args.text("contents"), Ok("  indented\n\nbody\n"));
}

#[test]
fn name_trims_an_identifier() {
    let args = Args::parse(r#"{"path":"  notes/today.md  "}"#);
    assert_eq!(args.name("path"), Ok("notes/today.md"));
}

/// The refusal `name` exists for: a call that names no path cannot be run, and
/// the error carries the key so the site can say which one.
#[test]
fn name_refuses_a_blank_identifier_and_names_the_key() {
    let args = Args::parse(r#"{"path":"   "}"#);
    assert_eq!(
        args.name("path"),
        Err(ArgError::Empty { key: "path".into() })
    );
}

#[test]
fn name_refuses_an_empty_string_too() {
    let args = Args::parse(r#"{"name":""}"#);
    assert_eq!(
        args.name("name"),
        Err(ArgError::Empty { key: "name".into() })
    );
}

#[test]
fn a_key_that_was_never_written_is_missing_for_both_halves() {
    let args = Args::parse(r#"{"other":"x"}"#);
    assert_eq!(
        args.text("path"),
        Err(ArgError::Missing { key: "path".into() })
    );
    assert_eq!(
        args.name("path"),
        Err(ArgError::Missing { key: "path".into() })
    );
}

/// A key the model WROTE is a key it meant, so `null` reports its type rather
/// than claiming the model said nothing. The distinction is what lets a refusal
/// tell a model it wrote the wrong kind of value.
#[test]
fn a_null_is_reported_as_a_null_and_not_as_missing() {
    let args = Args::parse(r#"{"path":null}"#);
    assert_eq!(
        args.text("path"),
        Err(ArgError::NotText {
            key: "path".into(),
            found: "null"
        })
    );
}

#[test]
fn a_number_a_boolean_an_array_and_an_object_each_name_their_type() {
    let args = Args::parse(r#"{"n":1,"b":true,"a":[],"o":{}}"#);
    let found = |k: &str| match args.text(k) {
        Err(ArgError::NotText { found, .. }) => found,
        other => panic!("expected NotText for {k}: {other:?}"),
    };
    assert_eq!((found("n"), found("b"), found("a"), found("o")), ("number", "boolean", "array", "object"));
}

/// Unreadable JSON is not an error here. The tool's own refusal — written for
/// the model, in the tool's vocabulary — is what the model gets, and it is
/// reached by the same "the model did not say" path a missing key takes.
#[test]
fn a_body_that_is_not_json_reads_as_a_call_with_no_arguments() {
    let args = Args::parse("not json at all");
    assert_eq!(
        args.text("path"),
        Err(ArgError::Missing { key: "path".into() })
    );
    assert_eq!(args.first_name(), None);
}

#[test]
fn json_that_is_not_an_object_reads_as_a_call_with_no_arguments() {
    for body in ["[1,2]", "\"a string\"", "7", "null"] {
        let args = Args::parse(body);
        assert_eq!(
            args.name("query"),
            Err(ArgError::Missing { key: "query".into() }),
            "for {body}"
        );
    }
}

/// The record of the call is the bytes the model sent, not a re-serialisation:
/// the `ToolInvoked` fact and any host that echoes its arguments must agree
/// with what the transcript shows.
#[test]
fn raw_is_the_string_as_written() {
    let body = r#"{  "contents" : "a\n" }"#;
    assert_eq!(Args::parse(body).raw(), body);
}

/// A sub-agent tool carries exactly one argument. A model that writes `task`
/// where the tool documents `query` meant the same thing, and starting the
/// sub-agent on nothing is the failure that path exists to prevent.
#[test]
fn first_name_finds_the_single_goal_under_whatever_key_was_used() {
    let args = Args::parse(r#"{"task":"  find the bug  "}"#);
    assert_eq!(args.first_name(), Some("find the bug"));
}

#[test]
fn first_name_skips_blanks_and_non_strings() {
    let args = Args::parse(r#"{"a":"   ","b":7,"c":"the goal"}"#);
    assert_eq!(args.first_name(), Some("the goal"));
}

#[test]
fn first_name_is_none_when_nothing_usable_was_written() {
    assert_eq!(Args::parse(r#"{"a":"","b":null}"#).first_name(), None);
    assert_eq!(Args::parse("{}").first_name(), None);
}
