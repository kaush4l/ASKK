//! The canvas: every running session as a box (`docs/concept.md`).
//!
//! The shell asks for the boxes once ([`use_boxes_provider`]) and the pill and this canvas
//! draw the same list, so they can never disagree. What "done" means, the order, and which
//! boxes count as running are decided in `ui/features/boxes.rs`.
use crate::core::boxes::SessionBox;
use crate::ui::features::boxes::{count, order, running, Mark, Seen};
use crate::ui::web::components::{BoxTile, Pane, Shown};
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// The boxes as this window knows them: the service's list, and what this window has seen.
#[derive(Clone, Copy)]
pub struct Boxes {
    pub list: Signal<Vec<SessionBox>>,
    pub seen: Signal<Seen>,
}

impl Boxes {
    /// Every box in the order a person needs it, with its mark here and the page it opens to.
    pub fn shown(&self) -> Vec<Shown> {
        let seen = self.seen.read();
        order(&self.list.read(), &seen).into_iter().map(|b| Shown { mark: seen.mark(&b), to: page_of(&b.id), b }).collect()
    }

    pub fn counts(&self) -> Vec<(Mark, usize)> {
        count(&self.list.read(), &self.seen.read())
    }

    /// The owner looked at this box: it is no longer "done".
    pub fn looked(&mut self, id: &str) {
        self.seen.write().looked(id);
    }
}

/// The page a box opens to: an engine's own page, the sessions page for a harness session.
pub fn page_of(id: &str) -> String {
    match id.split_once(':') {
        Some(("engine", path)) => format!("/e/{path}"),
        _ => "/sessions".to_string(),
    }
}

/// Ask for the boxes, again whenever an engine or a session is marked changed, and provide
/// them to the pill and the canvas. `engines` and `sessions` are the manifest's keys for them.
pub fn use_boxes_provider(engines: String, sessions: String) -> Boxes {
    let on_engines = super::live::use_live(move || engines.clone());
    let on_sessions = super::live::use_live(move || sessions.clone());
    let mut list = use_signal(Vec::<SessionBox>::new);
    let mut seen = use_signal(Seen::default);
    let _ = use_resource(move || {
        let changed = (on_engines(), on_sessions());
        async move {
            let _ = changed;
            if let Ok(now) = crate::api::boxes().await {
                seen.write().take(&now);
                if *list.peek() != now {
                    list.set(now);
                }
            }
        }
    });
    use_context_provider(|| Boxes { list, seen })
}

/// Say `text` to the box `id`: run an engine, or prompt a session. The answer is not waited
/// for here: the box itself shows it working, then done.
async fn say(id: String, text: String) -> Result<(), String> {
    match id.split_once(':') {
        Some(("engine", path)) => crate::api::run_engine(path.to_string(), text).await.map(|_| ()).map_err(|e| e.to_string()),
        Some(("session", n)) => match n.parse::<u64>() {
            Ok(n) => crate::api::session_prompt(n, text).await.map_err(|e| e.to_string()),
            Err(_) => Err(format!("'{id}' is not a session")),
        },
        _ => Err(format!("'{id}' cannot be spoken to from here yet")),
    }
}

/// The canvas of running sessions. Idle ones stay in the pill unless asked for.
#[component]
pub fn BoxesView() -> Element {
    let mut boxes = use_context::<Boxes>();
    let mut idle_too = use_signal(|| false);
    let mut wrong = use_signal(String::new);
    let all = boxes.shown();
    let seen = boxes.seen.read().clone();
    let on: Vec<Shown> = all.iter().filter(|s| idle_too() || running(&s.b, &seen)).cloned().collect();
    let idle = all.len() - all.iter().filter(|s| running(&s.b, &seen)).count();
    let counts = boxes.counts();
    rsx! {
        div { class: "box-bar",
            p { class: "box-counts", "aria-live": "polite",
                if all.is_empty() { span { class: "dim", "no sessions yet" } }
                for (m, n) in counts {
                    span { key: "{m.key()}", class: "pill-count is-{m.key()}", "{m.sign()} {n} {m.word()}" }
                }
            }
            if idle > 0 {
                Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, onclick: move |_| idle_too.toggle(),
                    if idle_too() { "Only what is running" } else { "Show the {idle} idle too" }
                }
            }
        }
        if !wrong().is_empty() { p { class: "box-wrong", role: "alert", "{wrong}" } }
        if on.is_empty() {
            Pane {
                p { "Nothing is running." }
                p { class: "dim", "Every session is in the list on the left. Open one to speak to it, or show the idle ones here and speak into a box." }
            }
        } else {
            div { class: "box-grid",
                for s in on {
                    BoxTile { key: "{s.b.id}", shown: s,
                        on_look: move |id: String| boxes.looked(&id),
                        on_say: move |(id, text): (String, String)| {
                            wrong.set(String::new());
                            spawn(async move {
                                if let Err(e) = say(id, text).await {
                                    wrong.set(e);
                                }
                            });
                        },
                    }
                }
            }
        }
    }
}
