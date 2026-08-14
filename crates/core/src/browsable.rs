//! WHETHER THIS PANE MAY SHOW A FOLDER AT ALL, and what it says when it may
//! not. Split from `files.rs` — which owns the module and its two routes — so
//! both hold the 200-line rule (I12); the question is its own subject, and the
//! artifact shelf asks it too.

use kernel::Response;

use crate::dispatch::{html, Ctx};

/// Why there is nothing to browse, in the words that name the fix. ONE
/// VOCABULARY (R16-1): there is ONE noun. A WORKSPACE is the place an agent
/// works in — a folder in the Linux this page runs, plus the facts and notes
/// every agent named to the same one shares. "Shared space" was a second name
/// for the same directory, and nothing a reader could tell apart from it.
const NO_SPACE: &str = "This agent is in no space, so there is no folder to browse. ";

/// …AND THE FIX AS SOMETHING A READER CAN DO (R10-10). It used to end "Add
/// `space: <name>` to its `agent.md`" — a file name from a source tree, which
/// nothing on this page opens and no view shows. The Agents view opens the same
/// file in an editor, `space:` is a line in the form it puts on screen, and the
/// workspace card's own button ("Open its agent file") goes there. One fix,
/// named where the reader can reach it; `pub(crate)` because the workspace card says
/// it too and two wordings of one instruction is how they drift.
/// No backticks: two of the three panes that say it render plain text, and a
/// sentence printing its own backtick characters is R7-9's bug the other way up.
///
/// …AND IT NAMES THE PANEL BY WHAT IS PRINTED ON IT (R15-P0-2). "Open its agent
/// file on the Agents view" pointed at nothing a reader can see: the visible
/// cards on that view are read-only, and the editor is titled `Write an agent`
/// and sits 2168px down. It also asked for a YAML key by name — a line in a
/// file, in a sentence whose whole job is to be followable. The panel's own
/// title is what the reader will actually be looking for, and the editor loads
/// this agent's file when it opens (`ui::agentfile::open_selected`), so the
/// instruction is one scroll and one word.
pub(crate) const GIVE_IT_A_SPACE: &str =
    "The Agents view has a panel titled Write an agent; it opens with this agent's file already \
     in it, and naming a space in that file gives the agent one.";

/// WHOSE folder this is, and whether this pane may show one at all (R5-1).
/// `/files` was the last per-agent read taking no `x-agent`: with `author`
/// selected the panel listed another agent's files under an editor, beside a
/// terminal correctly saying author has none. `terminal::can_type`'s rule, for
/// its reason — a listing here is a call in THIS agent's workspace.
pub(crate) fn browsable(ctx: &Ctx, who: &str) -> Result<(), String> {
    // THE AGENT'S OWN FACT FIRST, in the terminal's own words: an agent that
    // has no folder anywhere is not an agent whose folder is somewhere else.
    if crate::scrollback::space_of(ctx, who).is_none() {
        return Err(format!("{}{GIVE_IT_A_SPACE}", NO_SPACE.replace("This agent", who)));
    }
    // …AND IT IS SAID ONCE, ABOUT THE AGENT WHOSE NAME IS ON THE HEADER
    // (R16-P1-3). This sentence opened "This panel browses main's workspace",
    // and three panes printed it verbatim under a rail headed `workspace files
    // · ask` — a heading naming one agent over a body describing another,
    // three times in a column. It ended "Select main to browse it", ordering
    // the reader to undo the selection they had just made. The rail prints this
    // once now (`ui::rail`), so it is about the agent it is standing under, and
    // it states the arrangement rather than issuing an instruction.
    if who != ctx.me {
        return Err(format!(
            "{who} runs on its own, and this page cannot read a folder from there. Every \
             listing here is read with {me}'s own tools, so {me} is the one agent whose \
             folder this page can show.",
            me = ctx.me
        ));
    }
    match ctx.space.is_some() {
        true => Ok(()),
        false => Err(format!("{NO_SPACE}{GIVE_IT_A_SPACE}")),
    }
}

/// The refusal as the PANE reads it: no `x-entries` and no `x-file`, so the
/// file list and the editor leave with the listing rather than sitting under a
/// sentence that denies them. `pending`, not `error`: working alone is an
/// ordinary condition here, not a fault.
///
/// THROUGH THE MARKDOWN RENDERER (R7-9). This sentence names a key and a file
/// — `space: <name>`, `agent.md` — and printed its own backticks as literal
/// characters, in a product whose Chat pane renders `disk.md` as a code chip
/// in the same session. One renderer, `markdown::said`, which is where the
/// escaping lives too (I5). A `div`, because that renderer emits paragraphs.
///
/// `data-why` names the CONDITION, so the shelf beside this pane can say
/// something else about it instead of repeating the sentence (R7-4).
pub(crate) fn nothing_to_browse(why: &str) -> Response {
    html(
        200,
        module::view::FragmentBuilder::new("div")
            .class("pending")
            .attr("data-why", match why.contains("is in no space") {
                true => NO_SPACE_WHY,
                false => "elsewhere",
            })
            .child(crate::markdown::said(why, &[]))
            .build()
            .into_html(),
    )
}

/// The one name for "this agent has no workspace at all" — read by the
/// finished-files panel beside it (R7-4).
pub(crate) const NO_SPACE_WHY: &str = "no-space";

