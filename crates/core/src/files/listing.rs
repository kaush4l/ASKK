//! The files pane's PROJECTION: a folder listing and one file, folded out of
//! the `ToolInvoked` facts (I8). `pane.rs` owns the module and its two routes;
//! this file is what those routes project.

use kernel::EventKind;

use crate::dispatch::Ctx;

/// Which path a `list_files` or `read_file` call was about. `pub(crate)` for
/// the trace, which answers "who asked for this listing" the same way it
/// answers it for a command (R4-1).
pub(crate) fn path_of(args_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| Some(v.get("path")?.as_str()?.to_string()))
        .unwrap_or_else(|| ".".into())
}

/// One call this pane projects: which path, whether it worked, and what came
/// back either way.
pub(crate) struct Seen {
    pub(crate) path: String,
    pub(crate) ok: bool,
    pub(crate) output: String,
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
    for (i, kind) in ctx.recent.iter().enumerate() {
        // AN ANSWER FROM A LINUX THAT NO LONGER EXISTS IS NOT AN ANSWER
        // (R12-3): this pane said *"census.md was written here, and nothing is
        // left of it"* four lines above census.md's bytes captioned "Saved —
        // this is what is on disk", with a button offering to save them back.
        // Same test `files/empty_states` and `terminal/row_selection` already apply to the same log.
        if !ctx.durable && i < ctx.booted {
            continue;
        }
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
                // Scoped by the FOLDER the file is in, so `x-at` means one
                // thing in both places (R4-2): a prefix match let the Files
                // pane's own scope leak — and, worse, let another pane's
                // folder replace this one's whole listing.
                "read_file" if at.is_none_or(|want| parent(&path) == want) => read = seen(),
                _ => {}
            }
        }
    }
    (listed, read)
}

/// Whether THIS OUTPUT is the shell saying a path is not there. The phrase
/// alone, with no idea which call produced it — only for a caller that already
/// knows the call was a listing, which is the whole of what `newest` collects.
pub(crate) fn says_missing(output: &str) -> bool {
    output.contains("No such file or directory")
}

/// Whether a failed call failed only because the folder is not there.
///
/// THE TOOL IS HALF THE PREDICATE (R14-P0-3). Without it, this was a substring
/// test over any tool's output, and one shell line was enough to hand an
/// `exec` a file-listing outcome: `pwd; ls -la; wc -l primes.txt; …` exited 1
/// with `wc: primes.txt: No such file or directory` in it, and the trace called
/// that entry `— not there yet` over the invented sentence *"There is no .
/// folder yet"* — `.` from `path_of`, which defaults to the workspace root for
/// arguments that name no path at all. The Commands pane, reading the same
/// fact, said `failed` with the true stdout.
///
/// The boundary is the one `newest` above already applies: only `list_files`
/// and `read_file` are ABOUT a path, so only they can be "not there yet". A
/// command is about whatever it does, and its own exit status says how it went.
///
/// `pub(crate)` for the tool trace and for `failed`, which must call the same
/// condition by the same name: this pane said "There is no artifacts folder
/// yet" while the trace beside it painted the identical fact red and called it
/// a failure (R5-11).
pub(crate) fn missing(tool: &str, output: &str) -> bool {
    matches!(tool, "list_files" | "read_file") && says_missing(output)
}

/// HOW MANY FACTS COULD HAVE CHANGED THIS WORKSPACE (R14-P1-3).
///
/// The Files pane re-asks for a listing when the AGENT's status stamp moves,
/// which is every fact except the one a person makes: `echo hello-persist >
/// probe.txt` typed into the Commands box ran, printed `ok`, and showed up in
/// that pane's own `ls -la` — while the Files pane 400px below went on showing
/// the listing from before it, and said the folder was empty.
///
/// So the panes gate on the same log the Commands pane reads instead. `exec`
/// and `write_file` are the calls that can change what an `ls` would print;
/// `list_files` and `read_file` are excluded BECAUSE they are what the pane
/// itself does — counting those would make every refresh ask for another one.
pub(crate) fn changes(ctx: &Ctx) -> usize {
    ctx.recent
        .iter()
        .filter(|kind| {
            matches!(kind, EventKind::ToolInvoked { tool, .. } if matches!(tool.0.as_str(), "exec" | "write_file"))
        })
        .count()
}

/// The newest SUCCESSFUL listing in this scope: which folder, and what `ls`
/// printed. `files/rows` turns it into the entries header; keeping the fold in
/// one place is what stops the two from disagreeing about which folder is on
/// screen.
pub(crate) fn newest_listing(ctx: &Ctx, at: Option<&str>) -> Option<(String, String)> {
    match newest(ctx, at).0 {
        Some(Seen { path, ok: true, output }) => Some((path, output)),
        _ => None,
    }
}

/// The pane: where you are and what is in it.
///
/// IT NO LONGER RENDERS THE OPEN FILE (R5-9). This used to append a
/// `<pre class="file-view">` holding the bytes of the newest `read_file` — and
/// the Files pane draws a `<textarea>` under it holding the same bytes, so the
/// open file was on screen twice, neither copy labelled, and the editable one
/// was the second. The bytes still leave here: `opened()` below puts them on
/// the `x-file` header, which is where the pane has always taken them from.
/// The artifact shelf renders its own `.file-view` from that header.
pub(crate) fn panel(ctx: &Ctx, at: Option<&str>) -> String {
    crate::files::empty_states::folder(ctx, &newest(ctx, at).0).build().into_html()
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

/// The folder one level up, in the pane's own relative vocabulary. `pub(crate)`
/// because `x-at` is a FOLDER: `files/pane.rs` scopes a file's request to the folder
/// that holds it, which is the same scope the pane showing it is on (R4-2).
pub(crate) fn parent(path: &str) -> &str {
    match path.trim_end_matches('/').rsplit_once('/') {
        Some((up, _)) => up,
        None => ".",
    }
}
