use crate::api::{engine_chat, engine_prompt, run_engine};
use crate::components::Pane;
use dioxus::prelude::*;

/// Chat with an engine (the page's `path` param, else `askk`), beside the prompt it would send
/// now: one colour per section kind, a token bar, each section, and the whole rendered text.
#[component]
pub fn ChatView() -> Element {
    let path = try_use_context::<crate::routes::Params>().and_then(|p| p.0.get("path").cloned()).unwrap_or_else(|| "askk".into());
    let mut input = use_signal(String::new);
    let mut pending = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut full = use_signal(|| false);
    let (p1, p2, p3) = (path.clone(), path.clone(), path.clone());
    let mut turns = use_resource(move || { let p = p1.clone(); async move { engine_chat(p).await } });
    let mut prompt = use_resource(move || { let p = p2.clone(); let i = input(); async move { engine_prompt(p, i).await } });
    use_future(move || {
        let p = p3.clone();
        async move {
            let mut seen = 0;
            while let Ok(now) = crate::api::wait_change(p.clone(), seen).await {
                if now != seen {
                    seen = now;
                    turns.restart();
                    prompt.restart();
                }
            }
        }
    });
    // Keep the newest message in sight.
    use_effect(move || {
        let _ = (turns.read(), pending.read());
        document::eval("requestAnimationFrame(() => { const b = document.querySelector('.bubbles'); if (b) b.scrollTop = b.scrollHeight; })");
    });
    let send = {
        let path = path.clone();
        move |e: FormEvent| {
            e.prevent_default();
            let path = path.clone();
            async move {
                let text = input();
                if text.trim().is_empty() || busy() {
                    return;
                }
                busy.set(true);
                pending.set(text.clone());
                input.set(String::new());
                let r = run_engine(path, text).await;
                pending.set(String::new());
                busy.set(false);
                if let Err(e) = r {
                    pending.set(format!("error: {e}"));
                }
                turns.restart();
                prompt.restart();
            }
        }
    };
    let sections = prompt.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let total: usize = sections.iter().map(|s| crate::core::tokens(&s.body)).sum();
    rsx! {
        div { class: "chat",
            Pane { class: "chat-log",
                div { class: "row", h2 { class: "grow", "{path}" } if busy() { span { class: "badge", "running" } } }
                div { class: "bubbles",
                    match &*turns.read() {
                        Some(Ok(ts)) => rsx! {
                            for t in ts.iter() {
                                div { class: "bubble {t.role}", span { class: "dim", "{t.role}" } pre { "{t.text}" } }
                            }
                        },
                        Some(Err(e)) => rsx! { p { class: "dim", "{e}" } },
                        None => rsx! {},
                    }
                    if !pending.read().is_empty() { div { class: "bubble user pending", pre { "{pending}" } } }
                }
                form { class: "row", onsubmit: send,
                    input { class: "grow", placeholder: "message {path}", value: "{input}", oninput: move |e| input.set(e.value()) }
                    button { class: "btn primary", r#type: "submit", disabled: busy(), "Send" }
                }
            }
            Pane { class: "prompt",
                div { class: "row",
                    h2 { class: "grow", "Prompt" }
                    span { class: "dim", "{sections.len()} sections · ~{total} tokens" }
                    button { class: "btn", onclick: move |_| full.toggle(), if full() { "Sections" } else { "Full text" } }
                }
                div { class: "bar",
                    for s in sections.iter() {
                        span { class: "k-{s.kind}", style: "flex-grow:{crate::core::tokens(&s.body).max(1)}", title: "{s.name}" }
                    }
                }
                div { class: "legend",
                    for s in sections.iter() {
                        span { class: "chip k-{s.kind}", "{s.name} · {crate::core::tokens(&s.body)}" }
                    }
                }
                if full() {
                    pre { class: "rendered",
                        for s in sections.iter() {
                            span { class: "k-{s.kind}", "## {s.name}\n{s.body}\n\n" }
                        }
                    }
                } else {
                    for s in sections.iter() {
                        details { class: "section k-{s.kind}", open: s.kind != "history" && s.kind != "tools",
                            summary { b { "{s.name}" } span { class: "dim", " {s.kind} · ~{crate::core::tokens(&s.body)} tokens" } }
                            pre { "{s.body}" }
                        }
                    }
                }
            }
        }
    }
}
