//! A run, drawn: what one run of an engine's loop did.
//!
//! [`RunView`] is given a [`Run`] and draws it as one line that opens: closed, it says where the
//! run is or how it ended; open, it lists every stage ([`StageRow`]) with, under the stage
//! that acts, each tool call ([`CallRow`]): the program and what came back.
//!
//! Nothing here asks for anything. A run given without its long texts (an outline) is drawn
//! as far as it goes; `on_open` tells the view the run was opened, and the view may then hand
//! the same run in full. What the lines say comes from `ui/features/run.rs`.
use super::Icon;
use crate::core::run::{took, Mark, Run};
use crate::ui::features::run::{self as words, Call};
use crate::ui::web::kit::{Collapsible, CollapsibleContent, CollapsibleTrigger};
use dioxus::prelude::*;

/// One run as a line that opens into its stages. `asked`: what started it, shown beside the
/// line where the question is not already above it (a list of runs).
#[component]
pub fn RunView(run: Run, #[props(default)] asked: String, #[props(optional)] on_open: Option<EventHandler<bool>>) -> Element {
    let tone = words::tone(&run.status).name();
    let running = run.running();
    let many = run.steps.len() > 1;
    // Open while it runs, so the stages are seen as they happen, and closed once it has ended,
    // so the answer is what is read; unless the person chose otherwise.
    let mut chosen = use_signal(|| None::<bool>);
    rsx! {
        Collapsible { class: "work tone-{tone}", open: chosen().unwrap_or(running),
            CollapsibleTrigger { class: "work-head",
                ontoggle: move |open| {
                    chosen.set(Some(open));
                    if let Some(h) = &on_open {
                        h.call(open);
                    }
                },
                span { class: "work-mark", "aria-hidden": "true" }
                span { class: if running { "work-words shimmer" } else { "work-words" }, "{words::headline(&run)}" }
                if running { span { class: "work-time", Elapsed { since: run.id } } }
                if !asked.is_empty() { span { class: "work-asked", "{asked}" } }
                span { class: "chev", "aria-hidden": "true", Icon { name: "chevron", size: 14 } }
            }
            CollapsibleContent { class: "work-body",
                ol { class: "stages",
                    for step in run.steps.iter() {
                        if many { li { class: "stage-step", "aria-hidden": "true", "step {step.n}" } }
                        for (i, mark) in step.marks.iter().enumerate() {
                            StageRow { key: "{step.n}-{i}", mark: mark.clone(), open: running && mark.ms == 0 }
                        }
                    }
                }
                if run.status == "error" && !run.answer.is_empty() {
                    p { class: "work-error", role: "alert", "{run.answer}" }
                }
            }
        }
    }
}

/// One stage of a step: its name, the one line on what it did, how long it took. It opens to
/// what the stage is for and the texts it kept. A stage that called tools lists the calls
/// under it, in sight without opening anything.
#[component]
pub fn StageRow(mark: Mark, #[props(default)] open: bool) -> Element {
    let (name, note, time) = words::stage_head(&mark);
    let calls = words::calls(&mark);
    let kept = words::kept(&mark);
    rsx! {
        li { class: if open { "stage stage-{name} now" } else { "stage stage-{name}" },
            Collapsible {
                CollapsibleTrigger { class: "stage-head",
                    span { class: "stage-name", "{name}" }
                    span { class: "stage-note", "{note}" }
                    span { class: "stage-time", "{time}" }
                    span { class: "chev", "aria-hidden": "true", Icon { name: "chevron", size: 12 } }
                }
                CollapsibleContent { class: "stage-body",
                    p { class: "stage-about", "{words::stage_about(&mark)}" }
                    for (i, (label, text, tokens)) in kept.into_iter().enumerate() {
                        Kept { key: "{i}", label, text, tokens }
                    }
                }
            }
            for (i, call) in calls.into_iter().enumerate() {
                CallRow { key: "{i}", call }
            }
        }
    }
}

/// One tool call: the tool and a glance at what came back; it opens to the program as it was
/// written and the result in full.
#[component]
pub fn CallRow(call: Call) -> Element {
    rsx! {
        Collapsible { class: if call.failed { "toolcall failed" } else { "toolcall" },
            CollapsibleTrigger { class: "toolcall-head",
                Icon { name: "terminal", size: 14 }
                code { class: "toolcall-name", "{call.tool}" }
                span { class: "toolcall-glance", "→ {call.glance(120)}" }
                span { class: "chev", "aria-hidden": "true", Icon { name: "chevron", size: 12 } }
            }
            CollapsibleContent { class: "toolcall-body",
                span { class: "toolcall-label", "program" }
                pre { class: "code", "{call.written()}" }
                span { class: "toolcall-label", "result" }
                pre { class: if call.failed { "code bad" } else { "code" }, "{call.result}" }
            }
        }
    }
}

/// A text a stage kept (the prompt as sent, the reply as received), behind its label.
#[component]
fn Kept(label: String, text: String, tokens: usize) -> Element {
    rsx! {
        Collapsible { class: "kept",
            CollapsibleTrigger { class: "kept-head",
                span { class: "chev", "aria-hidden": "true", Icon { name: "chevron", size: 12 } }
                b { "{label}" }
                span { class: "kept-size", "~{tokens} tokens" }
            }
            CollapsibleContent { pre { class: "code", "{text}" } }
        }
    }
}

/// Time since `since` (unix milliseconds), counted in the window once a second.
#[component]
pub fn Elapsed(since: u64) -> Element {
    let mut now = use_signal(|| since);
    use_future(move || async move {
        // At once the first time, then once a second.
        let mut wait = 0;
        loop {
            match document::eval(&format!("await new Promise(r => setTimeout(r, {wait})); return Date.now();")).await {
                Ok(v) => now.set(v.as_f64().unwrap_or(0.0) as u64),
                Err(_) => break,
            }
            wait = 1000;
        }
    });
    rsx! { "{took(now().saturating_sub(since))}" }
}
