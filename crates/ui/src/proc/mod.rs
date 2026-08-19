//! `Processes` — what the agent has left running, beside the folder it left it
//! in. The Workspace view already shows commands, files and artifacts; this is
//! the fourth thing that is true about a machine and the only one a person had
//! to ask the agent for.
//!
//! It owns no capability. A refresh is a `POST /processes`, which emits a fact;
//! the async half runs the agent's own `list_processes` through the same gate,
//! and this pane projects what came back (I8). Stop is the same POST with a
//! name on it, and the async half runs the agent's own `stop_process` — an
//! existing capability given a control, not a new one (R10-6).
//!
//! IT IS A PANEL, NOT A `<pre>` (R10-1). The rows used to be the model's
//! fixed-width table dropped into a 254px rail: `scrollWidth` 1770 against
//! `clientWidth` 254, so the `command` column — the only thing identifying which
//! process a row is — was never on screen. The columns come across on `x-procs`
//! and are laid out here, in the same shape the Files pane lays a folder out in.
//! `row.rs` owns one row — what it says and what pressing it does.

pub(crate) mod row;

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::files::listing::{TICK_MS, WATCH_TICKS};
use crate::proc::row::{procrow, read, Proc};
use crate::ui::{Card, Disclosure, EmptyState, Skeleton};

/// Whether the core served a TABLE rather than the sentence it gives a pane
/// whose agent has no folder here — the same one bit off the core's own markup
/// that `listing::served` reads for the file panes.
fn served(html: &str) -> bool {
    html.contains("id=\"processes\"")
}

/// How many of the rows are still running: the core counts what it rendered and
/// this reads the number back, the contract `data-commands` already has.
fn running_in(html: &str) -> usize {
    html.split_once("data-rows=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .and_then(|(n, _)| n.parse().ok())
        .unwrap_or(0)
}

#[component]
pub fn Processes(
    web: Signal<Option<Rc<WebApp>>>,
    /// Bumped by the page's heartbeat, which is what makes a process the agent
    /// started mid-turn appear here while it is still working — and what moves
    /// a running process's age, because the core measures it from now.
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// The folder the Files pane is on. Opening a process's log means putting
    /// that pane on the folder holding it: one editor in this view, and this
    /// pane points it at a file rather than growing a second one (R10-6).
    at: Signal<String>,
) -> Element {
    let mut panel = use_signal(String::new);
    let mut rows = use_signal(Vec::<Proc>::new);
    let mut watching = use_signal(|| false);
    // Ask once when the pane appears, and again whenever the agent's own state
    // moves — the board's status stamp, already polled by the heartbeat, so no
    // second clock (the rule `files/mod.rs` and `files/artifacts.rs` follow).
    let mut asked_at = use_signal(|| None::<u64>);
    // WATCH for the listing the async half is still producing. One watcher at a
    // time, because each tick is a full trip through the seam.
    let mut watch = move || {
        if watching.peek().to_owned() {
            return;
        }
        watching.set(true);
        let before = panel.peek().clone();
        spawn(async move {
            for _ in 0..WATCH_TICKS {
                if sleep(TICK_MS).await.is_err() {
                    return;
                }
                let (body, listed) = read(&web, &agent(), Request::get("/processes"));
                if body != before && !body.is_empty() {
                    panel.set(body);
                    rows.set(listed);
                    break;
                }
            }
            watching.set(false);
        });
    };
    let mut ask = move |stop: &str| {
        let Some(app) = web.peek().clone() else { return };
        app.handle(
            Request::post_form("/processes", &[("stop", stop)]).with_header("x-agent", &agent()),
        );
        watch();
    };
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        let (body, listed) = read(&web, &agent(), Request::get("/processes"));
        panel.set(body);
        rows.set(listed);
        // NOT FOR AN AGENT WHOSE WORKSPACE THIS IS NOT (R5-1/R7-4): the core
        // refuses the POST, so asking anyway is a refused write in the log
        // every time the board's status moves.
        if !served(&panel.peek().clone()) {
            return;
        }
        let now = crate::board::read_attrs::since(&web, &agent());
        if *asked_at.peek() == Some(now) {
            return;
        }
        asked_at.set(Some(now));
        ask("");
    });
    let projection = panel.read().clone();
    let listed = rows.read().clone();
    let who = agent();
    // NOTHING STARTED and NOTHING LEFT are two different answers (R10-2), and
    // only the first is an empty state: the core says which it is, so a pane
    // whose records a reload destroyed reports the loss instead of claiming
    // that nothing ever happened.
    let none = projection.contains("data-none=\"1\"");
    let title = match running_in(&projection) {
        0 => "Processes".to_string(),
        n => format!("Processes · {n} running"),
    };
    rsx! {
        Card { title, aria_label: "Processes {who} has running",
            // WHAT A PROCESS IS, STILL READABLE ONCE THERE IS ONE (R16-P2-5):
            // the definition lived only in the empty state, so the first
            // process it explained deleted it.
            p { class: "note",
                "A process is something {who} started and left running — a server, a watcher, \
                 a long build."
            }
            div { aria_live: "polite",
                if projection.is_empty() {
                    Skeleton { lines: 2, label: "Asking Linux what is running" }
                } else if none {
                    EmptyState {
                        title: "Nothing has been started",
                        // ONE sentence (R8-EMPTY); the note above says what one
                        // is and the disclosure below says how it gets here.
                        sentence: "{who} has started none.",
                    }
                } else {
                    div { dangerous_inner_html: "{projection}" }
                }
                if !listed.is_empty() {
                    div { class: "proc-list", aria_label: "Processes started here",
                        for row in listed.iter().cloned() {
                            {procrow(row, at, web, agent, ask)}
                        }
                    }
                }
            }
            // NOT OVER AN EMPTY PANE (R11-AESTHETIC). A cold rail stacked three
            // cards, each with a heading, an empty state and a fold — ~700px of
            // "nothing has happened yet" said three ways. The empty state's one
            // sentence says what the region is for; the mechanism is worth
            // reading once there is a mechanism on screen to read it against.
            if !none {
            Disclosure { summary: "How a process gets here",
                // WHAT A RELOAD DOES TO THIS PANE (R10-2), in the last two
                // sentences. They used to say the record survives, which was
                // one engine's behaviour stated as both; there is one engine
                // now and it keeps nothing, so the wording is unconditional.
                p { class: "note",
                    "The agent starts one with start_process, giving it a short name it chooses. \
                     It keeps running after the call returns and everything it prints is captured \
                     to .harness/proc/<name>/log — pressing a row opens that log in the Files \
                     pane above, and Stop runs the agent's own stop_process on it. This list is \
                     the agent's own list_processes, run for you. \
                     The Linux keeps its filesystem in memory, so reloading the tab takes the \
                     running processes AND their records with it. The pane then says what was \
                     started and that nothing is left of it, which is the whole of what is \
                     knowable."
                }
            }
            }
        }
    }
}

