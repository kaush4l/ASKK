//! The files pane's ENTRIES: one line per thing in the folder, as
//! `<name>\t<path>`. Split from `filelist.rs`, which owns the fold and the
//! rendered pane, so both hold the 200-line rule (I12).
//!
//! These rows never touch a wire — the seam is an in-process call — so a
//! tab-separated header is the whole format.

use crate::dispatch::Ctx;
use crate::filelist::{listed, parent};

/// One row: what to show, and what opening it means. `ls -1Ap` marks a folder
/// with a trailing slash, and that is the whole type system this pane needs.
fn row(at: &str, line: &str) -> String {
    let base = at.trim_end_matches('/');
    // Some `ls` builds answer a directory OPERAND with lines already carrying
    // that directory — measured in this Alpine, where `ls -1Ap -- notes`
    // prints `notes/today.md`. Joining blind gives `notes/notes/today.md`, so
    // the prefix comes off first and the row is built from what is left.
    let name = match base {
        "" | "." => line,
        base => line.strip_prefix(&format!("{base}/")).unwrap_or(line),
    };
    let bare = name.trim_end_matches('/');
    let path = match base {
        "" | "." => bare.to_string(),
        base => format!("{base}/{bare}"),
    };
    format!("{name}\t{path}")
}

/// The listing as rows for the pane to make buttons out of.
///
/// The entries used to be `<button type="submit" name="path">` inside a form,
/// which is the correct HTML and does not work here: Dioxus reports a form's
/// INPUTS and not which submitter submitted it, so every click arrived with an
/// empty value and the pane did nothing at all. The core still decides what
/// the entries ARE; the UI owns the control, which is the same split every
/// other pane has.
pub(crate) fn rows(ctx: &Ctx, at: Option<&str>) -> String {
    let Some((at, output)) = listed(ctx, at) else {
        return String::new();
    };
    let mut rows = Vec::new();
    if at != "." && !at.is_empty() {
        rows.push(row(parent(&at), ".."));
    }
    for name in output.lines().map(str::trim).filter(|l| !l.is_empty() && *l != "(no output)") {
        rows.push(row(&at, name));
    }
    rows.join("\n")
}

/// THE FILES A SENTENCE MAY POINT AT (R9-4). The same rows, as paths, with the
/// folders and `..` dropped: the conversation turns a name the agent SAID into
/// a control, and only a name the workspace actually holds may become one.
///
/// SCOPED TO THE ROOT, and it has to be: unscoped, the newest `list_files` in
/// the log is usually the artifact shelf's `ls artifacts` on a workspace that
/// has no such folder, which fails, and `listed` correctly answers "no listing"
/// — so every name in every sentence stayed inert.
// ponytail: root only. A file the agent wrote into a subfolder is still a
// `<code>`; widen it when an agent's answers start naming those.
pub(crate) fn names(ctx: &Ctx) -> Vec<String> {
    rows(ctx, Some("."))
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .filter(|(name, _)| *name != ".." && !name.ends_with('/'))
        .map(|(_, path)| path.to_string())
        .collect()
}
