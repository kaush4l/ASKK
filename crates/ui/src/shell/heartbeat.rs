//! THE PAGE'S OWN PULSE — one poll, from the shell, for as long as the page is
//! open, and the four header facts it carries back.
//!
//! Every Worker fact reaches the log through `WebApp::handle`, which drains the
//! Workers' queues on ANY seam call. Before this, "is anything observing the
//! fleet" was really "does the current view mount a panel that polls" — so a
//! run you launched and walked away from stopped being watched the moment you
//! changed view. `warmth.rs` beside it owns the sandbox pill, which polls a
//! module global rather than the seam.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

/// How often the page checks on itself. Two seconds: slower than a turn's own
/// poll and fast enough that a status is never a minute stale.
const HEARTBEAT_MS: i32 = 2000;

/// The page's own pulse, independent of which view is open.
///
/// Every Worker fact reaches the log through `WebApp::handle`, which drains the
/// Workers' queues on ANY seam call — so "is anything observing the fleet" was
/// really "does the current view mount a panel that polls".
///
/// One call, from the shell, forever — a GET, so it does not grow the log
/// (15M), and bumping `tick` is what every panel already redraws from.
#[component]
pub fn Heartbeat(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// The frame's meter. It used to move only on the chat pane's poll, so a
    /// task launched from the Dashboard spent tokens the number never showed.
    tokens: Signal<u64>,
    /// What the board says about the fleet — what failed, whose it was, which
    /// instance it is, and who is working (`shell::status_pills::Fleet`). Two pills in the
    /// chrome read it, and this is the poll it comes off.
    fleet: crate::shell::status_pills::Fleet,
) -> Element {
    use_future(move || async move {
        loop {
            if sleep(HEARTBEAT_MS).await.is_err() {
                return;
            }
            let Some(app) = web.peek().clone() else { continue };
            // The board is the fleet's own projection, and asking for it is
            // what drains the Workers' reports into the log.
            let res = app.handle(Request::get("/board"));
            let failed = crate::board::read_attrs::failure(&res);
            // Four facts, one response. `set` only on a change: every one of
            // these is read by a pill, and rewriting an unchanged value would
            // redraw the chrome twice a second forever.
            for (mut signal, now) in [
                (fleet.why, failed.why),
                (fleet.who, failed.who),
                (fleet.stamp, failed.turn),
                (fleet.running, crate::board::read_attrs::header(&res, "x-busy")),
            ] {
                if *signal.peek() != now {
                    signal.set(now);
                }
            }
            if let Some(spent) = res
                .headers
                .iter()
                .find(|(k, _)| k == "x-tokens")
                .and_then(|(_, v)| v.parse::<u64>().ok())
            {
                let mut tokens = tokens;
                if *tokens.peek() != spent {
                    tokens.set(spent);
                }
            }
            let mut tick = tick;
            let n = tick.peek().to_owned();
            tick.set(n + 1);
        }
    });
    rsx! {}
}
