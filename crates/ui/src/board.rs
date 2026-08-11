//! `AgentBoard` — the status of every agent and nothing else (plan, "UI
//! shape"; Python counterpart `core/state.py`). It owns no state: the content
//! is the core's projection of the `AgentStatus` facts in the log (I8).
//!
//! ponytail: no clock of its own. `ChatPane` already re-projects every 400 ms
//! for as long as a turn is running, and a delegation only happens inside one
//! — so reading its tick is what makes an agent visibly go Working → Idle
//! DURING the turn rather than after a reload. A board with a second timer
//! would poll an idle page for nothing.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

#[component]
pub fn AgentBoard(web: Signal<Option<Rc<WebApp>>>, tick: Signal<u32>) -> Element {
    let mut rows = use_signal(String::new);
    let mut busy = use_signal(|| false);

    use_effect(move || {
        let _ = tick();
        if let Some(app) = web.read().clone() {
            let res = app.handle(Request::get("/board"));
            // `x-busy` is a header for the same reason `x-turn` is: the pane
            // must not parse its own fragment to learn what it is showing.
            busy.set(res.headers.iter().any(|(k, _)| k == "x-busy"));
            rows.set(res.body);
        }
    });

    rsx! {
        section { class: "panel", aria_label: "Agent board",
            h2 { "Agents running" }
            p { class: "note",
                "Every agent loaded in this browser runs in its own Worker — its own \
                 event loop — so one agent's slow turn cannot hold up another's. This \
                 is what each is doing right now."
            }
            div { class: "board", aria_live: "polite", dangerous_inner_html: "{rows}" }
            if busy() { p { class: "pending", "an agent is working…" } }
        }
    }
}
