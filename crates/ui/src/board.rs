//! `AgentBoard` — the status of every agent and nothing else (plan, "UI
//! shape"; Python counterpart `core/state.py`). It owns no state: the content
//! is the core's projection of the `AgentStatus` facts in the log (I8).
//!
//! It is also THE PAGE'S OBSERVER: a turn's poller belongs to the agent it
//! started on (increment 07b), so once you switch tabs nothing else calls the
//! seam at all — and a status queued by a Worker only reaches the log when
//! something does. The board therefore keeps its own clock running for as long
//! as the core says the board is not final (`x-watch`), whichever agent that
//! is about. Two bugs were one bug: a board reading "working — inside a turn"
//! two minutes after that turn failed, and a prompt swap that never installed
//! because the turn it was waiting on ended with nobody watching (12 walk).

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

/// How long to keep asking: 400 ms × 450 = 3 minutes, past both a Worker boot
/// and the longest turn the broker will hold open. ponytail: a fixed ceiling,
/// not a heartbeat forever — an agent wedged in `Working` would otherwise poll
/// this tab for the rest of its life. Raise it if a real turn ever runs longer.
const TICK_MS: i32 = 400;
const TICKS: u32 = 450;

/// Apply one projection, and answer the only question the loop asks: is this
/// board final? `x-busy` and `x-watch` are headers for the same reason `x-turn`
/// is — the pane must not parse its own fragment to learn what it is showing.
fn show(res: Response, mut rows: Signal<String>, mut busy: Signal<bool>) -> bool {
    let has = |name: &str| res.headers.iter().any(|(k, _)| k == name);
    busy.set(has("x-busy"));
    let watch = has("x-watch");
    rows.set(res.body);
    watch
}

#[component]
pub fn AgentBoard(web: Signal<Option<Rc<WebApp>>>, mut tick: Signal<u32>) -> Element {
    let rows = use_signal(String::new);
    let busy = use_signal(|| false);
    // Exactly one clock. Without it every `tick` during a turn would start
    // another loop, and the page would poll the seam N times per interval.
    // `peek`, never `read`: subscribing the effect to its own flag would
    // restart the loop the moment it let go, and the ceiling would mean nothing.
    let mut watching = use_signal(|| false);

    use_effect(move || {
        let _ = tick();
        let Some(app) = web.read().clone() else { return };
        let again = show(app.handle(Request::get("/board")), rows, busy);
        if !again || watching.peek().to_owned() {
            return;
        }
        watching.set(true);
        spawn(async move {
            for _ in 0..TICKS {
                if sleep(TICK_MS).await.is_err() {
                    break;
                }
                let Some(app) = web.peek().clone() else { break };
                if !show(app.handle(Request::get("/board")), rows, busy) {
                    break;
                }
            }
            // The board just went final: whatever that turn changed — an agent
            // swap `reconcile` was deferring, a roster the turn wrote — is
            // installed NOW, and every other pane reads from this counter. Sent
            // before the flag drops so the effect this wakes sees the loop as
            // still running and does not start a second one.
            let n = tick.peek().to_owned();
            tick.set(n + 1);
            watching.set(false);
        });
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
            // Always in the tree, empty when nothing is running: a live region
            // announces CHANGES to itself, so one that is inserted at the same
            // moment as its text is a status a screen reader may never hear.
            p { class: "pending board-busy", role: "status",
                if busy() { "an agent is working…" }
            }
        }
    }
}
