use crate::api::{engine_asks, post_message};
use crate::ui::features::asks::{answer_text, parse_asks, Ask};
use dioxus::prelude::*;

/// The engine's open questions (the page's `path` param, else the top engine): one big glass
/// card per question with an answer box; submitting posts the answer to that engine.
#[component]
pub fn AsksView() -> Element {
    let path = try_use_context::<crate::core::routes::Params>().and_then(|p| p.0.get("path").cloned()).unwrap_or_default();
    let m = super::live::use_manifest();
    let (p1, p2) = (path.clone(), path.clone());
    // Live on the engine shown (its asks file is one of its keys); no path = any engine.
    let live = super::live::use_live(move || if p1.is_empty() { m.engines.clone() } else { m.engine(&p1) });
    let asks = use_resource(move || {
        let _ = live();
        engine_asks(p2.clone())
    });
    rsx! {
        div { class: "asks fill",
            match &*asks.read() {
                Some(Ok((engine, text))) => {
                    let items = parse_asks(text);
                    rsx! {
                        if items.is_empty() { p { class: "dim", "No open questions." } }
                        for a in items {
                            AskCard { key: "{a.question}", engine: engine.clone(), ask: a }
                        }
                    }
                }
                Some(Err(e)) => rsx! { p { class: "dim", "{e}" } },
                None => rsx! {},
            }
        }
    }
}

#[component]
fn AskCard(engine: String, ask: Ask) -> Element {
    let mut answer = use_signal(String::new);
    let mut status = use_signal(String::new);
    let q = ask.question.clone();
    rsx! {
        form { class: "ask-card glass",
            onsubmit: move |e: FormEvent| {
                e.prevent_default();
                let (engine, q) = (engine.clone(), q.clone());
                async move {
                    let a = answer();
                    if a.trim().is_empty() {
                        return;
                    }
                    match post_message(engine, answer_text(&q, &a)).await {
                        Ok(_) => {
                            answer.set(String::new());
                            status.set("Sent".into());
                        }
                        Err(e) => status.set(format!("error: {e}")),
                    }
                }
            },
            h2 { class: "ask-q", "{ask.question}" }
            if !ask.asked_by.is_empty() { span { class: "dim", "Asked by {ask.asked_by}" } }
            textarea { class: "ask-answer", rows: "4", placeholder: "Your answer", value: "{answer}", oninput: move |e| answer.set(e.value()) }
            div { class: "row",
                button { class: "btn primary", r#type: "submit", "Send" }
                span { class: "dim", "{status}" }
            }
        }
    }
}
