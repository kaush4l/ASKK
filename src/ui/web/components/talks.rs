//! An engine's conversations as a list: the one open now first, then the others, last open
//! first, and those settled under their own heading; archived ones are behind one touch. A
//! search field finds a conversation by its title or its words. Each row can be renamed,
//! settled and archived. It is given the list and what was found, and says what was pressed;
//! putting a conversation aside, bringing one back, marking it or searching is the view's to do.
use super::Icon;
use crate::api::{TalkHit, TalkInfo};
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// `busy`: the engine is at work, so no new conversation can begin now (the others can still be
/// read). `reading`: the conversation put aside that is shown now instead of the open one.
/// `query`, `hits`: what is searched for and what was found. `on_mark((id, what, title))`:
/// `archive`, `settle`, `unsettle`, `unarchive`, or `name:<new name>`.
#[component]
pub fn TalkList(
    talks: Vec<TalkInfo>,
    #[props(default)] busy: bool,
    #[props(default)] reading: Option<u64>,
    #[props(default)] query: String,
    #[props(default)] hits: Vec<TalkHit>,
    on_open: EventHandler<u64>,
    on_new: EventHandler<()>,
    #[props(optional)] on_mark: Option<EventHandler<(u64, String, String)>>,
    #[props(optional)] on_query: Option<EventHandler<String>>,
) -> Element {
    let mut show_archived = use_signal(|| false);
    let mut renaming = use_signal(|| None::<(u64, String)>);
    let archived = talks.iter().filter(|t| t.archived).count();
    let shown: Vec<TalkInfo> = talks.iter().filter(|t| !t.archived || show_archived()).cloned().collect();
    let (settled, open): (Vec<TalkInfo>, Vec<TalkInfo>) = shown.into_iter().partition(|t| t.settled && !t.current);
    let n = talks.len() - archived;
    let mark = move |x: (u64, String, String)| if let Some(h) = &on_mark { h.call(x) };
    let searching = !query.trim().is_empty();
    rsx! {
        section { class: "talks glass", "aria-label": "Conversations",
            div { class: "talks-head",
                p { class: "talks-count", "{n} conversation" if n != 1 { "s" } }
                span { class: "grow" }
                Button { variant: ButtonVariant::Outline, size: ButtonSize::Sm, disabled: busy, title: if busy { "It is at work: a new conversation can begin when it is done" } else { "Begin a new conversation; this one is kept" }, onclick: move |_| on_new.call(()),
                    Icon { name: "plus", size: 14 } span { "New conversation" }
                }
            }
            if on_query.is_some() {
                label { class: "talks-search",
                    Icon { name: "search", size: 14 }
                    span { class: "visually-hidden", "Find a conversation by its title or its words" }
                    input { r#type: "search", value: "{query}", placeholder: "Find by title or words", autocomplete: "off",
                        oninput: move |e| if let Some(h) = &on_query { h.call(e.value()) },
                    }
                }
            }
            if busy {
                p { class: "talks-note dim", role: "status",
                    "It is at work in the open conversation. The others can be read meanwhile, and opened to talk in when it is done. A new one can begin when it is done too, so what it is writing stays in the conversation it began in."
                }
            }
            if searching {
                ol { class: "talks-list", "aria-label": "Found",
                    if hits.is_empty() { li { p { class: "talks-note dim", "Nothing found for “{query}”." } } }
                    for h in hits {
                        li { key: "found-{h.id}",
                            button { class: "talk-row talk-hit", r#type: "button", onclick: move |_| on_open.call(h.id),
                                Icon { name: if h.archived { "archive" } else { "chat" }, size: 14 }
                                span { class: "talk-title", "{h.title}" if h.archived { span { class: "dim", " · archived" } } if h.current { span { class: "dim", " · open" } } }
                                if !h.said.is_empty() { span { class: "talk-said dim", "{h.said}" } }
                            }
                        }
                    }
                }
            } else {
                for (head, list) in [("", open), ("Settled", settled)] {
                    if !head.is_empty() && !list.is_empty() { p { class: "talks-section", "{head}" } }
                    ol { class: "talks-list",
                        for t in list {
                            li { key: "{t.id}", class: "talk-item",
                                if renaming().is_some_and(|(id, _)| id == t.id) {
                                    form { class: "talk-rename",
                                        onsubmit: { let title = t.title.clone(); move |e: FormEvent| {
                                            e.prevent_default();
                                            if let Some((id, name)) = renaming() { mark((id, format!("name:{name}"), title.clone())); }
                                            renaming.set(None);
                                        } },
                                        input { r#type: "text", value: renaming().map(|(_, n)| n).unwrap_or_default(), "aria-label": "A name for this conversation", autofocus: true,
                                            oninput: move |e| renaming.set(Some((t.id, e.value()))),
                                            onkeydown: move |e: KeyboardEvent| if e.key() == Key::Escape { renaming.set(None) },
                                        }
                                        Button { size: ButtonSize::Sm, button_type: "submit", "Rename" }
                                    }
                                } else {
                                    button { class: match (t.current, reading == Some(t.id)) { (true, _) => "talk-row is-current", (_, true) => "talk-row is-reading", _ => "talk-row" }, r#type: "button",
                                        "aria-current": if (t.current && reading.is_none()) || reading == Some(t.id) { "true" },
                                        title: if t.current { "The open conversation" } else if busy { "Read it while it works" } else { "Open it" },
                                        onclick: move |_| on_open.call(t.id),
                                        Icon { name: if t.archived { "archive" } else if t.settled { "check" } else { "chat" }, size: 14 }
                                        span { class: "talk-title", if !t.name.is_empty() { "{t.name}" } else if t.title.is_empty() { "(nothing said yet)" } else { "{t.title}" } }
                                        if t.current { span { class: "talk-live dim", "open" } }
                                        span { class: "talk-turns dim", "{t.turns}" }
                                    }
                                    if on_mark.is_some() {
                                        div { class: "talk-acts",
                                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: "Rename", title: "Rename", onclick: { let name = if t.name.is_empty() { t.title.clone() } else { t.name.clone() }; move |_| renaming.set(Some((t.id, name.clone()))) }, Icon { name: "pencil", size: 12 } }
                                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: if t.settled { "Not settled" } else { "Settle" }, title: if t.settled { "Back among the others" } else { "Settle: done with it, kept under Settled" },
                                                onclick: { let title = t.title.clone(); move |_| mark((t.id, if t.settled { "unsettle".into() } else { "settle".into() }, title.clone())) }, Icon { name: "check", size: 12 } }
                                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::IconSm, aria_label: if t.archived { "Unarchive" } else { "Archive" }, title: if t.archived { "Back in the list" } else { "Archive: out of the list, found by a search; undo for 5 seconds" },
                                                onclick: { let title = if t.name.is_empty() { t.title.clone() } else { t.name.clone() }; move |_| mark((t.id, if t.archived { "unarchive".into() } else { "archive".into() }, title.clone())) }, Icon { name: "archive", size: 12 } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if archived > 0 {
                    Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "talks-archived", aria_pressed: show_archived(), onclick: move |_| show_archived.toggle(),
                        Icon { name: "archive", size: 14 } if show_archived() { "Hide the {archived} archived" } else { "Show the {archived} archived" }
                    }
                }
            }
        }
    }
}
