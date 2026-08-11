//! `ChatPane` — one agent's conversation (plan, "UI shape"; Python
//! counterpart `Engine.messages`). It owns the draft you are typing and
//! nothing else: every message on screen is the core's own projection of the
//! event log (I8), fetched through the seam, so a reload redraws the same
//! conversation from the replayed log.
//!
//! The heading and the transcript are two halves of ONE read (`turn::Shown`):
//! the pane renders a conversation only while the value it holds is the
//! selected agent's own. Nothing it can be handed makes it possible to show
//! one agent's conversation under another agent's name.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::composer::Composer;
use crate::turn::{show, to, waiting_row, watch, Shown, Turn};

/// What the next turn ACTUALLY calls — read from the broker, not from the
/// agent file. The agent's `model:` key is a default that Settings overrides,
/// and printing the key while calling something else is a lie the pane told
/// for a whole increment (`ux-walker`, increment 04).
/// Read by the SHELL, not by this pane: from 12d the sentence is typeset into
/// the header strip — the 77px that held two words — and said once.
pub(crate) fn endpoint_line(web: Signal<Option<Rc<WebApp>>>) -> String {
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
    /// The roster's fingerprint (`main::shell`). Read by the effect below, so
    /// an agent swapped under this pane re-projects the conversation — the
    /// header is part of the projection, and it was the last thing on screen
    /// still naming the shipped description after an override installed (11b
    /// walk). It changes only when an agent's identity does, so this cannot
    /// loop against `tick`.
    roster: ReadSignal<String>,
    /// WHICH agent this pane is the conversation with. A `ReadSignal` so
    /// switching agents re-projects: the same component, one instance per
    /// agent, never a mode flag (plan: `ChatPane` owns one conversation).
    agent: ReadSignal<String>,
    /// Routed away: the primary column is showing the deck instead. The pane
    /// stays MOUNTED — its poller belongs to a turn in flight and killing it
    /// would leave the turn unwatched — so the region is hidden, not dropped.
    hidden: bool,
) -> Element {
    let turn = Turn {
        shown: use_signal(Shown::default),
        note: use_signal(String::new),
        elapsed: use_signal(|| 0),
        stopped: use_signal(|| false),
        tick,
    };
    let mut note = turn.note;
    // From the PROP, not from the last response: the heading must name the
    // agent you just switched to before its transcript has arrived, or the
    // page briefly says you are talking to the previous one.
    let title = match agent().is_empty() {
        true => "Chat — no agent loaded".to_string(),
        false => format!("Chat with {}", agent()),
    };
    // The ONE read the body comes from — and only while it is this agent's.
    let shown = turn.shown.read().clone();
    let mine = shown.who == agent();
    // In flight FOR THIS AGENT. Another agent's turn runs in another Worker and
    // must not lock this composer: a global lock made the page contradict the
    // board three inches below it (`ux-walker`, increment 07).
    let busy = mine && shown.pending;

    // The pane's first paint is the projection, not an empty box.
    use_effect(move || {
        let (who, _) = (agent(), roster());
        if let Some(app) = web.read().clone() {
            note.set(String::new());
            show(&who, app.handle(to(&who, Request::get("/chat"))), turn);
            if turn.shown.peek().pending {
                spawn(watch(web, turn, agent, who));
            }
        }
    });

    let send = move |text: String| {
        let Some(app) = web.peek().clone() else { return };
        let who = agent.peek().clone();
        note.set(String::new());
        let req = to(&who, Request::post_form("/chat", &[("message", &text)]));
        show(&who, app.handle(req), turn);
        spawn(watch(web, turn, agent, who));
    };

    rsx! {
        section {
            class: "panel",
            // The tabpanel half of the ARIA tabs pattern (increment 08): the
            // strip's `aria-controls` points here, and the panel is named by
            // the tab that selected it rather than by a duplicate label.
            id: "chat-panel",
            role: "tabpanel",
            aria_labelledby: "tab-{agent}",
            aria_label: "{title}",
            hidden,
            h2 { "{title}" }
            if !endpoint_set() {
                p { class: "pending",
                    "No model endpoint yet. Add one in Settings below — a local \
                     OpenAI-compatible server, or a provider's base URL and API key — \
                     and {agent} can answer."
                }
            }
            // What the next turn actually calls used to be a paragraph here.
            // It is the same sentence, unchanged, typeset into the header strip
            // (12c walk: "move it") — no duplication, nothing cut, and the most
            // valuable strip on a console stops holding two words.
            if mine {
                // The id is the scroll target: from 12c the conversation is
                // the child that grows inside a full-height column, so the
                // newest message is below its own fold unless something moves
                // it — the terminal's problem, and the terminal's fix.
                div { id: "chat-scroll", class: "chat-log", dangerous_inner_html: "{shown.html}" }
            } else {
                p { class: "pending", "opening {agent}'s conversation…" }
            }
            {waiting_row(web, turn, busy, agent())}
            if !note.read().is_empty() { p { class: "error", "{note}" } }
            Composer {
                busy,
                ready: endpoint_set(),
                agent: agent(),
                on_send: send,
            }
        }
    }
}
