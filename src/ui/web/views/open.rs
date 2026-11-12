//! A box, open: it fills the canvas and shows everything its depth gives (`docs/concept.md`).
//!
//! | the box is | open, it shows | made of |
//! | --- | --- | --- |
//! | an engine | its conversation, each run stage by stage, its goal, learnings and tools behind one touch, what it waits for, the composer | [`super::conversation::Conversation`] |
//! | a session with another agent | its turns, and a line to prompt it | `SessionThread`, `Composer` |
//! | a terminal | its screen, and typing | `TerminalView`, redrawn when the change feed names `terminals/<id>`; a build that holds no terminals says so |
//!
//! This file asks (a session's turns) and hands down. The head is the same for every kind.
use super::boxes::Boxes;
use super::conversation::Conversation;
use crate::core::session::{Session, State};
use crate::ui::features::boxes::{engine_of, session_of};
use crate::ui::web::components::{Composer, OpenHead, Pane, SessionThread, Shown, TerminalView};
use dioxus::prelude::*;

/// The address a box is put back to: the page it is on, with no box named.
fn use_back() -> String {
    let here = use_route::<crate::Route>().to_string();
    let page = here.split('#').next().unwrap_or("/").to_string();
    if page.is_empty() { "/".to_string() } else { page }
}

#[component]
pub fn OpenBox(shown: Shown) -> Element {
    let mut boxes = use_context::<Boxes>();
    let id = shown.b.id.clone();
    let back = use_back();
    let title = shown.b.title.clone();
    rsx! {
        section { class: "open-box", "aria-label": "{title}, open",
            OpenHead { shown, back, on_pin: move |id: String| boxes.pin(&id) }
            match (engine_of(&id), session_of(&id)) {
                (Some(path), _) => rsx! { Conversation { path: path.to_string(), boxed: true } },
                (_, Some(n)) => rsx! { SessionTalk { n } },
                _ => match crate::ui::features::terminals::inside(&id) {
                    crate::ui::features::terminals::Inside::Terminal(t) => rsx! { TerminalBox { id: t, title: title.clone() } },
                    _ => rsx! { Pane { class: "open-none", p { "This window does not know how to show “{id}”." } } },
                },
            }
        }
    }
}

/// A session with another agent, open: its turns, and a line to prompt it.
#[component]
fn SessionTalk(n: u64) -> Element {
    let mut boxes = use_context::<Boxes>();
    let root = super::live::use_manifest().sessions;
    let live = super::live::use_live(move || root.clone());
    let fetched = use_resource(move || {
        let _ = live();
        crate::api::sessions()
    });
    // Keep the last answer while the next is fetched, so the box never blinks.
    let mut held = use_signal(|| None::<Session>);
    use_effect(move || {
        if let Some(Ok(all)) = &*fetched.read() {
            held.set(all.iter().find(|s| s.id == n).cloned());
        }
    });
    let mut input = use_signal(String::new);
    let id = format!("session:{n}");
    let queued = boxes.queue.read().of(&id);
    let now = held();
    let (turns, working) = now.as_ref().map(|s| (s.turns.len(), s.state == State::Busy)).unwrap_or_default();
    // Keep the newest turn in sight.
    use_effect(use_reactive!(|(turns, working)| {
        let _ = (turns, working);
        document::eval("const end = () => { const b = document.getElementById('thread'); if (b) b.scrollTop = b.scrollHeight; }; requestAnimationFrame(() => { end(); requestAnimationFrame(end); });");
    }));
    let Some(s) = now else {
        return rsx! { p { class: "dim open-none", role: "status", "Reading the session…" } };
    };
    let wrong = (boxes.wrong)();
    rsx! {
        div { class: "talk fill is-boxed side-closed",
            section { class: "talk-main", "aria-label": "Conversation with {s.title}",
                SessionThread { turns: s.turns.clone(), agent: s.harness.clone(), working, error: s.error.clone() }
                div { class: "talk-foot",
                    div { class: "lane",
                        if !wrong.is_empty() { p { class: "talk-error", role: "alert", "{wrong}" } }
                        Composer { value: input, to: s.harness.clone(), working, queued,
                            on_send: { let id = id.clone(); move |_| {
                                let text = input().trim().to_string();
                                if !text.is_empty() {
                                    input.set(String::new());
                                    boxes.say(id.clone(), text);
                                }
                            } },
                            on_unqueue: { let id = id.clone(); move |(key, edit): (u64, bool)| {
                                let text = boxes.queue.write().remove(&id, key);
                                if let Some(text) = text.filter(|_| edit) { input.set(text); }
                            } },
                        }
                    }
                }
            }
        }
    }
}

/// A terminal the service holds, open: its screen, asked again whenever the change feed names
/// it, and every key typed sent to its program.
#[component]
fn TerminalBox(id: String, title: String) -> Element {
    let key = id.clone();
    let live = super::live::use_live(move || format!("terminals/{key}"));
    let asked = id.clone();
    let screen = use_resource(move || {
        let _ = live();
        let id = asked.clone();
        async move { crate::api::terminal_screen(id).await.map_err(|e| e.to_string()) }
    });
    // Keep the last screen while the next is fetched, so the terminal never blinks.
    let mut held = use_signal(|| None::<Result<crate::core::screen::Screen, String>>);
    use_effect(move || {
        if let Some(now) = &*screen.read() {
            held.set(Some(now.clone()));
        }
    });
    match held() {
        None => rsx! { p { class: "dim open-none", role: "status", "Reading the terminal…" } },
        Some(Err(e)) => rsx! { Pane { class: "open-none", p { role: "alert", "{e}" } } },
        Some(Ok(s)) => rsx! {
            TerminalView { screen: s, label: title,
                on_type: move |keys: String| {
                    let id = id.clone();
                    spawn(async move { let _ = crate::api::terminal_type(id, keys).await; });
                },
            }
        },
    }
}
