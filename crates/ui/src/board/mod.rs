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

pub(crate) mod examples;
pub(crate) mod launch;
pub(crate) mod read_attrs;
pub(crate) mod roster;
pub(crate) mod tiles;

use std::rc::Rc;

use adapters_web::{sleep, WebApp};

use dioxus::prelude::*;
use kernel::{Request, Response};

use crate::shell::views::View;


use crate::ui::{has_rows, Button, Card, Disclosure, EmptyState, Skeleton};

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

/// Where a press in the board goes. `read_attrs::pressed` reads which agent it
/// was about; this file owns only the two routes a board press can take.
fn opened(event: Event<MouseData>) -> Option<()> {
    let (open, name) = read_attrs::pressed(&event, ".agent-row")?;
    let to = match open.as_str() {
        "trace" => View::Work,
        _ => View::Work,
    };
    crate::shell::route::show(to, &name);
    Some(())
}

/// What an empty board MEANS. A board with no rows is not "nothing is
/// running"; it is "no agent was loaded at all", which is a different fact
/// with a different fix. Its own fn so `AgentBoard` stays one job (I12).
fn nothing_loaded(view: Signal<View>) -> Element {
    rsx! {
        EmptyState {
            title: "No agents are loaded",
            // ONE SENTENCE (R8-EMPTY); "How the board is produced" is directly
            // below and says the rest.
            sentence: "This panel is every agent this page is running, and none has arrived \
                       with the site or been written here yet.",
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Agents);
                    crate::ui::focus("agent-name");
                },
                "Write an agent"
            }
        }
    }
}

#[component]
pub fn AgentBoard(
    web: Signal<Option<Rc<WebApp>>>,
    mut tick: Signal<u32>,
    /// The route the empty state's one action takes. An empty board means no
    /// agent is loaded, and the only thing that fixes that is writing one —
    /// which is the Agents view. The same signal the nav sets, so this is an
    /// entry point to an existing route, not a new one.
    view: Signal<View>,
    /// The RAIL's copy of this panel (F24). Identical card, identical rows,
    /// identical prose, ~460px of it, on four views of seven — the most
    /// repeated element in the product and not the most important one. The
    /// Dashboard keeps the full card because there the board IS the subject;
    /// beside a conversation it is a glance, so the rows stay and the prose —
    /// the same three sentences every time — does not.
    compact: Option<bool>,
) -> Element {
    let compact = compact.unwrap_or(false);
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

    let projection = rows.read().clone();
    rsx! {
        // NOT "Agents running" (R5-10): the rows below it read `ready · no
        // turns yet`, every one of them, for as long as nothing is running —
        // which is most of the time. The card is the fleet and its state, and
        // "an agent is working…" below already says when one is.
        Card { title: "Agents and what they are doing",
              aria_label: "Agents and what they are doing",
            div { class: if compact { "board compact" } else { "board" }, aria_live: "polite",
                if projection.is_empty() {
                    // Not "nothing is running" — "nobody has answered yet".
                    // The two used to be the same empty box, which is the
                    // shape a broken panel has.
                    Skeleton { lines: 2, label: "Reading the agents" }
                } else if has_rows(&projection, "agent-row") {
                    // A card is a door (27); `board-rows` is named for the
                    // grid that has to reach past it (`mission.css`).
                    div {
                        class: "board-rows",
                        onclick: move |e: Event<MouseData>| { opened(e); },
                        dangerous_inner_html: "{projection}",
                    }
                } else {
                    {nothing_loaded(view)}
                }
            }
            // Always in the tree, empty when nothing is running: a live region
            // announces CHANGES to itself, so one that is inserted at the same
            // moment as its text is a status a screen reader may never hear.
            p { class: "pending board-busy", role: "status",
                if busy() { "an agent is working…" }
            }
            // WHAT A TURN IS, WHERE THE WORD IS FIRST READ (R16-1). Every row
            // above says `ready · no turns yet` and the header says an agent
            // is working; the definition lived only inside the fold below,
            // which is a definition nobody meets. One line, visible, here.
            p { class: "note",
                "A turn is one stretch of work an agent takes on — from the message or task \
                 that started it to the moment it stopped, whether that ended in an answer \
                 or in a failure."
            }
            // The explanation goes BEHIND the rows, not in front of them: this
            // pane spent three lines of prose above two lines of signal, in the
            // region that is meant to be the live instrument face (12b walk,
            // finding D2). Not one word of it is cut.
            if !compact {
                Disclosure { summary: "How this panel is produced",
                    p { class: "note",
                        "Every agent loaded in this browser runs on its own, so one agent \
                         thinking slowly cannot hold up another. This is what each is doing \
                         right now. Where each one came from is in the Agents view."
                    }
                }
            }
        }
    }
}
