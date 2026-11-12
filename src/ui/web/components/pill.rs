use super::{BoxRow, Icon, Shown};
use crate::api::NavLink;
use crate::ui::features::boxes::Mark;
use dioxus::prelude::*;

/// The pill on the left. Folded it is marks only: the brand, one mark per session that is not
/// idle, the pages. Open it is the dashboard: every session with its name and last line, what
/// needs the owner first, then the pages, then who the service is.
///
/// Wide screens: open, and the button in its head folds it. Medium screens: folded. Phones:
/// one floating button that opens it as a sheet. The words stay in the page at every size, for
/// a screen reader.
#[component]
pub fn Pill(
    brand: String,
    /// Every session, in the order a person needs them.
    boxes: Vec<Shown>,
    /// How many carry each mark, in the same order.
    counts: Vec<(Mark, usize)>,
    items: Vec<NavLink>,
    /// One line about the service: who answers, or that nothing does.
    service: String,
    mut collapsed: Signal<bool>,
    mut open: Signal<bool>,
    on_look: EventHandler<String>,
) -> Element {
    let mark = brand.chars().next().map(String::from).unwrap_or_default();
    rsx! {
        button { class: "routes-fab glass-btn", "aria-label": if open() { "Close the dashboard" } else { "Open the dashboard" },
            "aria-expanded": "{open()}", onclick: move |_| open.toggle(),
            Icon { name: if open() { "close" } else { "routes" } }
        }
        if open() { div { class: "scrim", onclick: move |_| open.set(false) } }
        nav { class: if open() { "sidebar pill glass open" } else { "sidebar pill glass" }, "aria-label": "Sessions and pages",
            div { class: "side-head",
                span { class: "brand-mark", "aria-hidden": "true", "{mark}" }
                span { class: "brand-name", "{brand}" }
                button { class: "icon-btn side-toggle", "aria-label": if collapsed() { "Open the dashboard" } else { "Fold the dashboard" },
                    "aria-pressed": "{collapsed()}", title: if collapsed() { "Open the dashboard" } else { "Fold the dashboard" },
                    onclick: move |_| collapsed.toggle(),
                    Icon { name: "sidebar" }
                }
            }
            div { class: "pill-part pill-pages",
                for item in items {
                    Link { to: item.to.clone(), class: "nav-item", active_class: "active", onclick: move |_| open.set(false),
                        Icon { name: item.icon.clone() }
                        span { class: "label", "{item.label}" }
                        span { class: "tip", "aria-hidden": "true", "{item.label}" }
                    }
                }
            }
            div { class: "pill-part pill-boxes", role: "group", "aria-label": "Sessions",
                p { class: "pill-head label",
                    span { "Sessions" }
                    span { class: "pill-counts",
                        for (m, n) in counts.iter().filter(|(m, _)| *m != Mark::Idle) {
                            span { key: "{m.key()}", class: "pill-count is-{m.key()}", title: "{n} {m.word()}", "{m.sign()} {n}" }
                        }
                    }
                }
                for s in boxes {
                    BoxRow { key: "{s.b.id}", shown: s, on_look: move |id| { open.set(false); on_look.call(id) } }
                }
            }
            p { class: "pill-foot label", "{service}" }
        }
    }
}
