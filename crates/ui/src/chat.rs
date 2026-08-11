//! `ChatPane` — one agent's conversation (plan, "UI shape"; Python
//! counterpart `Engine.messages`). It owns the draft you are typing and
//! nothing else: every message on screen is the core's own projection of the
//! event log (I8), fetched through the seam, so a reload redraws the same
//! conversation from the replayed log.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

/// Poll interval and patience for one turn: 400 ms × 75 = 30 s, the same
/// budget the model broker aborts a request at. Past it the pane says the turn
/// produced nothing rather than spinning forever.
const TICK_MS: i32 = 400;
const TICKS: u32 = 75;

/// Apply one seam response: the transcript is the body, and whether a turn is
/// still running is the `x-turn` header — the UI never parses HTML to find out.
fn show(res: Response, mut log: Signal<String>, mut pending: Signal<bool>) {
    pending.set(res.headers.iter().any(|(k, v)| k == "x-turn" && v == "pending"));
    log.set(res.body);
}

/// Watch one turn to its end: re-project after every tick until the core stops
/// reporting it pending. A turn interrupted by a reload, or an endpoint that
/// accepts the connection and never answers, ends here with a plain sentence.
async fn watch(
    web: Signal<Option<Rc<WebApp>>>,
    log: Signal<String>,
    mut pending: Signal<bool>,
    mut note: Signal<String>,
) {
    for _ in 0..TICKS {
        if sleep(TICK_MS).await.is_err() {
            return;
        }
        let Some(app) = web.peek().clone() else { return };
        show(app.handle(Request::get("/chat")), log, pending);
        if !pending() {
            return;
        }
    }
    pending.set(false);
    note.set(
        "No reply in 30 seconds. The turn was interrupted, or the model endpoint \
         accepted the request and never answered — check Settings."
            .into(),
    );
}

#[component]
pub fn ChatPane(web: Signal<Option<Rc<WebApp>>>) -> Element {
    let log = use_signal(String::new);
    let pending = use_signal(|| false);
    let mut note = use_signal(String::new);

    // The pane's first paint is the projection, not an empty box.
    use_effect(move || {
        if let Some(app) = web.read().clone() {
            show(app.handle(Request::get("/chat")), log, pending);
            if pending() {
                spawn(watch(web, log, pending, note));
            }
        }
    });

    let send = move |text: String| {
        let Some(app) = web.peek().clone() else { return };
        note.set(String::new());
        let req = Request::post_form("/chat", &[("message", &text)]);
        show(app.handle(req), log, pending);
        spawn(watch(web, log, pending, note));
    };

    rsx! {
        section { class: "panel", aria_label: "Chat",
            h2 { "Chat" }
            div { class: "chat-log", dangerous_inner_html: "{log}" }
            if !note.read().is_empty() { p { class: "error", "{note}" } }
            Composer { busy: pending(), on_send: send }
        }
    }
}

/// The composer: a real form, so Enter submits and the button is a submit
/// button — with the default navigation prevented, because the seam is the only
/// transport. That is what stops the message becoming a query string.
#[component]
fn Composer(busy: bool, on_send: EventHandler<String>) -> Element {
    let mut draft = use_signal(String::new);
    let mut submit = move || {
        let text = draft().trim().to_string();
        if text.is_empty() || busy {
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
                aria_label: "Message to the agent",
                placeholder: "Ask the agent something…",
                autocomplete: "off",
                disabled: busy,
                oninput: move |e| draft.set(e.value()),
            }
            button {
                r#type: "submit",
                disabled: busy,
                if busy { "Sending…" } else { "Send" }
            }
        }
    }
}
