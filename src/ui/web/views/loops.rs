//! Loop cards: one run of an engine, tiny and in full.
//!
//! [`RunCard`] is the tiny card: a status dot, one pip per stage of the loop (filled as the
//! run passes through them) and one line — where it is now, or how it ended and how long it
//! took. Opening it shows [`RunPanel`]: every step, every stage in order with its time, what
//! the stage is for, what it did, and the texts it kept (the prompt as sent, the reply as
//! received, each call with its result), so one loop can be read and tuned.
use crate::api::{engine_run, engine_runs};
use crate::core::flow::{about, name, Stage};
use crate::core::run::{took, Run, Step};
use crate::ui::web::components::Icon;
use dioxus::prelude::*;

/// The colour family of a run's status.
pub fn tone(status: &str) -> &'static str {
    match status {
        "running" => "busy",
        "done" => "ok",
        "error" => "error",
        _ => "warn",
    }
}

/// Each stage of a step as the pips show it: `done`, `now` (the run is in it) or `off` (not entered).
pub fn pips(step: Option<&Step>, running: bool) -> Vec<(Stage, &'static str)> {
    Stage::STEP
        .iter()
        .map(|s| {
            let at = step.and_then(|st| st.marks.iter().position(|m| m.stage == *s));
            let last = step.map_or(0, |st| st.marks.len().saturating_sub(1));
            (*s, match at {
                Some(i) if running && i == last => "now",
                Some(_) => "done",
                None => "off",
            })
        })
        .collect()
}

/// The stage a run is in, as written.
fn stage_now(run: &Run) -> &'static str {
    run.stage().map(name).unwrap_or("starting")
}

/// The card's one line.
pub fn line(run: &Run) -> String {
    let n = run.steps.len();
    if run.running() {
        let stage = run.stage().map(name).unwrap_or("starting");
        format!("step {} · {stage} · {}", n.max(1), took(run.ms))
    } else {
        format!("{} · {n} step{} · {}", run.status, if n == 1 { "" } else { "s" }, took(run.ms))
    }
}

/// The tiny card. `run` is an outline (no long texts); opening it fetches the run in full.
#[component]
pub fn RunCard(path: String, run: Run) -> Element {
    let mut open = use_signal(|| false);
    let t = tone(&run.status);
    let p = pips(run.steps.last(), run.running());
    rsx! {
        button { class: "run-card st-{t}", r#type: "button", title: "Open this run step by step", "aria-label": "Run: {line(&run)}", onclick: move |_| open.set(true),
            span { class: "run-dot", "aria-hidden": "true" }
            span { class: "run-pips", "aria-hidden": "true",
                for (s, state) in p { i { class: "pip {state}", title: "{name(s)}" } }
            }
            span { class: "run-line",
                if run.running() {
                    "step {run.steps.len().max(1)} · {stage_now(&run)} · "
                    Elapsed { since: run.id }
                } else {
                    "{line(&run)}"
                }
            }
        }
        if open() {
            RunPanel { path: path.clone(), id: run.id, on_close: move |_| open.set(false) }
        }
    }
}

/// Time since `since` (unix ms), counted in the browser once a second.
#[component]
fn Elapsed(since: u64) -> Element {
    let mut now = use_signal(|| since);
    use_future(move || async move {
        loop {
            match document::eval("await new Promise(r => setTimeout(r, 1000)); return Date.now();").await {
                Ok(v) => now.set(v.as_f64().unwrap_or(0.0) as u64),
                Err(_) => break,
            }
        }
    });
    rsx! { "{took(now().saturating_sub(since))}" }
}

/// The engines at work right now, kept fresh by the live feed.
fn use_busy() -> Vec<crate::api::Busy> {
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engines.clone());
    let now = use_resource(move || {
        let _ = live();
        crate::api::busy()
    });
    let list = now.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    list
}

/// The paths of the engines at work, as one line.
fn names(list: &[crate::api::Busy]) -> String {
    list.iter().map(|b| b.path.as_str()).collect::<Vec<_>>().join(", ")
}

/// What an engine at work is doing, in a few words.
pub fn doing(b: &crate::api::Busy) -> String {
    if b.detail.is_empty() { b.activity.clone() } else { format!("{} · {}", b.activity, b.detail) }
}

/// What is running, said in one small chip: nothing when nothing runs, the engine and what it
/// is doing when one does (it opens that engine), a count when several do (it opens Home,
/// where each is listed).
#[component]
pub fn NowChip() -> Element {
    let list = use_busy();
    match list.as_slice() {
        [] => rsx! {},
        [b] => rsx! {
            Link { class: "now-chip", to: format!("/e/{}", b.path), title: "{b.path} is running: {doing(b)}. Open it.",
                span { class: "run-dot", "aria-hidden": "true" }
                b { "{b.name}" }
                span { class: "now-doing", "{doing(b)}" }
            }
        },
        many => rsx! {
            Link { class: "now-chip", to: "/", title: "Running: {names(many)}",
                span { class: "run-dot", "aria-hidden": "true" }
                b { "{many.len()} running" }
            }
        },
    }
}

