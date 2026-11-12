//! The main window. Closing it hides it: the app stays in the menu bar.
use crate::core::surfaces::Window;
use crate::ui::web::app::GOTO;
use dioxus::desktop::{window, Config, LogicalSize, WindowBuilder, WindowCloseBehaviour};
use dioxus::prelude::*;

/// The window before the host has answered: the defaults.
pub fn config() -> Config {
    let w = Window::default();
    Config::new()
        .with_window(WindowBuilder::new().with_title(&w.title).with_inner_size(LogicalSize::new(w.width as f64, w.height as f64)))
        .with_close_behaviour(WindowCloseBehaviour::WindowHides)
}

/// Apply `window` once the host has answered.
pub fn use_window(w: &Window) {
    let w = w.clone();
    use_hook(move || {
        let win = window();
        win.set_title(&w.title);
        win.set_inner_size(LogicalSize::new(w.width as f64, w.height as f64));
        if w.page != "/" {
            *GOTO.write() = Some(w.page);
        }
    });
}

/// Bring the window forward on `page`.
pub fn show(page: &str) {
    let win = window();
    win.set_visible(true);
    win.set_focus();
    *GOTO.write() = Some(page.to_string());
}
