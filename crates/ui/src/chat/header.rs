//! The chrome around a conversation: what it is called, and the one control
//! that ends it. The conversation itself is `chat/mod.rs`.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::chat::state::{show, to, Turn};
use crate::ui::Button;

/// The region's accessible name, from the agent PROP and not from the last
/// response: it must name the agent you just switched to before that agent's
/// transcript has arrived. `· {name}` is the one pattern five cards use for
/// "this card is about that agent" (R6-12).
pub(crate) fn title(agent: &str) -> String {
    match agent.is_empty() {
        true => "Chat · no agent loaded".to_string(),
        false => format!("Chat · {agent}"),
    }
}

/// CLEAR THE CONVERSATION — the way out of a thread that went wrong.
///
/// Every turn sends the whole window back to the model, so an early mistake is
/// re-read and re-billed on every call after it. There was no way to stop that
/// short of reloading the tab, which restores the same conversation from the
/// log. This is the only control in the pane that makes the prompt SHORTER.
///
/// TWO PRESSES, and the second one says what it does. A conversation is not
/// recoverable from the page once it is cleared — the log still holds every
/// fact, but nothing in this UI reads past a clear — so a single mis-click next
/// to the composer would be the most expensive button here. `arm` is the same
/// two-step the app already uses wherever a press cannot be taken back.
///
/// It is hidden while a turn is in flight and on a conversation with nothing in
/// it: clearing mid-run would leave the reply landing in a window that no
/// longer holds the question, and an empty conversation has nothing to clear.
/// A plain function and not a `#[component]`: `Turn` is a bundle of signals
/// with no `PartialEq`, which is what Dioxus's props derive needs — the same
/// reason `waiting_row` and every region in `chat/log.rs` is one.
pub(crate) fn clear_row(
    web: Signal<Option<Rc<WebApp>>>,
    turn: Turn,
    agent: String,
    busy: bool,
    empty: bool,
    mut arm: Signal<bool>,
) -> Element {
    if busy || empty {
        return rsx! {};
    }
    let press = move |_| {
        if !arm() {
            arm.set(true);
            return;
        }
        arm.set(false);
        if let Some(app) = web.peek().clone() {
            let req = to(&agent, Request::post_form("/chat/clear", &[]));
            show(&agent, app.handle(req), turn);
        }
    };
    rsx! {
        div { class: "chat-clear",
            Button {
                variant: "quiet",
                onclick: press,
                if arm() { "Clear it — this cannot be undone" } else { "Clear conversation" }
            }
            if arm() {
                Button {
                    variant: "quiet",
                    onclick: move |_| arm.set(false),
                    "Keep it"
                }
            }
        }
    }
}
