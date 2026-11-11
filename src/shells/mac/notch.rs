//! The notch panel: a borderless, clear window at the top centre of the screen, drawing one
//! page bare (no sidebar, no top bar). `place` says whether it hangs under the menu bar (hides
//! nothing) or sits on it (covers what is beside the notch).
use crate::core::surfaces::{Notch, Place};
use crate::ui::app::{Assets, Bare, Route};
use dioxus::desktop::tao::platform::macos::{WindowBuilderExtMacOS, WindowExtMacOS};
use dioxus::desktop::{window, Config, LogicalPosition, LogicalSize, WindowBuilder};
use dioxus::history::{History, MemoryHistory};
use dioxus::prelude::*;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

/// `NSStatusWindowLevel`: above the menu bar, so the panel can sit on the notch.
const ABOVE_MENU_BAR: isize = 25;

/// Whether this process has made its panel (one per process, whatever is drawn again).
static MADE: AtomicBool = AtomicBool::new(false);

pub fn use_notch(notch: &Notch) {
    let n = notch.clone();
    use_hook(move || {
        if !n.on || MADE.swap(true, Ordering::SeqCst) {
            return;
        }
        spawn(async move {
            let main = window();
            let screen = main.primary_monitor().map(|m| m.size().width as f64 / m.scale_factor()).unwrap_or(1440.0);
            let (w, h) = (n.width as f64, n.height as f64);
            let panel = WindowBuilder::new()
                .with_title("askk notch")
                .with_decorations(false)
                .with_transparent(true)
                .with_always_on_top(true)
                .with_resizable(false)
                .with_visible_on_all_workspaces(true)
                .with_has_shadow(false)
                .with_focused(false)
                .with_inner_size(LogicalSize::new(w, h))
                .with_position(LogicalPosition::new((screen - w) / 2.0, 0.0));
            let x = (screen - w) / 2.0;
            let dom = VirtualDom::new_with_props(Face, FaceProps { page: n.page.clone() });
            let made = main.new_window(dom, Config::new().with_window(panel).with_background_color((0, 0, 0, 0))).await;
            // macOS places a new window just below the menu bar: that is `under`. For `on`, the
            // panel is raised above the menu bar and may then sit at the very top.
            if n.place == Place::On {
                raise(made.ns_window());
                made.set_outer_position(LogicalPosition::new(x, 0.0));
            }
        });
    });
}

/// Put the panel above the menu bar (the library stops at "always on top", which is below it).
fn raise(ns_window: *mut std::ffi::c_void) {
    use objc2::{msg_send, runtime::AnyObject};
    if ns_window.is_null() {
        return;
    }
    // SAFETY: `ns_window` is the live NSWindow of the panel just created, and this runs on the
    // main thread (the UI thread), where AppKit expects window calls.
    unsafe {
        let w = &*(ns_window as *const AnyObject);
        let _: () = msg_send![w, setLevel: ABOVE_MENU_BAR];
    }
}

/// One page, bare, starting at `page`.
#[component]
fn Face(page: String) -> Element {
    use_context_provider(|| Bare);
    use_context_provider(move || Rc::new(MemoryHistory::with_initial_path(page.clone())) as Rc<dyn History>);
    rsx! {
        Assets {}
        Router::<Route> {}
    }
}
