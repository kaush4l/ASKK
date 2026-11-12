//! A conversation, drawn: the thread and each turn in it.
//!
//! A turn is one exchange ([`Beat`]): what was asked (with what was attached), the run that
//! answered it, what it drew, what it said. [`Thread`] is the list of turns in one column that
//! scrolls inside itself. Both are given everything they show.
use super::{Icon, MediaChip, Prose, RunView};
use crate::api::Beat;
use crate::core::run::Run;
use crate::core::session::{Turn, USER};
use crate::ui::features::run as words;
use crate::ui::web::figure::FigureView;
use crate::ui::web::kit::{ScrollArea, Separator, Skeleton};
use dioxus::prelude::*;
use std::collections::BTreeMap;

/// The conversation: every turn, oldest first, then the message that was just sent and is not
/// yet part of it (`pending`).
///
/// `runs`: the runs the view holds in full, by id; a turn's run is drawn from there when it is,
/// else as the outline the turn carries. `pictures`: attachment id → picture, as far as the
/// view has them. `writing`: the answer being written now, as far as it has come, with the id
/// of the run writing it. `on_open` says a run was opened (`true`) or closed, by id.
#[component]
pub fn Thread(
    beats: Vec<Beat>,
    #[props(default)] runs: BTreeMap<u64, Run>,
    #[props(default)] pictures: BTreeMap<String, String>,
    #[props(default)] pending: String,
    #[props(default)] writing: Option<(u64, String)>,
    /// True while the first answer has not arrived: the shape of a conversation is shown.
    #[props(default)] loading: bool,
    on_open: EventHandler<(u64, bool)>,
    /// "Edit from here" on what was asked: the turn's number among the askings. Left out: none.
    #[props(optional)] on_edit: Option<EventHandler<usize>>,
    /// "Cite in composer" on what was said: the words chosen in it, or all of it.
    #[props(optional)] on_cite: Option<EventHandler<String>>,
) -> Element {
    // Each turn's number among the askings (a summary is none, nor is the empty turn a fold leaves).
    let mut n = 0usize;
    let asking: Vec<Option<usize>> = beats.iter().map(|b| if b.from == "summary" || (b.text.is_empty() && b.media.is_empty()) { None } else { n += 1; Some(n - 1) }).collect();
    rsx! {
        ScrollArea { id: "thread", class: "thread", aria_label: "Conversation", fade: true,
            div { class: "lane thread-lane", "aria-live": "polite",
                if loading {
                    Skeleton { class: "sk-ask" }
                    Skeleton { class: "sk-say" }
                } else if beats.is_empty() && pending.is_empty() {
                    p { class: "thread-empty", "Say something to begin." }
                }
                for (i, b) in beats.into_iter().enumerate() {
                    TurnView { key: "{i}", index: i, full: b.run.as_ref().and_then(|r| runs.get(&r.id).cloned()), pictures: pictures.clone(),
                        writing: writing.as_ref().filter(|(run, _)| b.run.as_ref().is_some_and(|r| r.id == *run && r.running())).map(|(_, t)| t.clone()).unwrap_or_default(),
                        turn: b, on_open,
                        on_edit: match (on_edit, asking[i]) { (Some(h), Some(k)) => Some(EventHandler::new(move |_: ()| h.call(k))), _ => None },
                        on_cite }
                }
                if !pending.is_empty() {
                    article { class: "turn",
                        div { class: "ask pending", p { class: "ask-text", "{pending}" } }
                        p { class: "sending shimmer", role: "status", "Sending…" }
                    }
                }
            }
        }
    }
}

