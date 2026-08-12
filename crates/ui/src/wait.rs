//! The wait: the row that says a turn is running, and the press that ends it.
//! Split from `turn.rs`, which owns the turn itself, so both hold the 200-line
//! rule (I12) once the meter rides the same poll.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::turn::{show, to, Turn};
use crate::ui::Button;

/// The user stopped waiting. The wait is not the only thing that ends: the
/// TURN does, across the seam, or the swap `roster::reconcile` defers while a
/// task is outstanding never lands — a prompt saved mid-flight stayed
/// uninstalled 45s after the press, until a reload (11b walk).
fn stop_waiting(web: Signal<Option<Rc<WebApp>>>, turn: Turn, who: &str) {
    if let Some(app) = web.peek().clone() {
        show(who, app.handle(to(who, Request::post_form("/chat/stop", &[]))), turn);
    }
    // No local override of `pending` any more. It used to be forced false here
    // and then set true again one tick later by the loop's last projection,
    // which froze the clock at whatever second the press happened and left the
    // composer disabled for the rest of the timeout (12 walk, finding 2). The
    // stop is a FACT now, for any agent, so the projection answers correctly
    // and the pane has nothing to override.
    //
    // And no note. The transcript the line above just re-read already ends
    // with `transcript::STOPPED`, which said the same thing in nearly the same
    // words one line lower: one event, said twice, is the page disagreeing
    // with itself about how many things happened (12b walk, finding 2).
}

/// While a turn is in flight: how long it has been, and the way out.
pub(crate) fn waiting_row(
    web: Signal<Option<Rc<WebApp>>>,
    turn: Turn,
    busy: bool,
    who: String,
) -> Element {
    let mut stopped = turn.stopped;
    rsx! {
        if busy {
            p { class: "pending wait-clock", role: "status",
                "waiting for the model — {turn.elapsed}s "
                Button {
                    variant: "secondary",
                    onclick: move |_| {
                        stopped.set(true);
                        stop_waiting(web, turn, &who);
                    },
                    "Stop waiting"
                }
            }
        }
    }
}
