//! The one control in Settings that DESTROYS something. Its own file since the
//! endpoint pane grew a third kind of entry and `settings_view.rs` reached the
//! 200-line ceiling (I12); the behaviour below is unchanged.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::settings::{reset, Fields};
use crate::ui::Button;

/// THE DESTRUCTIVE ONE, AND IT LOOKS LIKE IT (R6-5): it deletes every saved key
/// and address override in this browser, and it fired on one press. The ARM is
/// the other half — one press asks, the next does it. …AND IT DISARMS (R8-16):
/// the arm carries a Cancel, and arming CLEARS the status: one region, one line.
pub(crate) fn reset_control(
    web: Signal<Option<Rc<WebApp>>>,
    f: Fields,
    endpoint_set: Signal<bool>,
) -> Element {
    let armed = f.arm.read().to_owned();
    rsx! {
        Button {
            // RED IS FOR THE PRESS THAT DESTROYS (R10-4). This was `danger` in
            // both states while the reload two cards down — which ends a running
            // turn and every file on the forgetting engine — was a secondary.
            variant: if armed { "danger" } else { "secondary" },
            onclick: move |_| {
                let (mut arm, mut status) = (f.arm, f.status);
                let ready = arm.peek().to_owned();
                arm.set(!ready);
                match ready {
                    true => reset(web, f, endpoint_set),
                    false => status.set(String::new()),
                }
            },
            if armed { "Yes — reset every endpoint" } else { "Reset every endpoint to the ones shipped with this site" }
        }
        if armed {
            Button {
                variant: "ghost",
                onclick: move |_| {
                    let mut arm = f.arm;
                    arm.set(false);
                },
                "Cancel"
            }
            p { class: "error", role: "status",
                "⚠ This deletes every API key and every address you have saved in this \
                 browser, for every endpoint, and cannot be undone."
            }
        }
    }
}
