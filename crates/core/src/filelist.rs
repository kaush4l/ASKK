//! The files pane's PROJECTION: a folder listing and one file, folded out of
//! the `ToolInvoked` facts (I8). Split from `files.rs`, which owns the module
//! and its two routes, so both hold the 200-line rule (I12).

use kernel::EventKind;
use module::view::FragmentBuilder;

use crate::dispatch::Ctx;

/// Which path a `list_files` or `read_file` call was about.
fn path_of(args_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| Some(v.get("path")?.as_str()?.to_string()))
        .unwrap_or_else(|| ".".into())
}

/// One call this pane projects: which path, whether it worked, and what came
/// back either way.
struct Seen {
    path: String,
    ok: bool,
    output: String,
}

/// The newest listing and the newest file read, whoever caused them — the
/// agent's own calls count, which is the point: this pane is where you watch
/// an agent build something.
///
/// FAILURES are kept. A refused or failed call used to be skipped here, which
/// meant a listing that could not run left the pane saying "nothing listed
/// yet" forever — the pane's own silent failure, and the exact shape of bug
/// this codebase refuses everywhere else. What the workspace said is what the
/// pane shows.
fn newest(ctx: &Ctx, at: Option<&str>) -> (Option<Seen>, Option<Seen>) {
    let (mut listed, mut read) = (None, None);
    for kind in &ctx.recent {
        if let EventKind::ToolInvoked { tool, args, ok, output } = kind {
            let path = path_of(args);
            let seen = || {
                Some(Seen {
                    path: path.clone(),
                    ok: *ok,
                    output: output.clone(),
                })
            };
            match tool.0.as_str() {
                // Scoped, when the pane asked for one folder: two panes over
                // the same workspace watch two different folders, and "the
                // newest listing there was" would have them overwrite each
                // other every time either one refreshed.
                "list_files" if at.is_none_or(|want| want == path) => listed = seen(),
                // Scoped the same way, by PREFIX: the artifacts shelf must
                // not render a file the Files pane opened somewhere else, and
                // both are reading the same fact stream.
                "read_file" if at.is_none_or(|want| path.starts_with(want)) => read = seen(),
                _ => {}
            }
        }
    }
    (listed, read)
}

/// One row, as `<name>\t<path>`: what to show, and what opening it means.
/// `ls -1Ap` marks a folder with a trailing slash, and that is the whole type
/// system this pane needs.
fn row(at: &str, line: &str) -> String {
    let base = at.trim_end_matches('/');
    // Some `ls` builds answer a directory OPERAND with lines already carrying
    // that directory — measured in this CheerpX Alpine, where `ls -1Ap -- notes`
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

/// The listing as ROWS for the pane to make buttons out of, newline-separated
/// (these headers never touch a wire — the seam is an in-process call).
///
/// The entries used to be `<button type="submit" name="path">` inside a form,
/// which is the correct HTML and does not work here: Dioxus reports a form's
/// INPUTS and not which submitter submitted it, so every click arrived with an
/// empty value and the pane did nothing at all. The core still decides what
/// the entries ARE; the UI owns the control, which is the same split every
/// other pane has.
pub(crate) fn rows(ctx: &Ctx, at: Option<&str>) -> String {
    let (listed, _) = newest(ctx, at);
    let Some(Seen { path: at, ok: true, output }) = listed else {
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

/// The pane: where you are, what is in it, and what the last file said.
pub(crate) fn panel(ctx: &Ctx, at: Option<&str>) -> String {
    let (listed, read) = newest(ctx, at);
    let mut list = FragmentBuilder::new("div").id("files").class("file-list");
    match &listed {
        None => {
            list = list.child(
                FragmentBuilder::new("p")
                    .class("pending")
                    .text(match ctx.space.is_some() {
                        true => "Nothing listed yet. Open the workspace folder to see what is \
                                 in it — the agent's own listings appear here too.",
                        false => "This agent works alone, so there is no workspace folder to \
                                  browse.",
                    })
                    .build(),
            );
        }
        Some(Seen { path: at, ok: false, output }) => {
            list = list
                .attr("data-path", at)
                .attr("data-failed", "1")
                .child(
                    FragmentBuilder::new("p")
                        .class("error")
                        .text(&format!("Could not list {at}: {output}"))
                        .build(),
                );
        }
        Some(Seen { path: at, output, .. }) => {
            list = list.attr("data-path", at);
            let names: Vec<&str> = output
                .lines()
                .map(str::trim)
                // `said` reports an empty stdout in words, and those words are
                // not a file called "(no output)".
                .filter(|l| !l.is_empty() && *l != "(no output)")
                .collect();
            list = list.attr("data-entries", &names.len().to_string());
            if names.is_empty() {
                list = list.child(FragmentBuilder::new("p").class("pending").text("Empty.").build());
            }
        }
    }
    let mut out = list.build().into_html();
    if let Some(Seen { path, ok, output }) = read {
        out.push_str(
            &FragmentBuilder::new("pre")
                .class(if ok { "file-view" } else { "file-view failed" })
                .attr("data-path", &path)
                .text(&output)
                .build()
                .into_html(),
        );
    }
    out
}

/// The open file as `path\n<contents>`, for a pane that wants the BYTES rather
/// than the rendering — the artifact shelf, which decides between an iframe and
/// a `<pre>` from the extension. Empty when nothing is open.
///
/// It rides a header for the same reason the entries do: the alternative was
/// scraping the core's own escaped `<pre>` back out of the fragment, which is a
/// second parser for a string this side already has.
pub(crate) fn opened(ctx: &Ctx, at: Option<&str>) -> String {
    match newest(ctx, at) {
        (_, Some(Seen { path, ok: true, output })) => format!("{path}\n{output}"),
        _ => String::new(),
    }
}

/// The folder one level up, in the pane's own relative vocabulary.
fn parent(path: &str) -> &str {
    match path.trim_end_matches('/').rsplit_once('/') {
        Some((up, _)) => up,
        None => ".",
    }
}
