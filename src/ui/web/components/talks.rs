//! An engine's conversations as a list: the one open now first, then the others, last open
//! first; a new one is begun from the top of it. It is given the list and says what was
//! pressed; putting a conversation aside, bringing one back or only reading it is the view's
//! to do.
use super::Icon;
use crate::api::TalkInfo;
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// `busy`: the engine is at work, so no new conversation can begin now (the others can still be
/// read). `reading`: the conversation put aside that is shown now instead of the open one.
#[component]
pub fn TalkList(talks: Vec<TalkInfo>, #[props(default)] busy: bool, #[props(default)] reading: Option<u64>, on_open: EventHandler<u64>, on_new: EventHandler<()>) -> Element {
    let n = talks.len();
    rsx! {
        section { class: "talks glass", "aria-label": "Conversations",
            div { class: "talks-head",
                p { class: "talks-count", "{n} conversation" if n != 1 { "s" } }
                span { class: "grow" }
                Button { variant: ButtonVariant::Outline, size: ButtonSize::Sm, disabled: busy, title: if busy { "It is at work: a new conversation can begin when it is done" } else { "Begin a new conversation; this one is kept" }, onclick: move |_| on_new.call(()),
                    Icon { name: "plus", size: 14 } span { "New conversation" }
                }
            }
            if busy {
                p { class: "talks-note dim", role: "status",
                    "It is at work in the open conversation. The others can be read meanwhile, and opened to talk in when it is done. A new one can begin when it is done too, so what it is writing stays in the conversation it began in."
                }
            }
            ol { class: "talks-list",
                for t in talks {
                    li { key: "{t.id}",
                        button { class: match (t.current, reading == Some(t.id)) { (true, _) => "talk-row is-current", (_, true) => "talk-row is-reading", _ => "talk-row" }, r#type: "button",
                            "aria-current": if (t.current && reading.is_none()) || reading == Some(t.id) { "true" },
                            title: if t.current { "The open conversation" } else if busy { "Read it while it works" } else { "Open it" },
                            onclick: move |_| on_open.call(t.id),
                            Icon { name: "chat", size: 14 }
                            span { class: "talk-title", if t.title.is_empty() { "(nothing said yet)" } else { "{t.title}" } }
                            if t.current { span { class: "talk-live dim", "open" } }
                            span { class: "talk-turns dim", "{t.turns}" }
                        }
                    }
                }
            }
        }
    }
}