/// One turn. `full`: the turn's run with its long texts, when the view has it. `writing`: the
/// answer its run is writing now, as far as it has come.
#[component]
pub fn TurnView(
    turn: Beat,
    #[props(default)] index: usize,
    #[props(default)] full: Option<Run>,
    #[props(default)] pictures: BTreeMap<String, String>,
    #[props(default)] writing: String,
    on_open: EventHandler<(u64, bool)>,
    #[props(optional)] on_edit: Option<EventHandler<()>>,
    #[props(optional)] on_cite: Option<EventHandler<String>>,
) -> Element {
    let run = full.or(turn.run.clone());
    rsx! {
        article { class: "turn",
            if turn.from == "summary" {
                div { class: "turn-summary",
                    div { class: "turn-rule", Separator {} span { "earlier, in short" } Separator {} }
                    Prose { class: "say-text", text: turn.text.clone() }
                }
            } else if !turn.text.is_empty() || !turn.media.is_empty() {
                div { class: "ask",
                    if turn.from != "user" { span { class: "ask-who", "{words::who(&turn.from)}" } }
                    if !turn.media.is_empty() {
                        div { class: "media-row",
                            for c in turn.media.iter() {
                                MediaChip { key: "{c.id}", picture: pictures.get(&c.id).cloned().unwrap_or_default(), chip: c.clone() }
                            }
                        }
                    }
                    if !turn.text.is_empty() { p { class: "ask-text", "{turn.text}" } }
                    if let Some(edit) = on_edit {
                        button { class: "turn-act ask-edit", r#type: "button", title: "Edit from here: go back to this message, forget what came after, and write it again", onclick: move |_| edit.call(()),
                            Icon { name: "pencil", size: 12 } "Edit from here"
                        }
                    }
                }
            }
            if let Some(r) = run {
                RunView { key: "{r.id}", on_open: move |open| on_open.call((r.id, open)), run: r.clone() }
            }
            for f in turn.figures.iter() { FigureView { node: f.clone() } }
            // What it said is Markdown: headings, lists, tables, code. What was asked is shown as typed.
            for (i, r) in turn.replies.iter().enumerate() {
                div { key: "{i}", class: "say", id: "say-{index}-{i}",
                    Prose { class: "say-text", text: r.clone() }
                    if let Some(cite) = on_cite {
                        button { class: "turn-act say-cite", r#type: "button", title: "Cite in composer: the words chosen in this answer, or all of it",
                            // The words chosen, when the choice is inside this answer.
                            onmousedown: move |e| e.prevent_default(),
                            onclick: { let (whole, at) = (r.clone(), format!("say-{index}-{i}")); move |_| {
                                let (whole, at) = (whole.clone(), at.clone());
                                spawn(async move {
                                    let js = format!("const s = getSelection(); const el = document.getElementById('{at}'); return (s && el && s.rangeCount && el.contains(s.anchorNode)) ? s.toString() : '';");
                                    let chosen = document::eval(&js).await.ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
                                    cite.call(if chosen.trim().is_empty() { whole } else { chosen });
                                });
                            } },
                            Icon { name: "quote", size: 12 } "Cite in composer"
                        }
                    }
                }
            }
            if !writing.is_empty() { Writing { text: writing } }
        }
    }
}

/// An answer while it is written: the text so far, drawn as it will be, and a caret where the
/// next words arrive. A screen reader is told it is still being written, not each word.
#[component]
pub fn Writing(text: String) -> Element {
    rsx! {
        div { class: "say is-writing", "aria-busy": "true",
            // The caret is drawn after the last line by the stylesheet (`.is-writing`).
            Prose { class: "say-text", text }
            span { class: "visually-hidden", role: "status", "Writing…" }
        }
    }
}

/// A session with another agent, as its turns: what the owner said (as typed) and what the
/// agent answered (as Markdown). `working`: the agent is at it now. `error`: why the last
/// turn failed, when it did.
#[component]
pub fn SessionThread(turns: Vec<Turn>, #[props(default)] agent: String, #[props(default)] working: bool, #[props(default)] error: String) -> Element {
    rsx! {
        ScrollArea { id: "thread", class: "thread", aria_label: "Conversation", fade: true,
            div { class: "lane thread-lane", "aria-live": "polite",
                if turns.is_empty() && !working { p { class: "thread-empty", "Prompt it to begin." } }
                for (i, t) in turns.into_iter().enumerate() {
                    article { key: "{i}", class: "turn",
                        if t.who == USER {
                            div { class: "ask", p { class: "ask-text", "{t.text}" } }
                        } else {
                            div { class: "say", Prose { class: "say-text", text: t.text } }
                        }
                    }
                }
                if working { p { class: "sending shimmer", role: "status", "{agent} is working…" } }
                if !error.is_empty() { p { class: "work-error", role: "alert", "{error}" } }
            }
        }
    }
}
