//! An engine's conversations as a list: the one open now first, then the others, last open
//! first; a new one is begun from the top of it. It is given the list and says what was
//! pressed; putting a conversation aside and bringing one back is the view's to do.
use super::Icon;
use crate::api::TalkInfo;
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// `busy`: the engine is at work, so no other conversation can be opened or begun now.
#[component]
pub fn TalkList(talks: Vec<TalkInfo>, #[props(default)] busy: bool, on_open: EventHandler<u64>, on_new: EventHandler<()>) -> Element {
    let n = talks.len();
    rsx! {
        section { class: "talks glass", "aria-label": "Conversations",
            div { class: "talks-head",
                p { class: "talks-count", "{n} conversation" if n != 1 { "s" } }
                span { class: "grow" }
                Button { variant: ButtonVariant::Outline, size: ButtonSize::Sm, disabled: busy, title: if busy { "It is at work: stop it, or wait until it is done" } else { "Begin a new conversation; this one is kept" }, onclick: move |_| on_new.call(()),
                    Icon { name: "plus", size: 14 } span { "New conversation" }
                }
            }
            if busy { p { class: "talks-note dim", role: "status", "It is at work: another conversation can be opened when it is done." } }
            ol { class: "talks-list",
                for t in talks {
                    li { key: "{t.id}",
                        button { class: if t.current { "talk-row is-current" } else { "talk-row" }, r#type: "button",
                            disabled: busy && !t.current, "aria-current": if t.current { "true" },
                            onclick: move |_| if !t.current { on_open.call(t.id) },
                            Icon { name: "chat", size: 14 }
                            span { class: "talk-title", if t.title.is_empty() { "(nothing said yet)" } else { "{t.title}" } }
                            span { class: "talk-turns dim", "{t.turns}" }
                        }
                    }
                }
            }
        }
    }
}
