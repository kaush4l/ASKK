//! The companion where a shell puts it: in the page, or in windows of its own.
//!
//! | piece | what it is |
//! | --- | --- |
//! | [`CompanionView`] | the character with its live mood; a click calls `onpoke` |
//! | [`PageCompanion`] | character and bubble inside the page (browser, phone) |
//! | [`CharacterFace`], [`BubbleFace`] | each alone, as the root of a window a shell opens (Mac) |
//!
//! The mood is decided in `core/companion.rs`; the drawing is `components/companion.rs`.
use super::bubble::BubbleView;
use super::live::{use_live, use_live_provider, use_live_server, use_manifest, Live};
use crate::api::{glance, surfaces};
use crate::core::companion::{beat, mood, Beat};
use crate::ui::app::Assets;
use crate::ui::components::Companion;
use dioxus::prelude::*;

/// Provided by a shell that holds the companion in windows of its own: the page draws none.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
#[derive(Clone, Copy)]
pub struct Outside;

/// What closing the bubble does, provided by whoever holds it.
#[derive(Clone, Copy)]
pub struct Dismiss(pub Callback<()>);

/// The character at `size`, its mood following the host's numbers. It asks again whenever the
/// host marks a change, and sleeps while the host does not answer.
#[component]
pub fn CompanionView(size: u32, onpoke: Callback<()>) -> Element {
    let live = use_context::<Live>();
    let changed = use_live(String::new);
    let first = use_server_future(glance)?;
    let init = first.peek().as_ref().and_then(|r| r.as_ref().ok()).copied();
    let mut numbers = use_signal(|| init);
    // The beat to play and how many were played (a new count plays it again).
    let mut played = use_signal(|| (0u32, None::<Beat>));
    use_effect(move || {
        let _ = (changed(), live.away());
        spawn(async move {
            let now = glance().await.ok();
            let before = *numbers.peek();
            if before != now {
                if let Some(b) = beat(before, now) {
                    let n = played.peek().0 + 1;
                    played.set((n, Some(b)));
                }
                numbers.set(now);
            }
        });
    });
    let m = mood(if live.away() { None } else { numbers() });
    let (n, b) = played();
    rsx! {
        button { class: "companion-btn", r#type: "button", title: "askk is {m.name()}", "aria-label": "Chat with askk. It is {m.name()}.",
            onclick: move |_| onpoke.call(()),
            Companion { key: "{n}", mood: m, beat: b, size }
        }
    }
}

/// The companion inside the page: the character in its corner, the bubble opening beside it.
/// Draws nothing when `surfaces.json` turns it off or a shell holds it outside ([`Outside`]).
#[component]
pub fn PageCompanion() -> Element {
    let outside = try_use_context::<Outside>().is_some();
    let key = use_manifest().surfaces;
    let cfg = use_live_server(move || key.clone(), surfaces)?;
    let mut open = use_signal(|| false);
    use_context_provider(|| Dismiss(Callback::new(move |_| open.set(false))));
    let c = cfg().map(|s| s.companion).unwrap_or_default();
    if outside || !c.on {
        return rsx! {};
    }
    rsx! {
        div { class: "companion-dock {c.place.name()}", style: "--bubble-w:{c.bubble.width}px;--bubble-h:{c.bubble.height}px;--companion:{c.size}px",
            if open() {
                BubbleView { engine: c.engine.clone() }
            }
            CompanionView { size: c.size, onpoke: move |_| open.toggle() }
        }
    }
}

/// The character alone, as the root of its own window.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
#[component]
pub fn CharacterFace(size: u32, onpoke: Callback<()>) -> Element {
    rsx! {
        Stage {
            div { class: "companion-stage", CompanionView { size, onpoke } }
        }
    }
}

/// The bubble alone, as the root of its own window; `onclose` is what Esc and × do.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
#[component]
pub fn BubbleFace(engine: String, onclose: Callback<()>) -> Element {
    use_context_provider(|| Dismiss(onclose));
    rsx! {
        Stage {
            div { class: "companion-stage solid", BubbleView { engine } }
        }
    }
}

/// What a window without the shell layout needs: assets, the live feed, the manifest, the
/// theme, and a clear background.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
#[component]
fn Stage(children: Element) -> Element {
    use_live_provider();
    let mf = use_server_future(crate::api::manifest)?;
    let m = mf.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    use_context_provider(|| m.clone());
    let kt = m.theme.clone();
    let theme = use_live_server(move || kt.clone(), crate::api::theme)?;
    let vars: String = theme.read().as_ref().map(|m| m.iter().map(|(k, v)| format!("{k}:{v};")).collect()).unwrap_or_default();
    rsx! {
        Assets {}
        // `!important`: the stylesheet paints `body` with the theme's wall, and which of the
        // two rules comes later in the page is not ours to order.
        document::Style { ":root{{{vars}}} html,body{{background:transparent !important;margin:0;overflow:hidden}}" }
        SuspenseBoundary { fallback: |_| rsx! {}, {children} }
    }
}
