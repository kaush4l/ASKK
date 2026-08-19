//! `FleetTiles` — the strip of at-a-glance facts across the top of the
//! Dashboard, above the grid. It lives beside the board rather than in
//! `centre`, which only routes the column: every number on it is a fold of the
//! same `/board` facts the board below it renders.
//!
//! It owns no state and computes nothing: the four tiles are the core's own
//! projection of the fold the board renders (`core::board::tiles`), fetched through
//! the one seam like every other pane. The reason that matters here more than
//! elsewhere is that a tile is the shortest thing on the page — four words
//! over a number — and the shortest thing is the one nobody re-checks. A tile
//! that counted for itself would be believed for as long as it was wrong.
//!
//! **It has no clock of its own.** The board beside it polls at 400ms while a
//! turn is in flight and bumps `tick` when that turn goes final; the shell's
//! heartbeat bumps it every two seconds regardless. Reading those is a strip
//! that is never more than two seconds stale, for no third timer. ponytail: if
//! a tile ever needs to move faster than the board it sits above, that is the
//! moment to give it one, and not before.
//!
//! **Nothing is rendered until the core has answered** (R6-BOOT, the same rule
//! the header's pills follow): during boot this page does not know how many
//! agents are loaded, and four tiles of shimmer are a promise that a number is
//! coming from a projection that may report `no agents are loaded`.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

#[component]
pub fn FleetTiles(web: Signal<Option<Rc<WebApp>>>, tick: Signal<u32>) -> Element {
    let mut strip = use_signal(String::new);
    use_effect(move || {
        let _ = tick();
        let Some(app) = web.read().clone() else { return };
        strip.set(app.handle(Request::get("/tiles")).body);
    });
    let projection = strip.read().clone();
    rsx! {
        if !projection.is_empty() {
            // `aria-live` is deliberately ABSENT. These four facts change on
            // every turn and three of them are numbers; announcing each one as
            // it moves would talk over the conversation a screen-reader user is
            // there to read. The pane that owns the news — the board — already
            // carries the polite region that says an agent is working.
            // An unclassed wrapper: the strip's own grid is `.tiles`, which the
            // core's fragment carries. A class here would be a second name for
            // one region and nothing in `mission.css` to hang on it.
            div { dangerous_inner_html: "{projection}" }
        }
    }
}
