//! The companion's chat bubble: the conversation with one engine and a line to write on.
//! A small sibling of `chat.rs`: no prompt, no board, no attachments.
use super::companion::Dismiss;
use super::live::{use_live, use_manifest};
use crate::api::{engine_chat, post_message, ChatTurn};
use dioxus::prelude::*;

/// Chat with `engine`. Esc and the close button call [`Dismiss`] when whoever holds the bubble
/// provided one.
#[component]
pub fn BubbleView(engine: String) -> Element {
    let mut input = use_signal(String::new);
    // The message just sent, shown until the conversation holds it: (text, the turns when sent).
    // The history is folded as it grows, so "holds it" cannot be read from its length.
    let mut pending = use_signal(|| (String::new(), Vec::<ChatTurn>::new()));
    let mut error = use_signal(String::new);
    let (p1, p2, p3) = (engine.clone(), engine.clone(), engine.clone());
    let m = use_manifest();
    let live = use_live(move || m.engine(&p1));
    let turns = use_resource(move || {
        let _ = live();
        engine_chat(p2.clone())
    });
    // Keep the last answer while the next is fetched, so the log never blinks.
    let mut shown = use_signal(Vec::<ChatTurn>::new);
    use_effect(move || {
        if let Some(Ok(t)) = &*turns.read() {
            let arrived = {
                let p = pending.peek();
                !p.0.is_empty() && *t != p.1 && t.iter().rev().take(8).any(|x| x.role == "user" && x.text.contains(p.0.as_str()))
            };
            if arrived {
                pending.set(Default::default());
            }
            if *shown.peek() != *t {
                shown.set(t.clone());
            }
        }
    });
    // Keep the newest message in sight.
    use_effect(move || {
        let _ = (shown.read().len(), pending.read().0.len());
        document::eval("requestAnimationFrame(() => { const b = document.querySelector('.companion-log'); if (b) b.scrollTop = b.scrollHeight; })");
    });
    // The line to write on takes the keyboard when the bubble opens, and again whenever its
    // window comes back to the front.
    use_effect(move || {
        document::eval("const f = () => document.querySelector('.companion-input')?.focus(); f(); window.addEventListener('focus', f);");
    });
    let dismiss = try_use_context::<Dismiss>();
    let send = move |e: FormEvent| {
        e.prevent_default();
        let path = p3.clone();
        async move {
            let text = input().trim().to_string();
            if text.is_empty() {
                return;
            }
            pending.set((text.clone(), shown.peek().clone()));
            input.set(String::new());
            error.set(String::new());
            // Posted to the engine's box: it runs on its own; the live feed brings the reply.
            if let Err(e) = post_message(path, text).await {
                pending.set(Default::default());
                error.set(e.to_string());
            }
        }
    };
    let list: Vec<ChatTurn> = shown.read().iter().filter(|t| t.role != "tool").cloned().collect();
    let sent = pending.read().0.clone();
    let fetch_error = turns.read().as_ref().and_then(|r| r.as_ref().err().map(|e| e.to_string())).unwrap_or_default();
    let problem = if error.read().is_empty() { fetch_error } else { error() };
    rsx! {
        section { class: "companion-panel", role: "dialog", "aria-label": "Chat with {engine}",
            onkeydown: move |e: KeyboardEvent| {
                if e.key() == Key::Escape {
                    if let Some(d) = dismiss {
                        d.0.call(());
                    }
                }
            },
            header { class: "companion-head",
                span { class: "companion-who", "{engine}" }
                if let Some(d) = dismiss {
                    button { class: "companion-close", r#type: "button", "aria-label": "Close", onclick: move |_| d.0.call(()), "×" }
                }
            }
            div { class: "companion-log", "aria-live": "polite",
                for (i, t) in list.iter().enumerate() {
                    p { key: "{i}", class: "companion-turn {t.role}", {t.text.strip_prefix("from user: ").unwrap_or(&t.text)} }
                }
                if !sent.is_empty() {
                    p { class: "companion-turn user pending", "{sent}" }
                }
                if list.is_empty() && sent.is_empty() && problem.is_empty() {
                    p { class: "companion-hint", "Say something to {engine}." }
                }
                if !problem.is_empty() {
                    p { class: "companion-turn problem", role: "alert", "{problem}" }
                }
            }
            form { class: "companion-form", onsubmit: send,
                input { class: "companion-input", r#type: "text", value: "{input}", placeholder: "Message {engine}", "aria-label": "Message {engine}", autofocus: true, autocomplete: "off",
                    oninput: move |e| input.set(e.value()),
                }
                button { class: "companion-send", r#type: "submit", "Send" }
            }
        }
    }
}
