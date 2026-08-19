//! THE NOTE UNDER THE SCROLLBACK: whose folder these commands run in, and how
//! far the tools reaching it go. Split from `scrollback.rs`, which owns the
//! rows, so both hold the 200-line rule (I12) — a row and a footnote about the
//! machine the rows ran on are two different things to write.

use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;
use crate::scrollback::space_of;

/// WHAT THE SELECTED AGENT'S WORKSPACE IS, and how far the tools reaching it
/// go. Six lines of it stood in front of two lines of shell output (12b walk,
/// D2), so it is a disclosure: the summary is the path, the explanation behind
/// it — and NOTHING AT ALL WHEN THERE IS NO FOLDER TO NAME (R10-11): this carried a
/// `{who} has no workspace folder` summary four lines under the pane's own
/// `{who} has no workspace folder, so it runs no commands.` A disclosure whose
/// subject does not exist has nothing to disclose.
pub(crate) fn note(ctx: &Ctx, who: &str) -> Option<Fragment> {
    let theirs = space_of(ctx, who)?;
    let (summary, text) = workspace_said(&theirs, who, &ctx.me, ctx.durable);
    let mut lines = FragmentBuilder::new("details")
        .class("panel-note")
        // NO `space-path` CLASS (R6-14). That class is `--mono`, which is right
        // for a path VALUE and wrong for a disclosure's label: this was the one
        // monospace `<summary>` among thirteen, so the control that opens the
        // workspace note read as a different kind of thing from every other
        // fold in the product. The path is inside the sentence; the sentence is
        // Inter, like the other twelve.
        .child(FragmentBuilder::new("summary").text(&summary).build())
        .child(FragmentBuilder::new("p").class("note").text(&text).build());
    // WHERE THESE ROWS CAME FROM. With somebody else selected the pane shows
    // what that agent's own Worker reported — the same records its tool trace
    // shows (R4-1) — and the box below is still this page's shell.
    if who != ctx.me {
        lines = lines.child(
            FragmentBuilder::new("p")
                .class("note")
                .text(&format!(
                    "These commands are the ones {who} reported running; {me}'s own are under \
                     {me}. The command box below is {me}'s shell: it takes a command only with \
                     {me} selected.",
                    me = ctx.me
                ))
                .build(),
        );
    }
    Some(lines.build())
}

/// The scanned line and the paragraph behind it. Its own fn for the 40-line
/// rule (I12), and because the two halves are one decision.
fn workspace_said(
    theirs: &agent::Space,
    who: &str,
    me: &str,
    durable: bool,
) -> (String, String) {
    // ONE FACT, ONE WORDING (R5-14). This line said `Shell working
    // directory: /root/spaces/research` with `main` selected and
    // `researcher's workspace: /root/spaces/research` with `researcher` —
    // the same disclosure, over the same value, in two vocabularies, so
    // switching agent read as a change of subject rather than of subject's
    // name. It is one fact: whose folder, and where. Whether this box types
    // into it is a SECOND fact, and it is said as one.
    (
        format!("{who}'s folder: {}", theirs.path()),
        format!(
            // …AND IT SAYS IT ONCE, IN AN ORDINARY VOICE (R6-14). This read
            // "It is a REAL shell, not a restricted one" — the product
            // shouts nowhere else, and a paragraph that raises its voice
            // reads as a different author, in the one note whose whole job
            // is to be believed about what an agent can reach.
            //
            // …AND IN THE READER'S TERMS (R10-10): "the path check on the file
            // tools is legibility rather than containment" is a sentence about
            // our code, in the paragraph a person reads to learn how far an
            // agent reaches. The claim is kept; the implementation is not.
            "{}{who} works in the {} space, so every command it runs starts in {}. exec \
             runs a shell command there, and it is a full shell: {who} can read anything in \
             this Linux, not only this folder. The Linux in this tab is as far as it goes — \
             the folder is this page's, and what every agent naming this space shares is \
             its facts and notes, not the folder. {}",
            match who == me {
                true => "The command box below types into it. ",
                false => "",
            },
            theirs.name,
            theirs.path(),
            crate::browsable::kept(durable)
        ),
    )
}
