//! The **traversable fleet panel** — one identical [`InstancePanel`] slot per engine
//! instance.
//!
//! This is the literal realization of the fleet vision: every agent instance the
//! runtime holds gets the *same* panel, and the fleet is just a map over the live
//! [`InstanceCollection`](crate::state::InstanceCollection). [`FleetPanel`] reads the
//! authoritative `Signal<AppSnapshot>`, projects its instances to ordered panel
//! inputs (`spawn`/queue order, one per instance), and renders an
//! [`InstancePanel`](super::instance_panel::InstancePanel) for each. With a single
//! instance the fleet shows exactly one panel — equivalent to today's single-run
//! view; with many, the same slot repeats down the column.
//!
//! Each panel reads ONLY its own instance's projection (read-only), so the fleet is
//! free of cross-instance coupling: rendering N instances is N independent paints of
//! the identical component.
//!
//! The telemetry tree view ([`FleetView`](crate::runtime::FleetView) /
//! `FleetNode`) is a sibling concern (the watcher-supervised thread tree); it lives
//! in [`crate::runtime::fleet`] and wires into its own surface when the live
//! telemetry feed lands. This panel is the *agent-instance* face and maps over
//! `AppSnapshot.instances()`.

use dioxus::prelude::*;

use super::instance_panel::InstancePanel;
use super::instance_panel::view::{PanelInputs, panel_inputs};
use crate::state::AppSnapshot;

/// Soft-desk styling for the fleet surface — injected at the top of [`FleetPanel`].
const FLEET_CSS: Asset = asset!("/assets/pages/fleet.css");

/// The fleet panel: one [`InstancePanel`] per live engine instance, mapped over the
/// snapshot's [`InstanceCollection`](crate::state::InstanceCollection) in spawn order.
///
/// Reads the live `Signal<AppSnapshot>` and re-paints when it changes. The header
/// counts live vs. total instances; the body renders the per-instance slots.
#[component]
pub fn FleetPanel(snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    let collection = current.instances();

    // Project the collection to ordered panel inputs — one per instance, in queue
    // order. The instances themselves (carrying the reducer/control) are cloned for
    // the panels; the inputs drive the count summary and the empty-state.
    let inputs: Vec<PanelInputs> = panel_inputs(collection);
    let total = inputs.len();
    let live = inputs.iter().filter(|p| !p.status.is_terminal()).count();
    let instances: Vec<_> = collection.iter().cloned().collect();

    rsx! {
        document::Stylesheet { href: FLEET_CSS }
        section { class: "panel page-panel fleet-page",
            div { class: "page-heading",
                div {
                    h2 { "Fleet" }
                }
                div { class: "fleet-counts",
                    span { class: "fleet-count-live", "{live} live" }
                    span { class: "fleet-count-total", "{total} total" }
                }
            }

            div { class: "fleet-instances scroll-area",
                if instances.is_empty() {
                    div { class: "empty-state", "No agent instances yet." }
                } else {
                    // One identical slot per instance, in collection (spawn/queue)
                    // order. Each panel reads only its own projection.
                    for instance in instances {
                        InstancePanel {
                            key: "{instance.id}",
                            instance,
                            live_controls: true,
                        }
                    }
                }
            }
        }
    }
}
