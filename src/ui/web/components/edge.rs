//! The edge of the panel beside a conversation: dragged, or moved with the arrow keys, to make
//! the panel wider or narrower. It is given the width and says the next one; keeping it is the
//! view's to do.
use dioxus::prelude::*;

/// How wide the panel beside a conversation may be made, in pixels, and how far an arrow key
/// moves its edge. The stylesheet also keeps it within part of the screen.
pub const SIDE_WIDTH: (u32, u32, u32) = (300, 760, 24);

/// The width a pointer at `x` drags the panel to, when it went down at `from` on a panel
/// `start` wide. The edge is on the panel's left, so going left makes it wider.
pub fn side_dragged(start: u32, from: f64, x: f64) -> u32 {
    ((start as f64 + (from - x)).round().max(0.0) as u32).clamp(SIDE_WIDTH.0, SIDE_WIDTH.1)
}

/// `on_width`: the next width, and whether it is the last of this move (to be kept).
#[component]
pub fn SideEdge(width: u32, on_width: EventHandler<(u32, bool)>) -> Element {
    // Where the pointer went down and how wide the panel was then, while it is held.
    let mut held = use_signal(|| None::<(f64, u32)>);
    let (min, max, step) = SIDE_WIDTH;
    rsx! {
        div { class: if held().is_some() { "side-edge is-dragging" } else { "side-edge" }, role: "separator", "aria-orientation": "vertical", tabindex: "0",
            "aria-label": "Width of the panel", "aria-valuenow": "{width}", "aria-valuemin": "{min}", "aria-valuemax": "{max}",
            title: "Drag, or use the arrow keys, to make the panel wider or narrower",
            onpointerdown: move |e| {
                e.prevent_default();
                held.set(Some((e.client_coordinates().x, width)));
            },
            onkeydown: move |e: KeyboardEvent| {
                let to = match e.key() {
                    Key::ArrowLeft => width + step,
                    Key::ArrowRight => width.saturating_sub(step),
                    Key::Home => min,
                    Key::End => max,
                    _ => return,
                };
                e.prevent_default();
                e.stop_propagation();
                on_width.call((to.clamp(min, max), true));
            },
        }
        // While the edge is held, the whole window listens, so the pointer may leave the edge.
        if let Some((from, start)) = held() {
            div { class: "side-drag",
                onpointermove: move |e| on_width.call((side_dragged(start, from, e.client_coordinates().x), false)),
                onpointerup: move |e| {
                    held.set(None);
                    on_width.call((side_dragged(start, from, e.client_coordinates().x), true));
                },
                onpointercancel: move |_| {
                    held.set(None);
                    on_width.call((start, true));
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_edge_on_the_left_widens_as_it_goes_left_and_stays_in_bounds() {
        assert_eq!(side_dragged(400, 800.0, 750.0), 450);
        assert_eq!(side_dragged(400, 800.0, 900.0), 300);
        assert_eq!(side_dragged(400, 800.0, 0.0), SIDE_WIDTH.1);
        assert_eq!(side_dragged(400, 800.0, 790.4), 410);
    }
}
