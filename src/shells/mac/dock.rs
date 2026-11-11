//! The Dock icon: its badge is a live number.
use crate::core::surfaces::{Dock, Glance};
use dioxus::desktop::tao::platform::macos::WindowExtMacOS;

pub fn use_badge(dock: &Dock, numbers: &Glance) {
    dioxus::desktop::window().set_badge_label(numbers.text(dock.badge));
}
