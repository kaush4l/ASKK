//! THE PANE ITSELF: the scroller, what it says before anything has happened in
//! it, and the assembly of the rows into one projection. Split from
//! `scrollrows.rs`, which decides WHICH rows and whose they are, so both hold
//! the 200-line rule (I12).

use module::view::FragmentBuilder;

use crate::dispatch::Ctx;

/// The scroller: whose pane it is, and which folder its commands run in.
fn scroller(ctx: &Ctx, who: &str) -> FragmentBuilder {
    // THE SELECTED AGENT'S folder (R5-1): this carried main's path on an agent
    // the same pane said has no workspace at all.
    let root = crate::scrollback::space_of(ctx, who)
        .map(|s| s.path())
        .unwrap_or_else(|| "none".into());
    FragmentBuilder::new("div")
        .id("terminal")
        .attr("data-agent", who)
        .attr("data-workspace", &root)
}

/// The pane before anything has happened in it — for the agent it is actually
/// about, which is not always this page's own (R4-1).
fn nothing_yet(ctx: &Ctx, who: &str) -> module::view::Fragment {
    // NO FOLDER IS NOT "HAS NOT STARTED" (R5-1); what this pane counts is SHELL
    // COMMANDS, not tool calls (R10-8).
    let alone = crate::scrollback::space_of(ctx, who).is_none();
    let said = match (who == ctx.me, alone) {
        // …and this is the ONE place it is said on this view (R10-11), so it
        // carries the way out too — `browsable`'s wording, not a second one.
        (_, true) => format!(
            "{who} has no folder, so it runs no commands. {}",
            crate::browsable::GIVE_IT_A_SPACE
        ),
        (true, _) => "No shell command has been run here yet. The Linux boots on the first one — \
                      it streams its disk, so that one takes longer than the rest."
            .to_string(),
        (false, _) => format!(
            "{who} has not run a shell command yet. It reports each one it runs, and those are \
             what this pane and its tool trace both show."
        ),
    };
    FragmentBuilder::new("p").class("pending").text(&said).build()
}

/// WHY THERE IS NO COMMAND BOX (R16-P1-3). With `ask` selected the field and
/// the Run button simply vanished, and nothing on the view said why: the one
/// place that explains it is the Agents view's origin line, and the sentence
/// nearest to it here was folded inside the workspace note. `None` for this
/// page's own agent — a `main` with no workspace is told so by the pane's own
/// empty state (`scrollpanel::nothing_yet`), and this must not say it twice.
///
/// WHICH sentence comes from the toolbox, not from the space: an agent's
/// declared `tools:` can take the folder and leave the shell behind, which is
/// what a read-only agent IS, and `origin_line` asks the same function the same
/// question. Two wordings of "it has no shell" is how they would drift.
pub(crate) fn no_box_why(ctx: &Ctx, who: &str) -> Option<String> {
    if who == ctx.me {
        return None;
    }
    let shell = ctx
        .agents
        .iter()
        .find(|spec| spec.name == who)
        .is_some_and(|spec| agent::toolbox_for(spec, &[]).get("exec").is_some());
    Some(match shell {
        false => format!(
            "{who} has no shell — it can read this Linux but not change it. Switch to {me} to \
             run commands.",
            me = ctx.me
        ),
        true => format!(
            "{who} runs its own commands, separately from this page. Switch to {me} to type \
             one here.",
            me = ctx.me
        ),
    })
}

/// The whole scrollback: every `exec` this page's agent has run, in log order.
pub(crate) fn panel(ctx: &Ctx, who: &str) -> String {
    panel_with(ctx, who, None)
}

/// …plus `typed`, a command requested in THIS request and so not yet in
/// `App::running` — every other in-flight command comes from `running`, which
/// is why the pane survives a round trip through another view (R2-8).
pub(crate) fn panel_with(ctx: &Ctx, who: &str, typed: Option<&str>) -> String {
    let mut list = scroller(ctx, who);
    let mut count = 0usize;
    // WHOSE commands these are comes from the RECORD, never the picker (R4-1):
    // `scrollrows` owns it, and gives the tool trace the same answer.
    for row in crate::scrollrows::commands(ctx, who) {
        list = list.child(row);
        count += 1;
    }
    // WHAT IS STILL RUNNING, inside the scroller where the newest output is.
    // Only this page's own agent: `running` is this process's queue (`can_type`).
    let mut waiting = 0usize;
    if who == ctx.me {
        for row in crate::scrollrows::in_flight(ctx, typed) {
            list = list.child(row);
            waiting += 1;
        }
    }
    if count == 0 && waiting == 0 {
        list = list.child(nothing_yet(ctx, who));
    }
    list = list.attr("data-running", &waiting.to_string());
    // The note stays OUTSIDE `#terminal` (the scroller) and AFTER it: the shell
    // output is the signal, the footnote was three times its size (12b, D2).
    format!(
        "{}{}",
        list.attr("data-commands", &count.to_string())
            .build()
            .into_html(),
        // …AND NO NOTE FOR AN AGENT WITH NO FOLDER (R10-11): said once, above.
        crate::spacenote::note(ctx, who).map(module::view::Fragment::into_html).unwrap_or_default()
    )
}
