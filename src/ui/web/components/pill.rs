use super::{BoxRow, Icon, Shown};
use crate::api::NavLink;
use crate::ui::features::boxes::{by_place, found, place_word, Mark};
use dioxus::prelude::*;

/// How wide the open pill may be dragged, in pixels, and how far an arrow key moves its edge.
pub const PILL_WIDTH: (u32, u32, u32) = (208, 480, 16);

/// The width a pointer at `x` (pixels from the window's left edge) drags the pill to. The
/// pill starts one gutter in from the edge.
fn dragged(x: f64) -> u32 {
    const GUTTER: f64 = 12.0;
    ((x - GUTTER).round().max(0.0) as u32).clamp(PILL_WIDTH.0, PILL_WIDTH.1)
}

/// The pill on the left. Folded it is marks only: the brand, one mark per session that is not
/// idle, the pages. Open it is the dashboard: every session with its name and last line, what
/// needs the owner first, then the pages, then who the service is.
///
/// Wide screens: open, and the button in its head folds it; its right edge can be dragged
/// (or moved with the arrow keys) to make it wider. Medium screens: folded. Phones: one
/// floating button that opens it as a sheet. The words stay in the page at every size, for a
/// screen reader. The arrow keys move from row to row.
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
    /// The id of the box open on the canvas, if one is.
    #[props(default)] open_box: String,
    /// Whether the sessions are shown in groups by their place.
    #[props(default)] grouped: bool,
    /// The pill's width when open, in pixels.
    #[props(default = 256)] width: u32,
    mut collapsed: Signal<bool>,
    mut open: Signal<bool>,
    on_look: EventHandler<String>,
    on_group: EventHandler<bool>,
    /// The edge was moved: `(the new width, true once it was let go)`.
    on_width: EventHandler<(u32, bool)>,
) -> Element {
    let mark = brand.chars().next().map(String::from).unwrap_or_default();
    let mut find = use_signal(String::new);
    let mut dragging = use_signal(|| false);
    let typed = find();
    let total = boxes.len();
    let shown: Vec<Shown> = boxes.into_iter().filter(|s| found(&s.b, &typed)).collect();
    let none = shown.is_empty() && total > 0;
    let groups = if grouped { by_place(shown, |s| s.b.place.clone()) } else { vec![(String::new(), shown)] };
    rsx! {
        button { class: "routes-fab glass-btn", "aria-label": if open() { "Close the dashboard" } else { "Open the dashboard" },
            "aria-expanded": "{open()}", onclick: move |_| open.toggle(),
            Icon { name: if open() { "close" } else { "routes" } }
        }
        if open() { div { class: "scrim", onclick: move |_| open.set(false) } }
        nav { class: if open() { "sidebar pill glass open" } else { "sidebar pill glass" }, "aria-label": "Sessions and pages",
            // Up and down move from row to row, so the list is one stop for Tab.
            onkeydown: move |e: KeyboardEvent| {
                let down = match e.key() {
                    Key::ArrowDown => true,
                    Key::ArrowUp => false,
                    _ => return,
                };
                e.prevent_default();
                document::eval(&format!(
                    "const nav = document.querySelector('nav.pill'); if (nav) {{ const rows = [...nav.querySelectorAll('a.nav-item, #pill-find')].filter(e => e.offsetParent !== null); const i = rows.indexOf(document.activeElement); if (i >= 0) {{ const n = rows[(i + ({down} ? 1 : rows.length - 1)) % rows.length]; if (n) n.focus(); }} }}"
                ));
            },
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
                div { class: "pill-tools label",
                    label { class: "pill-find",
                        Icon { name: "search", size: 14 }
                        span { class: "visually-hidden", "Find a session" }
                        input { id: "pill-find", r#type: "search", placeholder: "Find", value: "{find}", "autocomplete": "off", oninput: move |e| find.set(e.value()) }
                    }
                    button { class: if grouped { "icon-btn pill-group is-on" } else { "icon-btn pill-group" }, r#type: "button", "aria-pressed": "{grouped}",
                        "aria-label": "Group the sessions by place", title: if grouped { "Grouped by place. Press for one list." } else { "Group by place" },
                        onclick: move |_| on_group.call(!grouped),
                        Icon { name: "folder", size: 16 }
                    }
                }
                if none { p { class: "pill-none label", role: "status", "No session answers “{typed}”." } }
                for (place, rows) in groups {
                    if grouped { p { key: "place-{place}", class: "pill-place label", "{place_word(&place)}" } }
                    for s in rows {
                        BoxRow { key: "{s.b.id}", open: s.b.id == open_box, shown: s, on_look: move |id| { open.set(false); on_look.call(id) } }
                    }
                }
            }
            p { class: "pill-foot label", "{service}" }
            // The edge that is dragged to make the pill wider (wide screens only).
            div { class: if dragging() { "pill-edge is-dragging" } else { "pill-edge" }, role: "separator", "aria-orientation": "vertical", tabindex: "0",
                "aria-label": "Width of the pill", "aria-valuenow": "{width}", "aria-valuemin": "{PILL_WIDTH.0}", "aria-valuemax": "{PILL_WIDTH.1}",
                title: "Drag to make the pill wider or narrower",
                onpointerdown: move |e| {
                    e.prevent_default();
                    dragging.set(true);
                },
                onkeydown: move |e: KeyboardEvent| {
                    let to = match e.key() {
                        Key::ArrowLeft => width.saturating_sub(PILL_WIDTH.2),
                        Key::ArrowRight => width + PILL_WIDTH.2,
                        _ => return,
                    };
                    e.prevent_default();
                    e.stop_propagation();
                    on_width.call((to.clamp(PILL_WIDTH.0, PILL_WIDTH.1), true));
                },
            }
        }
        // While the edge is held, the whole window listens, so the pointer may leave the edge.
        if dragging() {
            div { class: "pill-drag",
                onpointermove: move |e| on_width.call((dragged(e.client_coordinates().x), false)),
                onpointerup: move |e| {
                    dragging.set(false);
                    on_width.call((dragged(e.client_coordinates().x), true));
                },
                onpointercancel: move |_| dragging.set(false),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pill_is_dragged_between_its_narrowest_and_widest() {
        assert_eq!(dragged(300.0), 288);
        assert_eq!(dragged(-40.0), PILL_WIDTH.0);
        assert_eq!(dragged(50.0), PILL_WIDTH.0);
        assert_eq!(dragged(5000.0), PILL_WIDTH.1);
    }
}
