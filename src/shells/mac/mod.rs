//! # The Mac shell
//!
//! A window on the running host (`ASKK_HOST`, see `core/places.rs`) plus the Mac's own faces.
//! Each face is one file; what it shows comes from the host's `surfaces.json`.
//!
//! | file | face | shows |
//! | --- | --- | --- |
//! | `window.rs` | the main window | `window.page`, `window.title`, size |
//! | `tray.rs` | the menu-bar icon | `tray.number` beside it; `tray.items` as its menu |
//! | `dock.rs` | the Dock icon | `dock.badge` |
//! | `notch.rs` | a panel on the notch | `notch.page`, bare |
//! | `companion.rs` | a character in a corner, and its chat bubble | its mood; `companion.place`, `size`, `engine`, `bubble` |
mod companion;
mod dock;
mod notch;
mod tray;
mod window;

use crate::api::{changes, glance, surfaces};
use crate::core::surfaces::{Glance, Surfaces};
use crate::ui::web::app::{Assets, Route};
use dioxus::prelude::*;

pub fn launch() {
    let host: &'static str = Box::leak(crate::core::places::host_url().into_boxed_str());
    dioxus::fullstack::set_server_url(host);
    dioxus::LaunchBuilder::desktop().with_cfg(window::config()).launch(MacApp);
}

#[component]
fn MacApp() -> Element {
    // What the faces show is the host's data. A host that is away or a bad file: the defaults.
    let cfg = use_resource(|| async { surfaces().await.unwrap_or_default() });
    // The companion has windows of its own here, so no page draws one.
    use_context_provider(|| crate::ui::web::views::companion::Outside);
    let mut numbers = use_signal(Glance::default);
    // Count again whenever the host marks a change (the same live feed the pages use).
    use_future(move || async move {
        let (mut epoch, mut seen) = (0u64, 0u64);
        loop {
            if let Ok(g) = glance().await {
                if *numbers.peek() != g {
                    numbers.set(g);
                }
            }
            match changes(epoch, seen).await {
                Ok(c) => (epoch, seen) = (c.epoch, c.seq),
                Err(_) => {
                    let _ = document::eval("await new Promise(r => setTimeout(r, 2000)); return 0;").await;
                }
            }
        }
    });
    rsx! {
        Assets {}
        // Pages wait for the host inside their own boundary, so the faces below are never
        // drawn twice while a page loads.
        SuspenseBoundary { fallback: |_| rsx! {}, Router::<Route> {} }
        if let Some(s) = cfg() {
            Faces { surfaces: s, numbers: numbers() }
        }
    }
}

/// Applies `surfaces.json` to every face. Draws nothing itself.
#[component]
fn Faces(surfaces: Surfaces, numbers: Glance) -> Element {
    window::use_window(&surfaces.window);
    tray::use_tray(&surfaces.tray, &numbers);
    dock::use_badge(&surfaces.dock, &numbers);
    notch::use_notch(&surfaces.notch);
    // The companion is not drawn for now (a novelty; `companion.rs` keeps it).
    let _ = companion::use_companion;
    rsx! {}
}
