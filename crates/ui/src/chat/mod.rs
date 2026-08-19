//! `ChatPane` — one agent's conversation (plan, "UI shape"; Python counterpart
//! `Engine.messages`). It owns the draft you are typing and nothing else: every
//! message on screen is the core's own projection of the event log (I8).
//!
//! The heading and the transcript are two halves of ONE read (`chat::state::Shown`),
//! so nothing this pane can be handed shows one agent's conversation under
//! another agent's name. One instance per agent, and since THREADS.md the
//! document can hold two: every id it plants carries the agent's name.

pub(crate) mod header;
pub(crate) mod inflight_row;
pub(crate) mod log;
pub(crate) mod poller;
pub(crate) mod retry_actions;
pub(crate) mod state;
pub(crate) mod thread;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;



use crate::chat::state::{show, to, Shown, Turn};
use crate::shell::views::View;
use crate::chat::poller::follow;

/// EVERYTHING ONE CONVERSATION IS MADE OF, in one value.
///
/// The regions below take this rather than nine arguments, and they are plain
/// functions rather than `#[component]`s because of what is in it: `Turn` is a
/// bundle of signals with no `PartialEq`, which is what Dioxus's props derive
/// needs. `waiting_row` and `clear_row` have been plain functions for the same
/// reason since they were written.
#[derive(Clone, Copy)]
pub(crate) struct Pane {
    pub(crate) web: Signal<Option<Rc<WebApp>>>,
    pub(crate) endpoint_set: Signal<bool>,
    /// WHICH agent this pane is the conversation with — a `ReadSignal`, so
    /// switching agents re-projects rather than re-mounting.
    pub(crate) agent: ReadSignal<String>,
    pub(crate) view: Signal<View>,
    pub(crate) turn: Turn,
    /// One poller per pane (`chat::poller::follow`).
    pub(crate) watching: Signal<bool>,
    /// Whether Clear has been pressed once (`chat::header::clear_row`). Held for the
    /// pane so switching agents disarms it: `reproject` already runs on that
    /// change.
    pub(crate) arm_clear: Signal<bool>,
    /// What the last turn was carrying, so a failed one can be sent again
    /// without retyping it (F11). The projection's own `x-last-said` is the
    /// truth — it survives a reload and a launch from another surface — and
    /// this only covers the instant between the press and the next projection.
    pub(crate) last_sent: Signal<String>,
}

/// The signals one turn moves (`chat::state::Turn`), created where the pane is: the
/// clock and the token meter come from the shell, everything else starts here.
fn new_turn(tick: Signal<u32>, tokens: Signal<u64>) -> Turn {
    Turn {
        shown: use_signal(Shown::default),
        note: use_signal(String::new),
        elapsed: use_signal(|| 0),
        stopped: use_signal(|| false),
        halting: use_signal(|| false),
        tick,
        tokens,
    }
}

/// First paint, AND every arrival back at this view (R3-1). The pane stays
/// MOUNTED on every route (`stage`), so it fetched once, at boot, on an empty
/// conversation — and a Dashboard launch runs in that agent's Worker with
/// nothing here watching: "Read the reply" landed on "No messages yet".
///
/// `roster` moves only when an agent's identity does, so it cannot loop against
/// `tick`: an agent swapped under this pane re-projects the conversation.
fn reproject(pane: Pane, roster: ReadSignal<String>) {
    let (mut note, mut arm_clear, agent) = (pane.turn.note, pane.arm_clear, pane.agent);
    use_effect(move || {
        let (who, _, _) = (agent(), roster(), (pane.view)());
        arm_clear.set(false);
        if let Some(app) = pane.web.read().clone() {
            note.set(String::new());
            show(&who, app.handle(to(&who, Request::get("/chat"))), pane.turn);
            if pane.turn.shown.peek().pending {
                follow(pane.web, pane.turn, agent, who, pane.watching);
            }
        }
    });
}

/// Say something: the one path a message takes out of this pane, whether it was
/// typed in the composer or re-sent by the failed-turn recovery.
pub(crate) fn say(pane: Pane, text: String) {
    let Some(app) = pane.web.peek().clone() else { return };
    let who = pane.agent.peek().clone();
    let (mut last_sent, mut note) = (pane.last_sent, pane.turn.note);
    last_sent.set(text.clone());
    note.set(String::new());
    let req = to(&who, Request::post_form("/chat", &[("message", &text)]));
    show(&who, app.handle(req), pane.turn);
    follow(pane.web, pane.turn, pane.agent, who, pane.watching);
}

#[component]
pub fn ChatPane(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
    /// The page's token meter — written here because this pane's poll is the
    /// projection that carries it, read by the header (`main::shell`).
    tokens: Signal<u64>,
    /// The roster's fingerprint (`main::shell`). Read by `reproject`, so an
    /// agent swapped under this pane re-projects the conversation.
    roster: ReadSignal<String>,
    /// WHICH agent this pane is the conversation with. A `ReadSignal` so
    /// switching agents re-projects: the same component, one instance per
    /// agent, never a mode flag (plan: `ChatPane` owns one conversation).
    agent: ReadSignal<String>,
    /// Where "Open Settings" goes when a turn fails (F11). The same signal the
    /// nav sets: the failure copy says to check the endpoint in Settings, and
    /// nothing on the failed screen took you there.
    view: Signal<View>,
    /// The thread's own summary row (`thread::summary`), rendered where the
    /// `<h2>` used to be. It says the agent's name and what that agent is
    /// doing, off the board — so the heading `Chat · main` would be a second,
    /// thinner copy of the first three words of it, and it goes.
    head: Element,
) -> Element {
    let pane = Pane {
        web,
        endpoint_set,
        agent,
        view,
        turn: new_turn(tick, tokens),
        watching: use_signal(|| false),
        arm_clear: use_signal(|| false),
        last_sent: use_signal(String::new),
    };
    reproject(pane, roster);
    log::conversation(pane, head)
}
