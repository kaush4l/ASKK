//! THE WAY OUT OF A COMMAND THAT WILL NOT END (R11-1b). Split from
//! `terminal.rs`, which owns the pane and the box you type into, so both hold
//! the 200-line rule (I12) — and because this control is the one place in the
//! product where two engines make two different promises and the words have to
//! follow the engine rather than the wish.
//!
//! Until this there was no way out at all: a foreground `while true` held the
//! one shell, the header said `ready` in green, and the only exit was the
//! browser's reload button, which the product never suggested.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::Button;

/// ONE CONTROL, TWO HONEST PROMISES. c2w drives one PTY, so `0x03` reaches the
/// foreground process group and the command dies; CheerpX runs each command as
/// its own `cx.run` with no handle, no cancel and no stdin except the console,
/// so the most that happens there is that this page stops waiting. Same button,
/// different words, because they are different things — and `how` is the core's
/// own answer (`x-interrupt`), never a guess this side makes about the setting.
#[component]
pub fn StopCommand(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    /// `kill`, `abandon`, or `none` — and `none` renders nothing, because a
    /// control that cannot do anything is worse than no control (R6-13).
    how: String,
    /// The pane's projection, so the press redraws it from the same seam call.
    panel: Signal<String>,
) -> Element {
    if how == "none" {
        return rsx! {};
    }
    let kill = how == "kill";
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
                // ONE SHAPE FOR EVERY STOP-WAITING LABEL (R17-P1-5). This was
                // the third wording of one control on one product. The kill
                // keeps its own words because it is a different act.
                if kill { "Stop the command" } else { "Stop waiting — the command keeps running" }
            }
            p { class: "note",
                if kill {
                    "It sends the shell the interrupt Ctrl-C sends, so the command really \
                     ends and the Linux is free."
                } else {
                    "This Linux gives the page no way to signal a command once it has \
                     started, so this stops the WAIT: the command may keep running in \
                     there, and the next one starts when it ends."
                }
            }
        }
    }
}
