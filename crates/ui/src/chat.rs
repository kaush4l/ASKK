//! `ChatPane` — one agent's conversation (plan, "UI shape"; Python
//! counterpart `Engine.messages`). It owns the draft you are typing and
//! nothing else: every message on screen is the core's own projection of the
//! event log (I8), fetched through the seam, so a reload redraws the same
//! conversation from the replayed log.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

use crate::composer::Composer;

/// Poll interval and patience for one turn: 400 ms × 90 = 36 s, a little past
/// the 30 s the model broker aborts a request at, so the broker's own typed
/// error is what the user normally sees.
const TICK_MS: i32 = 400;
const TICKS: u32 = 90;

/// The signals one turn moves. Grouped so `watch` takes a turn, not six
/// arguments; `Signal` is `Copy`, so this is free.
#[derive(Clone, Copy)]
struct Turn {
    log: Signal<String>,
    /// Which agent this pane is talking to, from the seam's `x-agent` header.
    /// The INTERFACE owns this fact — before, the only cue was the agent's
    /// own editable description line (`ux-walker`, increment 03).
    agent: Signal<String>,
    pending: Signal<bool>,
    note: Signal<String>,
    elapsed: Signal<u32>,
    stopped: Signal<bool>,
    /// Bumped on every projection so the tool trace follows the turn live.
    tick: Signal<u32>,
}

/// Apply one seam response: the transcript is the body, and whether a turn is
/// still running is the `x-turn` header — the UI never parses HTML to find out.
fn show(res: Response, mut turn: Turn) {
    let header = |name: &str| {
        res.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    turn.pending
        .set(header("x-turn").as_deref() == Some("pending"));
    turn.agent.set(header("x-agent").unwrap_or_default());
    turn.log.set(res.body);
    let n = turn.tick.peek().to_owned();
    turn.tick.set(n + 1);
}

/// Watch one turn to its end: re-project after every tick until the core stops
/// reporting it pending, the user stops waiting, or patience runs out. Every
/// tick also publishes how long it has been — a wait with no clock on it is
/// indistinguishable from a hang.
async fn watch(web: Signal<Option<Rc<WebApp>>>, mut turn: Turn) {
    turn.stopped.set(false);
    turn.elapsed.set(0);
    for tick in 1..=TICKS {
        if sleep(TICK_MS).await.is_err() {
            return;
        }
        if turn.stopped.peek().to_owned() {
            turn.pending.set(false);
            turn.note.set(
                "Stopped waiting. The request may still be in flight — a reply that \
                 arrives is in the log, and a reload will show it."
                    .into(),
            );
            return;
        }
        turn.elapsed.set(tick * TICK_MS as u32 / 1000);
        let Some(app) = web.peek().clone() else { return };
        show(app.handle(Request::get("/chat")), turn);
        if !turn.pending.peek().to_owned() {
            return;
        }
    }
    turn.pending.set(false);
    turn.note.set(
        "No reply in 36 seconds. The turn was interrupted, or the model endpoint \
         accepted the request and never answered — check Settings."
            .into(),
    );
}

/// While a turn is in flight: how long it has been, and the way out. A wait
/// with no clock and no exit is indistinguishable from a hang.
fn waiting_row(turn: Turn) -> Element {
    let mut stopped = turn.stopped;
    rsx! {
        if turn.pending.cloned() {
            p { class: "pending",
                "waiting for the model — {turn.elapsed}s "
                button { r#type: "button", onclick: move |_| stopped.set(true), "Stop waiting" }
            }
        }
    }
}

/// What the next turn ACTUALLY calls — read from the broker, not from the
/// agent file. The agent's `model:` key is a default that Settings overrides,
/// and printing the key while calling something else is a lie the pane told
/// for a whole increment (`ux-walker`, increment 04).
fn endpoint_line(web: Signal<Option<Rc<WebApp>>>) -> String {
    let Some(app) = web.read().clone() else {
        return String::new();
    };
    let (url, has_key, model, _) = app.endpoint_summary();
    if url.is_empty() {
        return "No endpoint yet — this turn cannot be sent.".into();
    }
    let entry = app.current_entry();
    let key = match has_key {
        true => "with the key saved for it",
        false => "with no key",
    };
    match app.entry_problem(&entry) {
        Some(detail) => format!("This build cannot call {entry}: {detail}"),
        None => format!("This turn calls {entry} — {model} at {url}, {key}."),
    }
}

#[component]
pub fn ChatPane(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
) -> Element {
    let turn = Turn {
        log: use_signal(String::new),
        agent: use_signal(String::new),
        pending: use_signal(|| false),
        note: use_signal(String::new),
        elapsed: use_signal(|| 0),
        stopped: use_signal(|| false),
        tick,
    };
    let mut note = turn.note;
    let agent = turn.agent;
    // Reading `tick` subscribes this pane to every settings change, so the
    // endpoint line below is recomputed the moment the endpoint moves.
    let endpoint = {
        let _ = tick();
        endpoint_line(web)
    };
    let title = match agent.read().is_empty() {
        true => "Chat — no agent loaded".to_string(),
        false => format!("Chat with {}", agent.read()),
    };

    // The pane's first paint is the projection, not an empty box.
    use_effect(move || {
        if let Some(app) = web.read().clone() {
            show(app.handle(Request::get("/chat")), turn);
            if turn.pending.peek().to_owned() {
                spawn(watch(web, turn));
            }
        }
    });

    let send = move |text: String| {
        let Some(app) = web.peek().clone() else { return };
        note.set(String::new());
        show(app.handle(Request::post_form("/chat", &[("message", &text)])), turn);
        spawn(watch(web, turn));
    };

    rsx! {
        section { class: "panel", aria_label: "{title}",
            h2 { "{title}" }
            if !endpoint_set() {
                p { class: "pending",
                    "No model endpoint yet. Add one in Settings below — a local \
                     OpenAI-compatible server, or a provider's base URL and API key — \
                     and this agent can answer."
                }
            }
            if !endpoint.is_empty() { p { class: "note", "{endpoint}" } }
            div { class: "chat-log", dangerous_inner_html: "{turn.log}" }
            {waiting_row(turn)}
            if !note.read().is_empty() { p { class: "error", "{note}" } }
            Composer {
                busy: turn.pending.cloned(),
                ready: endpoint_set(),
                agent: agent(),
                on_send: send,
            }
        }
    }
}

