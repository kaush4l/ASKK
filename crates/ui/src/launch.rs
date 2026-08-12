//! Hand an agent a task and walk away (15L).
//!
//! Everything in this product until now started work by TALKING to an agent:
//! pick it in the strip, type in the composer, watch the reply. That is the
//! human-in-the-loop half of what this is for. The other half — "a way to
//! simply run the agents without human intervention" — had no control at all,
//! and the workaround was to become the loop: switch to Chat, switch agent,
//! type, wait.
//!
//! This is the same seam call the composer makes (`POST /chat` addressed with
//! `x-agent`), from the view where you are already looking at the agents, for
//! an agent you are NOT talking to. It starts a turn in that agent's own
//! Worker and returns immediately; the board beside it is what says how far it
//! has got, and the Chat view is there if you decide to join in after all.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{Button, Card, Field, Form};
use crate::views::View;

/// Give one agent a task. `agent` is whoever the page has selected — the same
/// subject the rest of this view and the rail already have.
#[component]
pub fn TaskLauncher(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// So "watch it" is one press and not a hunt through the nav.
    view: Signal<View>,
) -> Element {
    let mut task = use_signal(String::new);
    let mut sent = use_signal(String::new);
    let who = agent();
    let mut launch = move || {
        let text = task.peek().trim().to_string();
        if text.is_empty() {
            return;
        }
        let Some(app) = web.peek().clone() else { return };
        app.handle(
            Request::post_form("/chat", &[("message", text.as_str())])
                .with_header("x-agent", &agent()),
        );
        task.set(String::new());
        sent.set(text);
        // Every panel that follows an agent redraws off this.
        let mut tick = tick;
        let n = tick.peek().to_owned();
        tick.set(n + 1);
    };
    rsx! {
        Card { title: "Run a task", aria_label: "Run a task",
            p { class: "note",
                "Give {who} something to do and leave it. It runs with its own tools and its \
                 own workspace, up to the max_rounds its file allows — in this page's engine \
                 if {who} is the agent this page IS, and in its own Worker otherwise. The \
                 board says how far it has got. Nothing here waits for it, and you can join \
                 the conversation at any point without restarting anything."
            }
            Form {
                oneline: true,
                onsubmit: move |_| launch(),
                Field {
                    id: "task-field",
                    r#type: "text",
                    value: "{task}",
                    aria_label: "Task for {who}",
                    placeholder: "Build me a thing, and tell me when it works…",
                    autocomplete: "off",
                    oninput: move |e: FormEvent| task.set(e.value()),
                }
                Button { submit: true, "Run" }
            }
            if !sent.read().is_empty() {
                p { class: "pending", role: "status",
                    "{who} is on it: “{sent}”. "
                    Button {
                        variant: "secondary",
                        onclick: move |_| {
                            let mut view = view;
                            view.set(View::Chat);
                        },
                        "Watch it"
                    }
                }
            }
        }
    }
}
