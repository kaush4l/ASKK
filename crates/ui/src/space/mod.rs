//! `SpaceInspector` — facts, notes and the workspace path (plan, "UI shape";
//! Python counterpart `core/space.py`). It owns nothing but the fetch: the
//! content is the core's own read of the shared store, so what this shows and
//! what is in every agent's prompt are the same read.

pub(crate) mod empty_states;

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{Card, Disclosure, Skeleton};
use crate::shell::views::View;

/// A space changes when ANOTHER Worker writes to it, which happens on nobody's
/// schedule — so this pane keeps its own slow clock while the page is open.
/// 2 s, not 400 ms: a note is read by a person, not raced for.
const TICK_MS: i32 = 2000;

#[component]
pub fn SpaceInspector(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// WHOSE space (09 walk, finding 3). The pane was global, so selecting
    /// the one agent with no space still showed "Space: research" — the same
    /// `x-agent` addressing every other per-agent read uses.
    agent: ReadSignal<String>,
    /// The `/agents` projection: which of this card's two nothings it is
    /// showing (R6-15) turns on whether this agent names a space at all.
    agents: Signal<String>,
    /// So the one action in the empty state can go where the composer is.
    view: Signal<View>,
) -> Element {
    let mut panel = use_signal(String::new);
    let read = move || match web.peek().clone() {
        Some(app) => app
            .handle(Request::get("/space").with_header("x-agent", &agent()))
            .body,
        None => String::new(),
    };
    // EXACTLY ONE CLOCK, and it never ends on its own — the same guard
    // `AgentBoard` carries, and for the same reason it spells out: Dioxus does
    // not cancel a scope's tasks when an effect re-runs, and this effect reads
    // `tick`, which `chat::state::show` bumps every 400ms for the whole of a turn.
    // Without the guard a ten-minute run left about fifteen hundred immortal
    // pollers behind it, every one of them calling the seam every two seconds,
    // on the view the page LANDS on. The loop is `loop` rather than a counted
    // one because a space changes on nobody's schedule; the flag is what makes
    // that safe, and `peek` is what stops the effect subscribing to it.
    let mut watching = use_signal(|| false);
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        panel.set(read());
        if watching.peek().to_owned() {
            return;
        }
        watching.set(true);
        spawn(async move {
            loop {
                if sleep(TICK_MS).await.is_err() {
                    return;
                }
                panel.set(read());
            }
        });
    });
    let projection = panel.read().clone();
    let who = agent();
    // The core counts what it rendered onto the panel element — this only
    // reads the numbers back, the same contract `terminal::commands_in` has
    // with `data-commands`. A space with no facts and no notes is the only
    // genuinely empty one; the two other nothing-to-show cases (this agent
    // names no space, this page reads a different space) keep the core's own
    // agent-specific sentence, inside the same empty state (R6-15).
    let bare = projection.contains("data-facts=\"0\"") && projection.contains("data-notes=\"0\"");
    // The core answers with the panel itself, or with one sentence saying why
    // there is no panel to show — two cases, and both used to arrive as raw
    // prose in a card whose third case had a whole empty state (R6-15).
    let no_panel = !projection.is_empty() && !projection.contains("id=\"space\"");
    // NAMED AFTER THE SPACE, NOT AFTER THE AGENT (R18-P1-2). `Workspace · main`
    // over "Nothing has been recorded here yet" is what let a reader conclude
    // main had lied about the file it had just written: this panel is not the
    // folder and it is not main's — it is the facts and notes a SPACE shares,
    // and every agent naming that space shares them. The agent's name is used
    // only while the projection has no space to name, which is exactly the two
    // cases whose sentence is about the agent.
    let named = projection
        .split_once("data-space=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| who.clone());
    rsx! {
        Card { title: "Shared facts and notes · {named}",
            aria_label: "Shared facts and notes for {named}",
            div { aria_live: "polite",
                if projection.is_empty() {
                    Skeleton { lines: 3, label: "Reading the shared facts and notes" }
                } else if no_panel {
                    {crate::space::empty_states::not_in_a_space(
                        &who, &projection,
                        !crate::board::roster::has_workspace(&agents.read(), &who),
                        view,
                    )}
                } else if bare {
                    {crate::space::empty_states::nothing_shared(&who, view)}
                } else {
                    div { dangerous_inner_html: "{projection}" }
                }
            }
            // Five lines in front of "No shared facts yet." (12b walk, finding
            // D2). The live read comes first now and the paragraph is behind
            // the marker, unchanged.
            Disclosure { summary: "How the shared facts and notes are read and written",
                p { class: "note",
                    "Every agent whose file names this space reads them — each one running \
                     separately, out of one shared store — and writes to them with the \
                     remember, forget and post_note tools. They go into every one of those \
                     agents' instructions before every reply, so a fact recorded here is one \
                     nobody has to be asked for again. Files are not here: what an agent \
                     writes with write_file goes into its folder, which Commands lists."
                }
            }
        }
    }
}
