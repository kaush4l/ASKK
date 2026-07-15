//! Fleet stage (ADR-042): launch, monitor, and cancel agents as individual
//! parallel loops. The engine already runs each `submit` as its own background
//! loop (per-run `drive_run`); this stage is the surface to start several at
//! once and watch them side by side. `on_launch` mirrors `app.rs::on_send`
//! (submit + drive), `on_cancel` targets one run via `cancel_run`.
//!
//! Foundation stub — W1 fills the launch grid + live run cards. The props are
//! final so `app.rs` wiring does not change when the body lands.

use dioxus::prelude::*;

use askk_browser::boot::AgentCard;
use askk_core::RunId;

use crate::ui::dashboard::DashRun;

#[component]
pub fn FleetStage(
    agents: Vec<AgentCard>,
    runs: Vec<DashRun>,
    on_launch: EventHandler<(String, String)>,
    on_cancel: EventHandler<RunId>,
) -> Element {
    // Minimal placeholder: references every prop so the stub compiles clean and
    // shows the surface exists. W1 replaces this body with the real grid/cards.
    let _ = (&on_launch, &on_cancel);
    rsx! {
        div { class: "fleet-wrap",
            p { class: "feat-sub",
                "Launch agents as individual parallel loops — start several, watch them run, "
                "cancel any. Each launch is its own background run (delegation still happens "
                "inside a run via the agent's tools)."
            }
            p { class: "feat-stub",
                "{agents.len()} agents available · {runs.len()} runs so far. "
                "Launch grid and live run cards land here."
            }
        }
    }
}
