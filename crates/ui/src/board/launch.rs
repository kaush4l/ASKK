//! Hand an agent a task and walk away (15L). Everything until now started work
//! by TALKING to an agent, and the other half — "a way to simply run the agents
//! without human intervention" — had no control at all. This is the same seam
//! call the composer makes (`POST /chat` addressed with `x-agent`), for an agent
//! you are NOT talking to: it starts a turn in that agent's own Worker and
//! returns at once, and the card says how far it has got.

pub(crate) mod form;
pub(crate) mod notes;
pub(crate) mod outcome;
pub(crate) mod receipt;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;


use crate::ui::Card;
use crate::shell::views::View;
use form::TaskForm;
use notes::{ElsewhereRun, WhatPressingStartDoes};

/// The launch itself, in one seam call: the message, addressed to the agent it
/// is for, and the board timestamp that call has to beat before anything on the
/// row is about THIS run.
fn start(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    mut sent: Signal<Option<(String, String, u64)>>,
    text: String,
) {
    let Some(app) = web.peek().clone() else { return };
    let target = agent();
    let before = crate::board::read_attrs::since(&web, &target);
    app.handle(
        Request::post_form("/chat", &[("message", text.as_str())])
            .with_header("x-agent", &target),
    );
    sent.set(Some((target, text, before)));
    // Every panel that follows an agent redraws off this.
    let mut tick = tick;
    let n = tick.peek().to_owned();
    tick.set(n + 1);
}

/// WHAT was launched, at WHOM, and where that agent's row stood BEFORE the
/// press (R2-2), SEEDED FROM THE LOG (R8-6) — and RE-SEEDED WHENEVER THE
/// SUBJECT CHANGES (R9-2). Seeded once at mount, switching agent mid-run left
/// `main`'s run in a card headed `RUN A TASK · RESEARCHER` with no composer.
/// A scoped panel shows its own scope; this effect is that rule.
fn watch_last_run(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
) -> Signal<Option<(String, String, u64)>> {
    let mut sent = use_signal(|| None::<(String, String, u64)>);
    use_effect(move || {
        let who = agent();
        let _ = web.read(); // …and again once the core has answered at all
        sent.set(crate::board::launch::receipt::last_run(web, &who));
    });
    sent
}

/// THE BOARD, READ ONCE FOR THIS CARD (R6-6). Read inside `LaunchedRun`, the
/// card around it could not know whether its own run was still going.
///
/// …and WHO ELSE IS WORKING, off the same response's `x-busy` (R9-2). One read,
/// two facts: the header the chrome's run pill already lives on.
fn watch_fleet(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
) -> (Signal<String>, Signal<String>) {
    let mut board = use_signal(String::new);
    let mut busy = use_signal(String::new);
    use_effect(move || {
        let _ = tick();
        if let Some(app) = web.read().clone() {
            let res = app.handle(Request::get("/board"));
            let head = res.headers.iter().find(|(k, _)| k == "x-busy");
            busy.set(head.map(|(_, v)| v.clone()).unwrap_or_default());
            board.set(res.body);
        }
    });
    (board, busy)
}

/// WHAT THIS AGENT CAN DO, off the card's own `data-can` (29): the answer the
/// Agents view's doors are drawn from, so the Dashboard cannot offer a turn the
/// roster says is impossible. Empty while the roster loads — it acts, as it
/// always has, and is offered no examples, the set being chosen by an answer
/// nobody has yet.
fn ability(agents: &str, who: &str) -> String {
    crate::board::read_attrs::cell(agents, who, "data-can").unwrap_or_default()
}

/// Give one agent a task. `agent` is whoever the page has selected — the same
/// subject the rest of this view and the rail already have.
#[component]
pub fn TaskLauncher(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// The `/agents` projection, for the ONE fact that decides whether there is
    /// a task to start at all and which starter tasks finish (R6-1, 29).
    agents: Signal<String>,
    /// So "watch it" is one press and not a hunt through the nav.
    view: Signal<View>,
) -> Element {
    let who = agent();
    let sent = watch_last_run(web, agent);
    let (board, busy) = watch_fleet(web, tick);
    let projection = board.read().clone();
    let running = sent()
        .map(|(target, _, before)| crate::board::read_attrs::live(&projection, &target, before))
        .unwrap_or(false);
    let can = ability(&agents.read(), &who);
    let acts = can != "read";
    let fire = move |text: String| start(web, tick, agent, sent, text);
    rsx! {
        // The TARGET is in the title (F2), and since 30 so is `can`: `Run a
        // task · critic` stood over a body saying there is no task to start.
        Card { title: if acts { format!("Run a task · {who}") } else { format!("Ask {who} · this one takes no tasks") },
            aria_label: "This panel is about {who}",
            RunReceipt { board: projection.clone(), sent: sent(), view, on_retry: fire }
            // NO START CONTROL FOR AN AGENT THAT CANNOT ACT (29), and the reason
            // in words where it would have been. R2-12's precedent: a control
            // that does not apply here is NOT RENDERED, not rendered dead.
            if !running && !acts { {crate::board::examples::no_task(&who, &projection)} }
            if !running && acts {
                TaskForm { who: who.clone(), can, board: projection.clone(), on_launch: fire }
            }
            ElsewhereRun { who: who.clone(), busy: busy.read().clone() }
            WhatPressingStartDoes { who: who.clone(), acts }
        }
    }
}

/// FIRST IN THE CARD, ABOVE THE FOLD, WHERE THE BUTTON WAS (R6-6): the state of
/// the run REPLACES the invitation to start one rather than being patched in
/// underneath it, and everything below is rendered only while there is nothing
/// to replace.
#[component]
fn RunReceipt(
    board: String,
    /// The agent, the task and the board timestamp at the press — `None` until
    /// this agent has been given one.
    sent: Option<(String, String, u64)>,
    view: Signal<View>,
    on_retry: EventHandler<String>,
) -> Element {
    let Some((who, task, baseline)) = sent else {
        return rsx! {};
    };
    rsx! {
        crate::board::launch::outcome::LaunchedRun { board, view, who, task, baseline, on_retry }
    }
}
