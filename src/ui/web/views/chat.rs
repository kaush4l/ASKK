//! Talk: the conversation with an engine (a page names this view `chat`).
//!
//! This file chooses which engine: the page's `path` param, else the view's argument, else
//! `askk`; and the engines that offer themselves as modes are the other choices. The
//! conversation itself is [`super::conversation::Conversation`], the same one an engine's box
//! shows when it is open on the canvas.
use super::conversation::Conversation;
use crate::api::Mode;
use dioxus::prelude::*;

#[component]
pub fn ChatView(#[props(default)] arg: String) -> Element {
    let start = try_use_context::<crate::core::routes::Params>().and_then(|p| p.0.get("path").cloned()).filter(|p| !p.is_empty()).or((!arg.is_empty()).then_some(arg)).unwrap_or_else(|| "askk".into());
    let mut path = use_signal(|| start);
    let modes = use_resource(crate::api::modes);
    let engines: Vec<Mode> = modes.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    rsx! {
        // Keyed by engine: another engine starts with its own conversation and composer.
        for p in [path()] {
            Conversation { key: "{p}", path: p.clone(), engines: engines.clone(), on_pick: move |p| path.set(p) }
        }
    }
}
