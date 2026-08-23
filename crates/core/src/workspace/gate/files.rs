//! THE FOUR ONE-SHOT TOOLS, and the words that refuse a call that cannot be
//! run. `gate.rs` owns the capability check and the in-flight record; this is
//! the dispatch it ends in, split out because a refusal written for a model is
//! prose and prose takes room.
//!
//! EVERY ARGUMENT IS CHECKED HERE, and that is the whole point of the file.
//! Both reads used to end in `.unwrap_or_default()`:
//!
//! - `contents` defaulted to `""`, so `write_file({"path": "notes.md"})` — a
//!   call the model had not finished writing — REPLACED the file with nothing
//!   and reported `wrote notes.md`, ok. It was the only executor call site in
//!   the tree that discarded an `ArgError` on a content field.
//! - `path` defaulted to `""`, which `agent::relative_path` reads as `"."`, so
//!   a call that named no path succeeded against the workspace ROOT. A call
//!   that named nothing succeeded against something else.
//!
//! THE RULING ON AN EXPLICIT EMPTY STRING, because it is the one case worth
//! arguing about: `{"contents": ""}` is ALLOWED and truncates the file.
//! Emptying a file on purpose is an ordinary thing to do, and `Args::text` is
//! verbatim — an empty string is a value the model wrote, not a value nobody
//! wrote. The defect was never an empty write; it was an empty write NOBODY
//! ASKED FOR, and `ArgError` is exactly the difference between the two.

use context::{ArgError, Args};
use kernel::{Execution, WorkspacePort};

/// Run one of the four, or refuse it in words. `list_files` is the `_` arm for
/// the reason it always was: `agent::is_workspace_tool` has already decided
/// this name is one of ours, and the three above are the ones with a different
/// shape.
pub(super) async fn run(
    port: &dyn WorkspacePort,
    root: &str,
    tool: &str,
    args: &Args,
) -> Result<Execution, String> {
    // `path` is a NAME: an identifier for a place, where surrounding space is a
    // typo — and `agent::relative_path` already trims it
    // (`crates/agent/src/workspace.rs:153`), so the reader agrees with the
    // validator instead of disagreeing with it silently.
    let path = || match args.name("path") {
        Ok(said) => agent::relative_path(said),
        Err(why) => Err(no_path(tool, &why)),
    };
    let ran = match tool {
        // `command` is a NAME: blank must be refused, which is the check that
        // was here by hand, and a shell does not care about the space around it.
        "exec" => match args.name("command") {
            Err(_) => {
                return Err("no command given. Call it as exec({\"command\": \"ls -l\"})".into())
            }
            Ok(command) => port.exec(root, command).await,
        },
        "read_file" => match window(args) {
            (0, 0) => port.read(root, &path()?).await,
            (offset, limit) => port.read_range(root, &path()?, offset, limit).await,
        },
        "edit_file" => return super::edit::run(port, root, &path()?, args).await,
        // `contents` is TEXT, and this is the line the split exists for. A
        // reader that trimmed here would strip the trailing newline off every
        // file an agent ever wrote, silently, with the gate green
        // (`crates/core/tests/roundtrip.rs`).
        "write_file" => {
            let (path, contents) = (path()?, args.text("contents").map_err(no_contents)?);
            port.write(root, &path, contents).await
        }
        _ => port.list(root, &path()?).await,
    };
    ran.map_err(super::unavailable)
}

/// THE WINDOW THE MODEL ASKED FOR, in bytes.
///
/// A WINDOW IS A REQUEST, NOT A SECOND READER. Absent, unreadable or negative
/// is `(0, 0)`, and the caller above then asks for `read` rather than for a
/// zero-width `read_range` — not a tidiness point, but the one that keeps an
/// ADAPTER'S OWN `read` in play. `WorkspacePort::read`'s default already
/// delegates here, and an adapter with a cheaper path overrides `read`; routing
/// every call through `read_range` walked straight past those overrides and the
/// files pane started reading a command instead of a file. A window is the
/// model reaching for LESS, and a number it did not manage to write is not a
/// smaller ask. Read
/// through `Args::whole`, which is the ONE reader for a number the model wrote
/// — a hand-rolled `serde_json::from_str::<Value>` here would be the shape
/// `crates/core/tests/onereader.rs` keeps at one site, and that test caught
/// this function written the wrong way round.
fn window(args: &Args) -> (usize, usize) {
    (args.whole("offset").unwrap_or(0), args.whole("limit").unwrap_or(0))
}

/// The call shape this tool wants, in the tool's own vocabulary. A refusal a
/// model cannot act on is a dropped call wearing words, so every refusal below
/// ends in the line the model should have written.
fn shape(tool: &str) -> &'static str {
    match tool {
        "read_file" => r#"read_file({"path": "notes/today.md"})"#,
        "edit_file" => r#"edit_file({"path": "notes/today.md", "find": "…", "replace": "…"})"#,
        "write_file" => r#"write_file({"path": "notes/today.md", "contents": "…"})"#,
        _ => r#"list_files({"path": "."})"#,
    }
}

/// No usable `path`. `Missing` and `NotText` are DIFFERENT MISTAKES and get
/// different words: one key was never written, the other was written as
/// something that is not text, and a model told "you said nothing" about a
/// `path` it wrote as a number will write it as a number again.
fn no_path(tool: &str, why: &ArgError) -> String {
    match why {
        ArgError::NotText { found, .. } => format!(
            "the path was written as a {found} and a path is text: {} — nothing ran.",
            shape(tool)
        ),
        _ => format!(
            "no path given, and this tool will not guess one: {} — nothing ran. Paths are \
             relative to the workspace folder, and \".\" is that folder itself.",
            shape(tool)
        ),
    }
}

/// No usable `contents`. It says the file is UNTOUCHED, because the thing this
/// refusal replaced was a silent overwrite with nothing — and it names the way
/// to empty a file deliberately, so the refusal does not read as a ban on it.
fn no_contents(why: ArgError) -> String {
    let untouched = "nothing was written and the file that is there is unchanged";
    match why {
        ArgError::NotText { found, .. } => format!(
            "'contents' was written as a {found}, and a file's contents are text: {untouched}. \
             Send the file's text as a JSON string: {}",
            shape("write_file")
        ),
        _ => format!(
            "no 'contents' given: {untouched}. Call it as {} — and to empty a file on purpose, \
             ask for it in so many words: \"contents\": \"\".",
            shape("write_file")
        ),
    }
}
