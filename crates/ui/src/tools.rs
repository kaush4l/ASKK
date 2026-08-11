//! `ToolTrace` — calls, args, results and errors (plan, "UI shape"; Python
//! counterpart `core/tools.py`). It owns nothing but the fetch: the content is
//! the core's own projection of the `ToolInvoked` facts in the event log (I8),
//! so a reload redraws the same trace from the replayed log.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

#[component]
pub fn ToolTrace(web: Signal<Option<Rc<WebApp>>>, tick: Signal<u32>) -> Element {
    let mut trace = use_signal(String::new);
    // Re-projected whenever a turn moves; the pane holds no state of its own.
    use_effect(move || {
        let _ = tick();
        if let Some(app) = web.read().clone() {
            trace.set(app.handle(Request::get("/tools")).body);
        }
    });
    rsx! {
        section { class: "panel", aria_label: "Tool trace",
            h2 { "Tools" }
            p { class: "note",
                "Every tool the agent called this session, with the arguments it \
                 wrote and what came back — including calls that were refused."
            }
            div { dangerous_inner_html: "{trace}" }
        }
    }
}
