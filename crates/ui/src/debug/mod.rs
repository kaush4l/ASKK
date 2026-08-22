//! `Debug` — WHAT IS GOING ON. Its mirror is `core::debug`, which does all of
//! the work: this pane owns the fetch and nothing else, exactly as `Processes`
//! and `ToolTrace` do. No capability, no state, no logic (I5).
//!
//! WHY IT EXISTS AT ALL. The harness has been emitting facts nobody reads: the
//! route a turn voted and the clause behind it, the stage machine's own moves,
//! the Document hash of every model call, the writes that failed, and what the
//! model SAID in the rounds where it called a tool rather than answering. Every
//! one of those is in the log, persisted, and drew nothing anywhere in the
//! product. I8 says every view is a projection of the log; this is the converse
//! being honoured, which is I16 with an event's clothes on.
//!
//! IT IS ORGANISED BY THE QUESTION, NOT BY THE RECORD — `core::debug::render`
//! holds the four questions and their order. `read.rs` owns the fetch and
//! `frame.rs` the three things this pane says in its own voice.

pub(crate) mod frame;
pub(crate) mod read;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::ui::{has_rows, Card, Skeleton};
use frame::{Alarm, NothingYet, WhatThisReads, WhoseLog};
use read::{read, Facts};

/// Re-projected on the page's heartbeat; the pane holds no state of its own.
fn reproject(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    mut panel: Signal<String>,
    mut facts: Signal<Facts>,
) {
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        let (body, now) = read(&web, &agent());
        if *facts.peek() != now {
            facts.set(now);
        }
        if *panel.peek() != body {
            panel.set(body);
        }
    });
}

#[component]
pub fn Debug(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
) -> Element {
    let panel = use_signal(String::new);
    let facts = use_signal(Facts::default);
    reproject(web, tick, agent, panel, facts);
    let projection = panel.read().clone();
    let f = facts.read().clone();
    let who = agent();
    // A LOG WITH NO TURN IN IT MAY STILL HAVE AN ALARM IN IT. The core draws the
    // failed writes whether or not any turn exists, so the projection is shown
    // whenever it holds either — an empty state over a storage alarm would hide
    // the one thing on this pane nobody may miss.
    let drawn = has_rows(&projection, "debug-turn") || f.store_failed > 0;
    let title = match f.turns {
        0 => "Debug".to_string(),
        n => format!("Debug · {n} turns · {} model calls", f.calls),
    };
    rsx! {
        Card { title, aria_label: "What each of {who}'s turns decided, cost and broke",
            Alarm { failed: f.store_failed }
            WhoseLog { who: who.clone(), own: f.own_log }
            div { aria_live: "polite",
                if projection.is_empty() {
                    Skeleton { lines: 3, label: "Reading what the turns did" }
                } else if drawn {
                    div { dangerous_inner_html: "{projection}" }
                } else {
                    NothingYet { who: who.clone() }
                }
            }
            WhatThisReads {}
        }
    }
}
