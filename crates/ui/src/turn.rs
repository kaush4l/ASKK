//! One turn in flight: what the pane is showing, and the polling that follows a
//! turn to its end. Split from `chat.rs` for the 200-line rule (I12).

use adapters_web::sleep;
use dioxus::prelude::*;
use kernel::{Request, Response};

/// What the pane is showing, as ONE value: whose conversation it is, the
/// conversation itself, and whether THAT agent's turn is still running.
///
/// One read, so the heading and the transcript can never name different agents.
/// Before this, switching agents mid-turn showed one agent's private
/// conversation under another's name until you sent a message or reloaded
/// (`ux-walker`, increment 07).
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Shown {
    pub(crate) who: String,
    pub(crate) html: String,
    /// In flight FOR `who` — the `x-turn` header of that agent's own
    /// projection. Per agent, never per page: one agent's slow turn must not
    /// disable the composer of another, which has its own Worker.
    pub(crate) pending: bool,
    /// The last thing the PERSON said here (`x-last-said`), so the way out of
    /// a failed turn does not depend on this page having been the one that
    /// sent it (R3-5).
    pub(crate) last_said: String,
    /// Whether THIS run can be stopped from this page (`x-stoppable`). The core
    /// answers it, because only the core knows whose loop the turn is in: a
    /// sub-agent's runs in its own Worker and nothing here reaches it, so the
    /// pane must not offer a control that would do nothing (R16-P0-2).
    pub(crate) stoppable: bool,
    /// This agent's `max_rounds:` (`x-max-rounds`). The one thing that is true
    /// of a run this page cannot stop: it ends when it answers, or here.
    pub(crate) ceiling: String,
}

/// The signals one turn moves. Grouped so `watch` takes a turn and not six
/// arguments; `Signal` is `Copy`, so this is free.
#[derive(Clone, Copy)]
pub(crate) struct Turn {
    pub(crate) shown: Signal<Shown>,
    pub(crate) note: Signal<String>,
    pub(crate) elapsed: Signal<u32>,
    pub(crate) stopped: Signal<bool>,
    /// Stop pressed, boundary not reached yet. UI-local on purpose: it says
    /// only that this page has sent the press, and the moment the core writes
    /// the stop the projection takes over and this row is gone.
    pub(crate) halting: Signal<bool>,
    /// Bumped on every projection so the tool trace follows the turn live.
    pub(crate) tick: Signal<u32>,
    /// Every token this page has spent (`x-tokens`). The shell owns the signal
    /// because the meter is in the frame, and it rides this poll because a
    /// meter does not earn a clock of its own.
    pub(crate) tokens: Signal<u64>,
}

/// One seam request addressed to THIS pane's agent (increment 07): `/chat`
/// projects one conversation per agent, and an unaddressed request means
/// "whoever the page itself is".
pub(crate) fn to(agent: &str, req: Request) -> Request {
    req.with_header("x-agent", agent)
}

/// Apply one seam response as a single value. Whose conversation it is comes
/// from the response's own `x-agent` header — the core says who it projected —
/// falling back to the agent asked about when the answer is an error fragment.
pub(crate) fn show(asked: &str, res: Response, mut turn: Turn) {
    let who = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-agent")
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| asked.to_string());
    let pending = res.headers.iter().any(|(k, v)| k == "x-turn" && v == "pending");
    if let Some(spent) = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-tokens")
        .and_then(|(_, v)| v.parse::<u64>().ok())
    {
        turn.tokens.set(spent);
    }
    let said = |name: &str| {
        res.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
    };
    let shown_who = who.clone(); // …and the log it scrolls is that agent's (§7)
    turn.shown.set(Shown {
        who,
        last_said: said("x-last-said").unwrap_or_default(),
        stoppable: said("x-stoppable").is_some(),
        ceiling: said("x-max-rounds").unwrap_or_default(),
        html: res.body,
        pending,
    });
    let n = turn.tick.peek().to_owned();
    turn.tick.set(n + 1);
    // The newest message, where it can be read: from 12c the conversation is a
    // scroller inside a full-height column, so it has the terminal's old
    // problem and the terminal's fix. The DOM catches up next frame.
    let scrolled = shown_who;
    spawn(async move {
        let _ = sleep(30).await;
        crate::route::newest_turn(&scrolled);
    });
}
