//! A conversation, drawn: the thread and each turn in it.
//!
//! A turn is one exchange ([`Beat`]): what was asked (with what was attached), the run that
//! answered it, what it drew, what it said. [`Thread`] is the list of turns in one column that
//! scrolls inside itself. Both are given everything they show.
use super::{MediaChip, RunView};
use crate::api::Beat;
use crate::core::run::Run;
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
/// view has them. `on_open` says a run was opened (`true`) or closed, by id.
#[component]
pub fn Thread(
    beats: Vec<Beat>,
    #[props(default)] runs: BTreeMap<u64, Run>,
    #[props(default)] pictures: BTreeMap<String, String>,
    #[props(default)] pending: String,
    /// True while the first answer has not arrived: the shape of a conversation is shown.
    #[props(default)] loading: bool,
    on_open: EventHandler<(u64, bool)>,
) -> Element {
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
                    TurnView { key: "{i}", full: b.run.as_ref().and_then(|r| runs.get(&r.id).cloned()), pictures: pictures.clone(), turn: b, on_open }
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

/// One turn. `full`: the turn's run with its long texts, when the view has it.
#[component]
pub fn TurnView(turn: Beat, #[props(default)] full: Option<Run>, #[props(default)] pictures: BTreeMap<String, String>, on_open: EventHandler<(u64, bool)>) -> Element {
    let run = full.or(turn.run.clone());
    rsx! {
        article { class: "turn",
            if turn.from == "summary" {
                div { class: "turn-summary",
                    div { class: "turn-rule", Separator {} span { "earlier, in short" } Separator {} }
                    p { class: "say-text", "{turn.text}" }
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
                }
            }
            if let Some(r) = run {
                RunView { key: "{r.id}", on_open: move |open| on_open.call((r.id, open)), run: r.clone() }
            }
            for f in turn.figures.iter() { FigureView { node: f.clone() } }
            for r in turn.replies.iter() { div { class: "say", p { class: "say-text", "{r}" } } }
        }
    }
}
