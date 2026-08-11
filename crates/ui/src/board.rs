//! `AgentBoard` — the status of every agent and nothing else (plan, "UI
//! shape"; Python counterpart `core/state.py`). It owns no state: the content
//! is the core's projection of the `AgentStatus` facts in the log (I8).
//!
//! ponytail: it reads `ChatPane`'s tick rather than keeping a clock for turns
//! — a delegation only happens inside a turn, and that pane already re-projects
//! every 400 ms while one is running. It DOES watch its own boot, because a
//! Worker comes up on nobody's schedule and an idle page would otherwise sit on
//! "starting — its Worker is coming up" until you happened to type something.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

/// How long to keep asking while Workers come up: 400 ms × 30 = 12 s, well
/// past a local Worker boot. A Worker that has not reported by then has its
/// own row saying so — this loop is not what reports a failure.
const TICK_MS: i32 = 400;
const TICKS: u32 = 30;

/// Apply one projection. `x-busy` and `x-settling` are headers for the same
/// reason `x-turn` is: the pane must not parse its own fragment to learn what
/// it is showing.
fn show(res: Response, mut rows: Signal<String>, mut busy: Signal<bool>) -> bool {
    let has = |name: &str| res.headers.iter().any(|(k, _)| k == name);
    busy.set(has("x-busy"));
    let settling = has("x-settling");
    rows.set(res.body);
    settling
}

#[component]
pub fn AgentBoard(web: Signal<Option<Rc<WebApp>>>, tick: Signal<u32>) -> Element {
    let rows = use_signal(String::new);
    let busy = use_signal(|| false);

    use_effect(move || {
        let _ = tick();
        if let Some(app) = web.read().clone() {
            let settling = show(app.handle(Request::get("/board")), rows, busy);
            if !settling {
                return;
            }
            // Workers are still booting: keep asking until they have all
            // reported, then stop. This is the only clock this pane owns.
            spawn(async move {
                for _ in 0..TICKS {
                    if sleep(TICK_MS).await.is_err() {
                        return;
                    }
                    let Some(app) = web.peek().clone() else { return };
                    if !show(app.handle(Request::get("/board")), rows, busy) {
                        return;
                    }
                }
            });
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
