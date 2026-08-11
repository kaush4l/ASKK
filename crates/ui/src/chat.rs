//! `ChatPane` — one agent's conversation (plan, "UI shape"; Python
//! counterpart `Engine.messages`). It owns the draft you are typing and
//! nothing else: every message on screen is the core's own projection of the
//! event log (I8), fetched through the seam, so a reload redraws the same
//! conversation from the replayed log.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

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

#[component]
pub fn ChatPane(web: Signal<Option<Rc<WebApp>>>, endpoint_set: Signal<bool>) -> Element {
    let turn = Turn {
        log: use_signal(String::new),
        agent: use_signal(String::new),
        pending: use_signal(|| false),
        note: use_signal(String::new),
        elapsed: use_signal(|| 0),
        stopped: use_signal(|| false),
    };
    let mut note = turn.note;
    let agent = turn.agent;
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

/// The composer: a real form, so Enter submits and the button is a submit
/// button — with the default navigation prevented, because the seam is the only
/// transport. That is what stops the message becoming a query string. With no
/// endpoint configured it does not send: the first-run path is a sentence, not
/// a request that cannot work.
#[component]
fn Composer(busy: bool, ready: bool, agent: String, on_send: EventHandler<String>) -> Element {
    // The field says who it is addressing: two panes with the same accessible
    // name would be indistinguishable to a screen reader.
    let label = match agent.is_empty() {
        true => "Message to the agent".to_string(),
        false => format!("Message to {agent}"),
    };
    let mut draft = use_signal(String::new);
    let mut submit = move || {
        let text = draft().trim().to_string();
        if text.is_empty() || busy || !ready {
            return;
        }
        draft.set(String::new());
        on_send.call(text);
    };
    rsx! {
        form {
            onsubmit: move |e| {
                e.prevent_default();
                submit();
            },
            input {
                r#type: "text",
                value: "{draft}",
                aria_label: "{label}",
                placeholder: if ready { "Ask the agent something…" } else { "Set a model endpoint first" },
                autocomplete: "off",
                disabled: busy || !ready,
                oninput: move |e| draft.set(e.value()),
            }
            button {
                r#type: "submit",
                disabled: busy || !ready,
                if busy { "Sending…" } else { "Send" }
            }
        }
    }
}
