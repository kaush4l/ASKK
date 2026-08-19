//! WHAT THE FOLDER LOOKS LIKE — the four states it can be in, and what an empty
//! one says (R11-9). Split from `filelist.rs`, which owns the fold, so both
//! hold the 200-line rule (I12).
//!
//! Two findings, one file. The Files pane said *"There is nothing in `.` yet —
//! nothing has written to it"* two inches above the Processes pane's *"…and
//! nothing is left of them"*, on an engine that had just destroyed both. One
//! product does not hold two opinions about the same loss: the pane that HELD
//! `pulse.log` a minute ago says so, in the words `procpanel::lost` already
//! uses. And `.` was the one piece of raw shell that reached user copy — the
//! pane knows the folder it is browsing, so it says its name.

use kernel::EventKind;
use module::view::FragmentBuilder;

use crate::dispatch::Ctx;
use crate::filelist::{says_missing, Seen};

/// The folder, as a person reads it rather than as `ls` was called with it.
pub(crate) fn named(at: &str) -> String {
    match at.trim_end_matches('/') {
        "." | "" => "the folder".to_string(),
        path => path.to_string(),
    }
}

/// Every file written into `at` ON AN EARLIER PAGE LOAD, in order and without
/// repeats. `i < ctx.booted` is the same test `scrollrows` uses for a command
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
        let path = crate::filelist::path_of(args);
        if crate::filelist::parent(&path) != at.trim_end_matches('/') {
            continue;
        }
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// A list a person reads: `a`, `a and b`, `a, b and c`. The same shape
/// `procpanel::listed` builds, because the two panes say the same kind of
/// sentence about the same reload.
fn listed(names: &[String]) -> String {
    match names.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// WHY THIS FOLDER LOOKED EMPTY: the listing found nothing in it, or the reload that rebuilt this
/// page's Linux took what had been written. `exists` is false for the folder `ls` could not find
/// at all, which on a forgetting engine is the same loss wearing a different shell message. The
/// mechanism is `browsable::IN_MEMORY`, said once; the NAMES are why this is not `kept`.
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
            listed(&gone), crate::browsable::IN_MEMORY
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

/// THE FOLDER, in the four states it can be in. Its own fn so `panel` holds
/// the 40-line rule (I12).
pub(crate) fn folder(ctx: &Ctx, listed: &Option<Seen>) -> FragmentBuilder {
    let list = FragmentBuilder::new("div").id("files").class("file-list");
    match listed {
        // NAME THE CONTROL IN ITS OWN WORDS (R2-11, R3-19): the pane asks for
        // this listing itself now, so the sentence says what is happening
        // rather than handing the reader a chore.
        // …AND WHAT IT IS WAITING BEHIND, when that is the answer (R11-1a).
        // "the workspace is being asked for this folder" describes a request in
        // flight; with one command wedged there was no request and could not be
        // one, and this sentence held for seven minutes as a description of a
        // fetch that was never going to land.
        None => list.child(
            FragmentBuilder::new("p")
                .class("pending")
                .text(&match (ctx.space.is_some(), crate::inflight::waiting_on(ctx)) {
                    (false, _) => {
                        "This agent works alone, so there is no folder to browse."
                            .to_string()
                    }
                    (true, Some(waiting)) => waiting,
                    (true, None) => "Nothing listed yet — this page is still asking for this \
                                     folder. The agent's own listings appear here too."
                        .to_string(),
                })
                .build(),
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
            .child(
                FragmentBuilder::new("p")
                    .class("error")
                    .text(&format!("Could not list {at}: {output}"))
                    .build(),
            ),
        Some(Seen { path: at, output, .. }) => {
            let names: Vec<&str> = output
                .lines()
                .map(str::trim)
                // `said` reports an empty stdout in words, and those words are
                // not a file called "(no output)".
                .filter(|l| !l.is_empty() && *l != "(no output)")
                .collect();
            let list = list.attr("data-path", at).attr("data-entries", &names.len().to_string());
            match names.is_empty() {
                // A SENTENCE WITH A REASON, like every other nothing in this
                // product (R10-12). This was the single word `Empty.` beside
                // "Nothing has been recorded here yet" and "Nothing has been
                // made yet" — one panel written by somebody else.
                true => list.child(
                    FragmentBuilder::new("p")
                        .class("pending")
                        .text(&empty_said(ctx, at, true))
                        .build(),
                ),
                false => list,
            }
        }
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

    #[test]
    fn a_list_reads_as_a_sentence() {
        let of = |v: &[&str]| super::listed(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(of(&["a"]), "a");
        assert_eq!(of(&["a", "b"]), "a and b");
        assert_eq!(of(&["a", "b", "c"]), "a, b and c");
    }
}
