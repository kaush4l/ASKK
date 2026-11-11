//! The menu-bar icon: a live number beside it, and a menu whose lines open pages.
use crate::core::surfaces::{Glance, Tray};
use dioxus::desktop::trayicon::{
    init_tray_icon,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    Icon, TrayIcon,
};
use dioxus::desktop::use_tray_menu_event_handler;
use std::cell::RefCell;

/// The icon: a plain dot drawn here, so the tray never depends on a bundled image.
fn dot() -> Option<Icon> {
    const N: u32 = 36;
    let c = (N as f32 - 1.0) / 2.0;
    let mut px = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
            let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
            px.extend_from_slice(&[0, 0, 0, if d <= 11.0 { 255 } else { 0 }]);
        }
    }
    Icon::from_rgba(px, N, N).ok()
}

thread_local! {
    /// The one tray item of this process. The Mac removes an item when its handle is dropped,
    /// so it is kept here for as long as the app runs.
    static TRAY: RefCell<Option<TrayIcon>> = const { RefCell::new(None) };
}

pub fn use_tray(tray: &Tray, numbers: &Glance) {
    use_tray_menu_event_handler(move |e| {
        if e.id().0.starts_with('/') {
            super::window::show(&e.id().0);
        }
    });
    TRAY.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_none() && tray.on {
            let menu = Menu::new();
            for it in &tray.items {
                // The line's id is the page it opens.
                let _ = menu.append(&MenuItem::with_id(it.page.clone(), &it.label, true, None));
            }
            let _ = menu.append(&PredefinedMenuItem::separator());
            let _ = menu.append(&PredefinedMenuItem::quit(None));
            let made = init_tray_icon(menu, dot());
            // A template image: macOS tints it for a light or dark menu bar.
            made.set_icon_as_template(true);
            *slot = Some(made);
        }
        if let Some(t) = slot.as_ref() {
            t.set_title(numbers.text(tray.number));
        }
    });
}
