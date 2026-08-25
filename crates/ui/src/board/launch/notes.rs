//! THE TWO SENTENCES UNDER THE FORM: whose run is somewhere else, and what
//! pressing Start actually does. Both are about a thing this card is NOT
//! showing, which is why neither is in the card's own body.

use dioxus::prelude::*;

use crate::ui::{Button, Disclosure};
use crate::shell::views::View;

/// ONE LINE, AND A DOOR (R9-2). Somebody ELSE's run, named in one line rather
/// than shown in this card: the board below lists every agent, and what this
/// adds is the DOOR, to a run that was in this card a second ago. Not this
/// card's run, so not this card's card — the hash IS the view and its subject
/// (R6-3), so naming the other conversation is the whole navigation.
#[component]
pub(crate) fn ElsewhereRun(who: String, busy: String) -> Element {
    let Some(other) = busy.split(", ").find(|n| !n.is_empty() && *n != who).map(str::to_string)
    else {
        return rsx! {};
    };
    rsx! {
        p { class: "note", role: "status",
            "{other} is still working on a task of its own — this panel is {who}'s."
            Button {
                variant: "ghost",
                onclick: {
                    let other = other.clone();
                    move |_| crate::shell::route::show(View::Work, &other)
                },
                "Open {other}'s chat"
            }
        }
    }
}

/// The six lines this panel used to spend introducing one text field (F9). NOT
/// SHOWN WHERE THERE IS NO BUTTON TO PRESS (29) — and it no longer promises
/// commands, a claim about the toolbox rather than about this panel.
#[component]
pub(crate) fn WhatPressingStartDoes(who: String, acts: bool) -> Element {
    if !acts {
        return rsx! {};
    }
    rsx! {
        Disclosure { summary: "What happens when you press Start agent",
            p { class: "note",
                "{who} works in the background, on its own: it uses the tools its file \
                 names, for as many steps as its own settings allow. Nothing on this \
                 page waits for it — switch views, or open Chat and join the \
                 conversation, without restarting anything."
            }
        }
    }
}
