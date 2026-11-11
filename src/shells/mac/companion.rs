//! The companion: the character in a small clear window of its own, on every Space, above
//! other windows, that can never take the keyboard. A click opens the chat bubble in a second
//! window beside it; a second click, Esc or × hides it again.
//!
//! What it draws is `ui/views/companion.rs`; where, how big and which engine is the
//! `companion` value of `surfaces.json`.
use crate::core::surfaces::{Companion, Corner};
use crate::ui::views::companion::{BubbleFace, CharacterFace};
use dioxus::desktop::tao::platform::macos::WindowBuilderExtMacOS;
use dioxus::desktop::{window, Config, DesktopContext, LogicalPosition, LogicalSize, WindowBuilder};
use dioxus::prelude::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// Space kept between the character, the screen's edge and the bubble, in points.
const GAP: f64 = 16.0;

/// Whether this process has made its character (one per process, whatever is drawn again).
static MADE: AtomicBool = AtomicBool::new(false);

pub fn use_companion(companion: &Companion) {
    let c = companion.clone();
    use_hook(move || {
        if !c.on || MADE.swap(true, Ordering::SeqCst) {
            return;
        }
        spawn(async move {
            let (x, y) = spot(&c);
            let s = c.size as f64;
            // Not focusable: it cannot become the key window, so it never interrupts typing
            // elsewhere. A click still reaches it.
            let character = clear("askk companion").with_has_shadow(false).with_focused(false).with_focusable(false).with_inner_size(LogicalSize::new(s, s)).with_position(LogicalPosition::new(x, y));
            let dom = VirtualDom::new_with_props(Character, CharacterProps { c });
            window().new_window(dom, Config::new().with_window(character).with_background_color((0, 0, 0, 0))).await;
        });
    });
}

/// A clear, frameless window above the others, on every Space.
fn clear(title: &str) -> WindowBuilder {
    WindowBuilder::new().with_title(title).with_decorations(false).with_transparent(true).with_always_on_top(true).with_resizable(false).with_visible_on_all_workspaces(true)
}

/// The part of the main screen left free by the menu bar and the Dock, in points from the top
/// left: (left, top, right, bottom).
fn free_area() -> (f64, f64, f64, f64) {
    use objc2::encode::{Encode, Encoding};
    use objc2::{class, msg_send, runtime::AnyObject};
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }
    // SAFETY: the same layout and encoding as `CGRect` (a point and a size, four doubles).
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]), Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING])]);
    }
    // SAFETY: called on the main thread (the UI thread), where AppKit expects screen calls.
    // Both messages return an object or nil, and nil is checked before it is used.
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let first: *mut AnyObject = if screens.is_null() { std::ptr::null_mut() } else { msg_send![screens, firstObject] };
        if first.is_null() {
            return (0.0, 25.0, 1440.0, 900.0);
        }
        let whole: Rect = msg_send![first, frame];
        let free: Rect = msg_send![first, visibleFrame];
        // AppKit measures from the bottom left; windows are placed from the top left.
        (free.x, whole.h - (free.y + free.h), free.x + free.w, whole.h - free.y)
    }
}

/// Where the character's window goes: its corner of the free area.
fn spot(c: &Companion) -> (f64, f64) {
    let (left, top, right, bottom) = free_area();
    let s = c.size as f64;
    let x = match c.place {
        Corner::BottomRight | Corner::TopRight => right - s - GAP,
        Corner::BottomLeft | Corner::TopLeft => left + GAP,
    };
    let y = match c.place {
        Corner::BottomRight | Corner::BottomLeft => bottom - s - GAP,
        Corner::TopRight | Corner::TopLeft => top + GAP,
    };
    (x, y)
}

/// Where the bubble's window goes: beside the character, towards the middle of the screen.
fn beside(c: &Companion) -> (f64, f64) {
    let (left, top, _, _) = free_area();
    let (x, y) = spot(c);
    let (s, w, h) = (c.size as f64, c.bubble.width as f64, c.bubble.height as f64);
    let bx = match c.place {
        Corner::BottomRight | Corner::TopRight => x + s - w,
        Corner::BottomLeft | Corner::TopLeft => x,
    };
    let by = match c.place {
        Corner::BottomRight | Corner::BottomLeft => y - GAP / 2.0 - h,
        Corner::TopRight | Corner::TopLeft => y + s + GAP / 2.0,
    };
    (bx.max(left), by.max(top))
}

/// The character's window: the drawing, and what a click on it does.
#[component]
fn Character(c: Companion) -> Element {
    let size = c.size;
    let me = window();
    // The bubble's window once made, and whether it is being made (a click then changes nothing).
    let mut panel = use_signal(|| None::<DesktopContext>);
    let mut making = use_signal(|| false);
    let onpoke = use_callback(move |_: ()| {
        if let Some(p) = panel.peek().as_ref() {
            let show = !p.is_visible();
            p.set_visible(show);
            if show {
                p.set_focus();
            }
            return;
        }
        if *making.peek() {
            return;
        }
        making.set(true);
        let (c, me) = (c.clone(), me.clone());
        spawn(async move {
            let (x, y) = beside(&c);
            let bubble = clear("askk bubble").with_has_shadow(true).with_inner_size(LogicalSize::new(c.bubble.width as f64, c.bubble.height as f64)).with_position(LogicalPosition::new(x, y));
            let dom = VirtualDom::new_with_props(Panel, PanelProps { engine: c.engine.clone() });
            let made = me.new_window(dom, Config::new().with_window(bubble).with_background_color((0, 0, 0, 0))).await;
            made.set_focus();
            panel.set(Some(made));
        });
    });
    rsx! {
        CharacterFace { size, onpoke }
    }
}

/// The bubble's window: the chat; closing hides the window (the conversation stays).
#[component]
fn Panel(engine: String) -> Element {
    let me = window();
    let onclose = use_callback(move |_: ()| me.set_visible(false));
    rsx! {
        BubbleFace { engine, onclose }
    }
}