/// What is running, in full: each engine at work with what it is doing and the tiny card of
/// its run (open it to follow the loop step by step). Says so when nothing runs.
#[component]
pub fn NowStrip() -> Element {
    let list = use_busy();
    rsx! {
        section { class: "now-strip", "aria-label": "Running now",
            h2 { "Now" }
            if list.is_empty() { p { class: "dim", "Nothing is running. Every engine is waiting for a message or an alert." } }
            for b in list {
                div { class: "now-row", key: "{b.path}",
                    span { class: "now-icon", "aria-hidden": "true", if b.icon.is_empty() { "⚙" } else { "{b.icon}" } }
                    Link { class: "now-name", to: format!("/e/{}", b.path), "{b.path}" }
                    span { class: "now-doing", "{doing(&b)}" }
                    if let Some(r) = b.run.clone() { RunCard { key: "{r.id}", path: b.path.clone(), run: r } }
                }
            }
        }
    }
}

/// The last runs of an engine as a row of tiny cards, newest first.
#[component]
pub fn RunStrip(path: ReadSignal<String>) -> Element {
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&path()));
    let runs = use_resource(move || {
        let _ = live();
        engine_runs(path())
    });
    let list = runs.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    rsx! {
        div { class: "run-strip", role: "group", "aria-label": "Last runs",
            if list.is_empty() { span { class: "dim", "No runs yet" } }
            for r in list.into_iter().rev() {
                RunCard { key: "{r.id}", path: path(), run: r }
            }
        }
    }
}

/// One run in full, in a side panel; live while the run is going.
#[component]
pub fn RunPanel(path: String, id: u64, on_close: EventHandler<()>) -> Element {
    let m = super::live::use_manifest();
    let key = m.engine(&path);
    let live = super::live::use_live(move || key.clone());
    let p = path.clone();
    let run = use_resource(move || {
        let _ = live();
        engine_run(p.clone(), id)
    });
    // A modal dialog sits above the whole page, whatever holds the card that opened it.
    use_effect(move || {
        document::eval(&format!("document.getElementById('run-{id}')?.showModal?.()"));
    });
    rsx! {
        dialog { id: "run-{id}", class: "run-panel", "aria-label": "Run of {path}",
            onkeydown: move |e| { if e.key() == Key::Escape { e.prevent_default(); on_close.call(()); } },
            div { class: "row side-panel-head",
                b { class: "grow mono", "{path}" }
                button { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: move |_| on_close.call(()), Icon { name: "close", size: 18 } }
            }
            div { class: "side-panel-body run-body",
                match &*run.read() {
                    Some(Ok(r)) => rsx! { RunSteps { run: r.clone() } },
                    Some(Err(e)) => rsx! { p { class: "dim", "{e}" } },
                    None => rsx! { p { class: "dim", "Loading…" } },
                }
            }
        }
    }
}

#[component]
fn RunSteps(run: Run) -> Element {
    let t = tone(&run.status);
    rsx! {
        div { class: "row run-head",
            span { class: "badge st-{t} run-status", "{run.status}" }
            span { class: "dim", "{run.steps.len()} step(s) · {took(run.ms)}" }
            if !run.model.is_empty() { span { class: "dim mono", "{run.model}" } }
        }
        details { class: "run-text",
            summary { b { "Input" } span { class: "dim", " what started the run" } }
            pre { "{run.input}" }
        }
        for step in run.steps.iter() {
            section { class: "run-step",
                div { class: "row",
                    h3 { class: "grow", "Step {step.n}" }
                    span { class: "dim", "{took(step.ms())}" }
                }
                // Where the time went: one segment per stage, as wide as its share.
                div { class: "run-bar", role: "img", "aria-label": "Time per stage",
                    for mk in step.marks.iter() {
                        span { class: "stage-{name(mk.stage)}", style: "flex-grow:{mk.ms.max(1)}", title: "{name(mk.stage)} · {took(mk.ms)}" }
                    }
                }
                ol { class: "run-stages",
                    for mk in step.marks.iter() {
                        li { class: "run-stage stage-{name(mk.stage)}",
                            div { class: "row run-stage-head",
                                span { class: "run-stage-name", "{name(mk.stage)}" }
                                span { class: "grow run-stage-note", "{mk.note}" }
                                span { class: "dim mono", if mk.ms == 0 { "…" } else { "{took(mk.ms)}" } }
                            }
                            p { class: "run-about", "{about(mk.stage)}" }
                            for (label, text) in mk.detail.iter() {
                                details { class: "run-text",
                                    summary { b { "{label}" } span { class: "dim", " {crate::ui::web::views::prompt::kilo(crate::core::tokens(text))} tokens" } }
                                    pre { "{text}" }
                                }
                            }
                        }
                    }
                }
            }
        }
        if !run.answer.is_empty() {
            section { class: "run-step",
                h3 { if run.status == "error" { "Error" } else { "Answer" } }
                pre { class: "run-answer", "{run.answer}" }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tiny_card_says_where_a_run_is_and_how_it_ended() {
        let mut r = Run::new(1, "hi", "");
        assert_eq!(line(&r), "step 1 · starting · 0ms");
        r.step(1);
        r.enter(Stage::Prompt, 0);
        r.enter(Stage::Think, 20);
        r.ms = 4200;
        assert_eq!(line(&r), "step 1 · think · 4.2s");
        let p = pips(r.steps.last(), true);
        assert_eq!(p.iter().map(|(_, s)| *s).collect::<Vec<_>>(), ["off", "done", "off", "off", "now", "off", "off", "off"], "refresh was not entered, prompt is done, the model is being asked");
        r.close(4000);
        r.status = "done".into();
        assert_eq!(line(&r), "done · 1 step · 4.2s");
        assert!(pips(r.steps.last(), false).iter().all(|(_, s)| *s != "now"));
        assert_eq!([tone("running"), tone("done"), tone("error"), tone("out of steps")], ["busy", "ok", "error", "warn"]);
    }
}
