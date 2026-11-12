//! Sessions: talk to another agent's own loop. Left: start one (which harness, a title, a
//! project folder) and the list. Right: the chosen session's turns and a box to prompt it.
//! The page follows the store: an answer shows when the harness ends, with no polling.
use crate::api::{harnesses, session_open, session_prompt, sessions};
use crate::core::session::{Session, State, USER};
use crate::ui::web::components::Pane;
use dioxus::prelude::*;

#[component]
pub fn SessionsView() -> Element {
    let root = super::live::use_manifest().sessions;
    let live = super::live::use_live(move || root.clone());
    let kinds = use_resource(harnesses);
    let fetched = use_resource(move || {
        let _ = live();
        sessions()
    });
    // Keep the last list while the next is fetched, so the page never blinks.
    let mut all = use_signal(Vec::<Session>::new);
    use_effect(move || {
        if let Some(Ok(a)) = &*fetched.read() {
            all.set(a.clone());
        }
    });
    let mut chosen = use_signal(|| None::<u64>);
    let mut harness = use_signal(String::new);
    let mut title = use_signal(String::new);
    let mut project = use_signal(String::new);
    let mut status = use_signal(String::new);
    let kinds: Vec<_> = kinds.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    // The first kind that can run is offered first.
    let pick = if harness().is_empty() { kinds.iter().find(|k| k.missing.is_empty()).or(kinds.first()).map(|k| k.kind.clone()).unwrap_or_default() } else { harness() };
    let missing = kinds.iter().find(|k| k.kind == pick).map(|k| k.missing.clone()).unwrap_or_default();
    let list = all();
    let current = chosen().or(list.last().map(|s| s.id)).and_then(|id| list.iter().find(|s| s.id == id).cloned());
    let start = {
        let pick = pick.clone();
        move |e: FormEvent| {
            e.prevent_default();
            let pick = pick.clone();
            async move {
                match session_open(pick, title(), project()).await {
                    Ok(s) => {
                        chosen.set(Some(s.id));
                        title.set(String::new());
                        status.set(String::new());
                    }
                    Err(e) => status.set(e.to_string()),
                }
            }
        }
    };
    rsx! {
        div { class: "sessions fill",
            Pane { class: "stack sessions-side",
                form { class: "stack", onsubmit: start,
                    h2 { "New session" }
                    select { "aria-label": "Harness", value: "{pick}", onchange: move |e| harness.set(e.value()),
                        for k in kinds.iter() {
                            option { value: "{k.kind}", selected: k.kind == pick, title: "{k.about}", if k.missing.is_empty() { "{k.kind}" } else { "{k.kind} (unavailable)" } }
                        }
                    }
                    input { placeholder: "Title (optional)", "aria-label": "Title", value: "{title}", oninput: move |e| title.set(e.value()) }
                    input { placeholder: "Project folder (optional)", "aria-label": "Project folder", value: "{project}", oninput: move |e| project.set(e.value()) }
                    if !missing.is_empty() { p { class: "dim", "{missing}" } }
                    button { class: "btn primary", r#type: "submit", disabled: !missing.is_empty() || pick.is_empty(), "Start" }
                    if !status.read().is_empty() { p { class: "chat-error", role: "alert", "{status}" } }
                }
                div { class: "stack session-list", role: "list",
                    if list.is_empty() { p { class: "dim", "No sessions yet." } }
                    for s in list.iter().rev() {
                        button { key: "{s.id}", class: "btn session-item", r#type: "button", role: "listitem",
                            "aria-pressed": "{current.as_ref().is_some_and(|c| c.id == s.id)}",
                            onclick: { let id = s.id; move |_| chosen.set(Some(id)) },
                            span { class: "grow", "{s.title}" }
                            span { class: "dim", if s.state == State::Busy { "{s.harness} · working" } else { "{s.harness}" } }
                        }
                    }
                }
            }
            match current {
                Some(s) => rsx! { Talk { key: "{s.id}", session: s } },
                None => rsx! { Pane { class: "stack", p { class: "dim", "Start a session to talk to an agent." } } },
            }
        }
    }
}

/// One session: what was said, and a box to say more.
#[component]
fn Talk(session: Session) -> Element {
    let mut input = use_signal(String::new);
    let mut error = use_signal(String::new);
    let busy = session.state == State::Busy;
    let id = session.id;
    let turns = session.turns.len();
    // Keep the newest turn in sight.
    use_effect(use_reactive!(|(turns, busy)| {
        let _ = (turns, busy);
        document::eval("requestAnimationFrame(() => { const b = document.querySelector('.session-talk .bubbles'); if (b) b.scrollTop = b.scrollHeight; })");
    }));
    let send = move |e: FormEvent| {
        e.prevent_default();
        async move {
            let text = input();
            if text.trim().is_empty() {
                return;
            }
            match session_prompt(id, text).await {
                Ok(()) => {
                    input.set(String::new());
                    error.set(String::new());
                }
                Err(e) => error.set(e.to_string()),
            }
        }
    };
    rsx! {
        Pane { class: "stack session-talk",
            div { class: "row",
                h2 { "{session.title}" }
                span { class: "grow" }
                span { class: "dim", if session.project.is_empty() { "{session.harness}" } else { "{session.harness} in {session.project}" } }
            }
            div { class: "bubbles",
                if session.turns.is_empty() { p { class: "dim", "Prompt it to begin." } }
                for (i, t) in session.turns.iter().enumerate() {
                    div { key: "{i}", class: if t.who == USER { "bubble user" } else { "bubble model" },
                        span { class: "dim", if t.who == USER { "you" } else { "{session.harness}" } }
                        pre { "{t.text}" }
                    }
                }
                if busy { p { class: "dim", role: "status", "{session.harness} is working…" } }
                if !session.error.is_empty() { p { class: "chat-error", role: "alert", "{session.error}" } }
                if !error.read().is_empty() { p { class: "chat-error", role: "alert", "{error}" } }
            }
            form { class: "row session-composer", onsubmit: send,
                textarea { class: "grow", rows: "2", placeholder: "Prompt {session.harness} (Enter sends, Shift+Enter for a new line)", "aria-label": "Prompt", value: "{input}",
                    oninput: move |e| input.set(e.value()),
                    onkeydown: move |e: KeyboardEvent| {
                        if e.key() == Key::Enter && !e.modifiers().shift() {
                            e.prevent_default();
                            document::eval("document.querySelector('.session-composer')?.requestSubmit()");
                        }
                    },
                }
                button { class: "btn primary", r#type: "submit", disabled: busy, "Send" }
            }
        }
    }
}
