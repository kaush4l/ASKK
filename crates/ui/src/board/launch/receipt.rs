//! THE LAST RUN'S RECEIPT, DERIVED RATHER THAN REMEMBERED (R8-6).
//!
//! `TaskLauncher` held what it had launched in a `use_signal` — the agent, the
//! task, and where that agent's board row stood at the press. A signal belongs
//! to a mounted component, and every view but the Dashboard and Agents unmounts
//! that card: give `main` a job, walk away to Chat while it works, come back,
//! and `main finished “…” / Read the reply` had been replaced by the blank form
//! it started as. There was no other route to the result, in a product whose
//! own lede is "Give main a job and walk away".
//!
//! Nothing new is stored to fix it and no history is kept. Both halves of the
//! receipt are already in the log and already projected: WHAT was asked is the
//! `/chat` transcript's own `x-last-said` — the same header the failed-turn
//! recovery re-sends from — and HOW IT ENDED is the `/board` row the card
//! already reads on every tick. This is the seed those two facts make, handed
//! to the same `LaunchedRun` a live press hands its own.
//!
//! WHAT THIS IS NOT: a run history. It answers for the most recent thing this
//! agent was asked, because that is what the card was already claiming to
//! answer for. The run before it is where it always was — in the conversation.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

/// The launcher's own `(agent, task, baseline)`, rebuilt from the log for an
/// agent that has run at least once, or `None`.
///
/// The baseline is 0 — the timestamp a live press records so it can tell this
/// run's ending from the one that was already on the row. Re-derived, there is
/// no press to be after: every fact on the row is about the newest run, which
/// is the run this receipt is about, so "has the row moved since" is true by
/// construction. `data-since` of 0 is a row that has never changed status, and
/// that is the one case where it is not — an agent that has never run — so it
/// is `None` rather than a receipt for nothing.
pub(crate) fn last_run(web: Signal<Option<Rc<WebApp>>>, who: &str) -> Option<(String, String, u64)> {
    let app = web.peek().clone()?;
    let board = app.handle(Request::get("/board")).body;
    let since: u64 = crate::board::read_attrs::cell(&board, who, "data-since")?
        .parse()
        .ok()?;
    if since == 0 {
        return None;
    }
    let chat = app.handle(Request::get("/chat").with_header("x-agent", who));
    let said = chat
        .headers
        .iter()
        .find(|(k, _)| k == "x-last-said")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    match said.is_empty() {
        true => None,
        false => Some((who.to_string(), said, 0)),
    }
}
