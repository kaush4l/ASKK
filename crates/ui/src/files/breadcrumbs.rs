//! WHICH FOLDER THE FILES PANE IS ON (R16-P1-4). `files/mod.rs` owns the
//! folder, its watcher and the editor: WHERE you are and WHAT IS THERE are two
//! things to say, and only the first is also a trail you can walk back up.
//!
//! Pressing `report/` listed `..` and `c.md` under a rail still headed
//! `workspace files · main`, and nothing on screen named the folder — two
//! levels down there was no telling where you were.

use dioxus::prelude::*;

use crate::ui::Button;
use crate::shell::views::View;

/// The trail: each crumb is the name to show and the path opening it means, the
/// same pair `listing::Entry` carries, so a segment is pressed with the handler
/// the rows are. `..` is already the manual way up, and a breadcrumb that
/// cannot navigate is decoration. The root's name is `core::files::empty_states::named`'s word
/// for it, so the pane and the core's own empty states call it one thing.
pub(crate) fn trail(at: &str) -> Vec<(String, String)> {
    let mut crumbs = vec![("the folder".to_string(), ".".to_string())];
    let mut path = String::new();
    for name in at.trim_start_matches("./").trim_matches('/').split('/') {
        if name.is_empty() || name == "." {
            continue;
        }
        path = match path.is_empty() {
            true => name.to_string(),
            false => format!("{path}/{name}"),
        };
        crumbs.push((name.to_string(), path.clone()));
    }
    crumbs
}

/// …on screen, as `the workspace / report`. `.crumb` is the row the design
/// system already has for "where you are" (`DesignCrumb` below), and
/// `.file-entry` is the row this pane's own entries wear: a crumb opens a
/// folder, which is what a row does.
#[component]
pub(crate) fn Crumbs(at: String, on_open: EventHandler<String>) -> Element {
    let here = at.clone();
    rsx! {
        p { class: "crumb", aria_label: "Which folder this panel is on",
            for (i, (name, path)) in trail(&here).into_iter().enumerate() {
                span { key: "{path}",
                    if i > 0 { "/ " }
                    button {
                        class: "file-entry",
                        aria_current: (path == at).then_some("true"),
                        onclick: move |_| on_open.call(path.clone()),
                        "{name}"
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_trail_names_every_folder_you_are_inside() {
        assert_eq!(super::trail("."), [("the folder".into(), ".".into())]);
        let deep = super::trail("report/notes");
        assert_eq!(deep.len(), 3, "{deep:?}");
        assert_eq!(deep[1], ("report".to_string(), "report".to_string()));
        // The path opening it means is the WHOLE path, not the segment.
        assert_eq!(deep[2], ("notes".to_string(), "report/notes".to_string()));
    }
}

/// WHERE YOU ARE while the gallery is open (F20).
#[component]
pub(crate) fn DesignCrumb(view: Signal<View>) -> Element {
    rsx! {
        p { class: "crumb",
            Button {
                variant: "ghost",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Settings);
                },
                "← Settings"
            }
            span { " / Design system" }
        }
    }
}
