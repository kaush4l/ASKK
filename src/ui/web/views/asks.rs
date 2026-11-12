use crate::api::{engine_asks, post_message};
use dioxus::prelude::*;

/// One open question for the user, from an engine's `asks.md`.
#[derive(Clone, Debug, PartialEq)]
pub struct Ask {
    pub question: String,
    pub asked_by: String,
}

/// Parse `- question? Asked by: who` lines (the split is on the last ` Asked by: `).
pub fn parse_asks(text: &str) -> Vec<Ask> {
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("- "))
        .map(|rest| match rest.rsplit_once(" Asked by: ") {
            Some((q, by)) => Ask { question: q.trim().into(), asked_by: by.trim().into() },
            None => Ask { question: rest.trim().into(), asked_by: String::new() },
        })
        .filter(|a| !a.question.is_empty())
        .collect()
}

/// The message an answer is sent as: it names the question so the receiver can route it.
pub fn answer_text(question: &str, answer: &str) -> String {
    format!("Answer to: {question}\n{}", answer.trim())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    const CURRENT: &str = "- Which contact details should the footer show (email, GitHub, LinkedIn, other) and the exact values or links? Asked by: user request #41 via askk/developer, to fill the footer config.\n- SPY buy: no order tool exists in the repo and the market was closed. Retry at Mon 2026-11-09 09:30 ET, and which tool or broker path should place the order (add one)? Asked by: askk/developer #54.\n";

    #[test]
    fn parses_the_current_asks() {
        let a = parse_asks(CURRENT);
        assert_eq!(a.len(), 2);
        assert!(a[0].question.starts_with("Which contact details") && a[0].question.ends_with("links?"));
        assert!(a[0].asked_by.starts_with("user request #41"));
        assert!(a[1].question.starts_with("SPY buy") && a[1].question.ends_with("(add one)?"));
        assert_eq!(a[1].asked_by, "askk/developer #54.");
    }

    #[test]
    fn empty_input_has_no_asks() {
        assert!(parse_asks("").is_empty());
        assert!(parse_asks("\n\nnot a list line\n").is_empty());
    }

    #[test]
    fn answer_names_the_question() {
        let t = answer_text("Retry the SPY buy?", " yes ");
        assert_eq!(t, "Answer to: Retry the SPY buy?\nyes");
    }
}
