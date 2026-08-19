//! THE WAY OUT OF A COMMAND THAT WILL NOT END (R11-1b). `terminal/mod.rs` owns
//! the pane and the box you type into; ending a command is its own act, with
//! its own promise, and it is stated here once.
//!
//! Until this there was no way out at all: a foreground `while true` held the
//! one shell, the header said `ready` in green, and the only exit was the
//! browser's reload button, which the product never suggested.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::Button;

/// ONE CONTROL, ONE HONEST PROMISE. The Linux drives one PTY, so `0x03` reaches
/// the foreground process group and the command really dies — and `how` is the
/// core's own answer (`x-interrupt`), never a guess this side makes about what
/// the workspace can do.
#[component]
pub fn StopCommand(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    /// `kill` or `none` — and `none` renders nothing, because a control that
    /// cannot do anything is worse than no control (R6-13).
    how: String,
    /// The pane's projection, so the press redraws it from the same seam call.
    panel: Signal<String>,
) -> Element {
    if how != "kill" {
        return rsx! {};
    }
    let mut panel = panel;
    rsx! {
        div { class: "follow-up",
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let Some(app) = web.peek().clone() else { return };
                    panel.set(
                        app.handle(
                            Request::post_form("/terminal/stop", &[])
                                .with_header("x-agent", &agent()),
                        )
                        .body,
                    );
                },
                // ITS OWN WORDS, BECAUSE IT IS ITS OWN ACT (R17-P1-5) — this
                // ends the command, it does not merely stop waiting for it.
                "Stop the command"
            }
            p { class: "note",
                "It sends the shell the interrupt Ctrl-C sends, so the command really \
                 ends and the Linux is free."
            }
        }
    }
}
