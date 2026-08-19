//! Everything the pane learns about a conversation WITHOUT parsing the HTML it
//! was just handed: who it is with, what it has spent, the way back out of a
//! failed turn, and whether the run can be stopped. Each is a header rather
//! than a sentence in the body, so no reader has to read prose back as data.

use kernel::Response;

use super::Woven;
use crate::dispatch::{html, Ctx};
use crate::chat::fold::spent;

/// The rendered conversation, headed by everything said about it.
pub(super) fn response(ctx: &Ctx, who: &str, woven: Woven, pending: bool) -> Response {
    let Woven { list, tools, last_said, .. } = woven;
    let body = format!(
        "{}{}",
        crate::chat::heading::header(ctx, who),
        list.attr("data-tools", &tools.to_string()).build().into_html()
    );
    let mut response = html(200, body);
    // WHO this conversation is with, as a header rather than a sentence in the
    // body: the pane must be able to title itself without parsing the fragment
    // or leaning on an editable `description` line (`ux-walker`, increment 03).
    response.headers.push(("x-agent".into(), who.to_string()));
    // What this page has spent, on a projection the pane already polls every
    // 400 ms: the meter earns no route of its own and no second clock, so it
    // rides here. Every agent's spend, not this one's.
    response.headers.push(("x-tokens".into(), spent(ctx).to_string()));
    // …and the last thing the person said, so the way out of a failed turn is
    // the same whichever way it failed (R3-5). A header, so the pane never
    // reads it back out of the HTML it was just handed.
    response.headers.push(("x-last-said".into(), last_said));
    if pending {
        response.headers.push(("x-turn".into(), "pending".into()));
    }
    stopping(&mut response, ctx, who, pending);
    // `x-orphaned` was here (R5-18), for a second notice the Dashboard drew
    // under its form. R9-1 moved that truth INTO the launch card, off the board
    // row's own `data-orphaned` — so this header had no reader left.
    response
}

/// WHETHER THIS RUN CAN BE STOPPED AT ALL, and — WHEN IT CANNOT — what does end
/// it (R17-P0-1). Only the page's own agent runs in this loop; a sub-agent's
/// turn is in its own Worker, which no fact written here reaches. Headers
/// rather than sentences, so the pane offers the control exactly where it works
/// instead of guessing at whose turn it is. The pane used to point at the
/// Commands view, which is false twice over; the round ceiling in the agent's
/// own file is true of every run, so that is what rides here for the copy.
fn stopping(response: &mut Response, ctx: &Ctx, who: &str, pending: bool) {
    if pending && who == ctx.me {
        response.headers.push(("x-stoppable".into(), "yes".into()));
    }
    if let Some(spec) = ctx.agents.iter().find(|s| s.name == who) {
        response.headers.push(("x-max-rounds".into(), spec.max_rounds.to_string()));
    }
}
