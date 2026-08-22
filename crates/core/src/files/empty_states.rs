//! WHAT THE FOLDER LOOKS LIKE — the four states it can be in, and what an empty
//! one says (R11-9). `files/listing.rs` owns the fold that finds the listing; this
//! owns what the pane says once it has one.
//!
//! Two findings, one file. The Files pane said *"There is nothing in `.` yet —
//! nothing has written to it"* two inches above the Processes pane's *"…and
//! nothing is left of them"*, on an engine that had just destroyed both. One
//! product does not hold two opinions about the same loss: the pane that HELD
//! `pulse.log` a minute ago says so, in the words `proc::rows::lost` already
//! uses. And `.` was the one piece of raw shell that reached user copy — the
//! pane knows the folder it is browsing, so it says its name.

use kernel::EventKind;
use module::view::FragmentBuilder;

use crate::dispatch::Ctx;
use crate::files::listing::{says_missing, Seen};

/// The folder, as a person reads it rather than as `ls` was called with it.
pub(crate) fn named(at: &str) -> String {
    match at.trim_end_matches('/') {
        "." | "" => "the folder".to_string(),
        path => path.to_string(),
    }
}

/// Every file written into `at` ON AN EARLIER PAGE LOAD, in order and without
/// repeats. `i < ctx.booted` is the same test `terminal/row_selection` uses for a command
/// whose answer describes a Linux that has since been rebuilt: it is the only
/// condition under which "the reload took it" is a claim this projection can
/// actually make. A file the agent wrote and deleted in THIS session is not one.
fn written_before(ctx: &Ctx, at: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for (i, kind) in ctx.recent.iter().enumerate() {
        if i >= ctx.booted {
            break;
        }
        let EventKind::ToolInvoked { tool, args, ok, .. } = kind else { continue };
        if tool.0 != "write_file" || !ok {
            continue;
        }
        let path = crate::files::listing::path_of(args);
        if crate::files::listing::parent(&path) != at.trim_end_matches('/') {
            continue;
        }
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// WHY THIS FOLDER LOOKED EMPTY: the listing found nothing in it, or the reload that rebuilt this
/// page's Linux took what had been written. `exists` is false for the folder `ls` could not find
/// at all, which on a forgetting engine is the same loss wearing a different shell message. The
/// mechanism is `files::permitted::IN_MEMORY`, said once; the NAMES are why this is not `kept`.
pub(crate) fn empty_said(ctx: &Ctx, at: &str, exists: bool) -> String {
    let gone = match ctx.durable {
        true => Vec::new(),
        false => written_before(ctx, at),
    };
    if !gone.is_empty() {
        let (was, them) = match gone.len() {
            1 => ("was", "it"),
            _ => ("were", "them"),
        };
        return format!(
            "{} {was} written here, and nothing is left of {them}. {}, so the reload that \
             rebuilt it took {them} with it.",
            crate::words::listed(&gone), crate::files::permitted::IN_MEMORY
        );
    }
    if exists {
        return format!("Nothing was in {} when this listing ran.", named(at));
    }
    not_there(at)
}

/// A LISTING REPORTS WHAT IT SAW (R14-P1-3). This pane said *"There is nothing
/// in the workspace folder yet — nothing has written to it"* 400px below a
/// Commands row holding `echo hello-persist > probe.txt — ok` and its `ls -la`.
/// A projection of past events (I8) knows what its last `ls` printed and no
/// more; it was asserting the present tense of a disk. House style is
/// `vouch`'s: say what was observed and stop, and `pub(crate)` so the trace's
/// row for the same listing says this, not a second wording of it (R8-8).
pub(crate) fn not_there(at: &str) -> String {
    match at.trim_end_matches('/') {
        "." | "" => "The folder was not there when this listing ran.".to_string(),
        path => format!("{path} was not there when this listing ran."),
    }
}

/// NOTHING LISTED YET, and why — this agent has no workspace at all, or the
/// listing is queued behind something, or it is simply on its way.
///
/// NAME THE CONTROL IN ITS OWN WORDS (R2-11, R3-19): the pane asks for this
/// listing itself now, so the sentence says what is happening rather than
/// handing the reader a chore. …AND WHAT IT IS WAITING BEHIND, when that is the
/// answer (R11-1a). "the workspace is being asked for this folder" describes a
/// request in flight; with one command wedged there was no request and could
/// not be one, and this sentence held for seven minutes as a description of a
/// fetch that was never going to land.
fn nothing_yet(ctx: &Ctx) -> String {
    match (ctx.space.is_some(), crate::trace::inflight::waiting_on(ctx)) {
        (false, _) => "This agent works alone, so there is no folder to browse.".to_string(),
        (true, Some(waiting)) => waiting,
        (true, None) => "Nothing listed yet — this page is still asking for this folder. The \
                         agent's own listings appear here too."
            .to_string(),
    }
}

/// A LISTING THAT RAN: its entries, or the sentence an empty one gets.
///
/// A SENTENCE WITH A REASON, like every other nothing in this product (R10-12).
/// This was the single word `Empty.` beside "Nothing has been recorded here
/// yet" and "Nothing has been made yet" — one panel written by somebody else.
fn entries(ctx: &Ctx, list: FragmentBuilder, at: &str, output: &str) -> FragmentBuilder {
    let names: Vec<&str> = output
        .lines()
        .map(str::trim)
        // `said` reports an empty stdout in words, and those words are not a
        // file called "(no output)".
        .filter(|l| !l.is_empty() && *l != "(no output)")
        .collect();
    let list = list.attr("data-path", at).attr("data-entries", &names.len().to_string());
    match names.is_empty() {
        true => list.child(
            FragmentBuilder::new("p").class("pending").text(&empty_said(ctx, at, true)).build(),
        ),
        false => list,
    }
}

/// THE FOLDER, in the four states it can be in.
pub(crate) fn folder(ctx: &Ctx, listed: &Option<Seen>) -> FragmentBuilder {
    let list = FragmentBuilder::new("div").id("files").class("file-list");
    match listed {
        None => list.child(
            FragmentBuilder::new("p").class("pending").text(&nothing_yet(ctx)).build(),
        ),
        // A FOLDER THAT IS NOT THERE IS NOT A FAILURE (R4-2). `artifacts/`
        // does not exist until an agent writes into it, and `ls` reports that
        // the only way it can: exit 1 and a message. Rendering that as an
        // error put a raw shell string with an exit code on screen for the
        // most ordinary condition this pane has — an empty workspace.
        // `says_missing`, not `missing`: a `Seen` is only ever a `list_files`
        // or a `read_file`, so the tool half is true by construction here.
        Some(Seen { path: at, ok: false, output }) if says_missing(output) => list
            .attr("data-path", at)
            .attr("data-entries", "0")
            .child(
                FragmentBuilder::new("p")
                    .class("pending")
                    .text(&empty_said(ctx, at, false))
                    .build(),
            ),
        Some(Seen { path: at, ok: false, output }) => list
            .attr("data-path", at)
            .attr("data-failed", "1")
            .child(FragmentBuilder::new("p").class("error").text(&refused(at, output)).build()),
        Some(Seen { path: at, output, .. }) => entries(ctx, list, at, output),
    }
}

/// WHY A LISTING THAT FAILED MAY HAVE NO FOLDER TO NAME. `list_files` refuses a
/// missing `path` rather than guessing the workspace root
/// (`workspace/gate/files.rs`, `no_path`), and the projection stopped guessing
/// with it — so `at` is empty on exactly that refusal. "Could not list : …"
/// puts a colon where the folder should be, and reads as a rendering fault
/// rather than as the refusal it is. The `output` beside it already says what
/// was wrong; the headline only has to stop claiming a folder was involved.
fn refused(at: &str, output: &str) -> String {
    if at.is_empty() {
        format!("Could not list a folder: {output}")
    } else {
        format!("Could not list {at}: {output}")
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_folder_has_a_name_a_person_can_read() {
        assert_eq!(super::named("."), "the folder");
        assert_eq!(super::named("./"), "the folder");
        assert_eq!(super::named("artifacts"), "artifacts");
    }
}
