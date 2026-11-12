//! Commands: the keys that work anywhere in a window, and "go to anything".
//!
//! The shell places this once. It hears the keys (`ui/features/keys.rs` says which, and what
//! each does), opens the list of every box, page and action (`ui/features/palette.rs`) or
//! the list of shortcuts, and does what was chosen. What belongs to the shell (folding the
//! pill, the theme, closing what is open) is handed back to it.
use super::boxes::{from_tile, Boxes};
use crate::api::NavLink;
use crate::ui::features::boxes::link;
use crate::ui::features::keys::{act, listener, Act, Press};
use crate::ui::features::palette::{entries, Pick, Sources};
use crate::ui::web::components::{Palette, Shortcuts};
use dioxus::prelude::*;

/// Put the cursor in the message box of the page: the composer, else a box's own line.
fn compose() {
    document::eval("const f = document.getElementById('composer') || document.querySelector('.canvas-tiles:not([inert]) .box-say-line'); if (f) f.focus();");
}

/// `links`: the pages. `light`: the theme in use. `collapsed`: the pill, folded or not.
/// `modal`: set while one of the two lists is open, so the shell can hold the page still.
/// `on_theme`: switch the theme. `on_close`: Escape was pressed with neither list open.
#[component]
pub fn Commands(links: Vec<NavLink>, light: bool, mut collapsed: Signal<bool>, mut modal: Signal<bool>, on_theme: EventHandler<()>, on_close: EventHandler<()>) -> Element {
    let mut boxes = use_context::<Boxes>();
    let mut palette = use_signal(|| false);
    let mut help = use_signal(|| false);
    let mut mac = use_signal(|| false);
    let mut wrong = use_signal(String::new);
    let kinds = use_resource(crate::api::harnesses);
    use_effect(move || {
        let open = palette() || help();
        if *modal.peek() != open {
            modal.set(open);
        }
    });
    // Hear the keys, for as long as the window is there.
    use_future(move || async move {
        if let Ok(m) = document::eval("return /Mac|iPhone|iPad/.test(navigator.platform);").await {
            mac.set(m.as_bool().unwrap_or(false));
        }
        let mut heard = document::eval(&listener());
        while let Ok((key, with_mod, typing)) = heard.recv::<(String, bool, bool)>().await {
            match act(&Press { key, with_mod, typing }) {
                Some(Act::Palette) => {
                    help.set(false);
                    palette.toggle();
                }
                Some(Act::Help) => {
                    palette.set(false);
                    help.toggle();
                }
                Some(Act::FoldPill) => collapsed.toggle(),
                Some(Act::Compose) => compose(),
                Some(Act::Close) if palette() || help() => {
                    palette.set(false);
                    help.set(false);
                }
                Some(Act::Close) => on_close.call(()),
                None => {}
            }
        }
    });
    let sources = Sources {
        boxes: boxes.shown().into_iter().map(|s| (s.b.id.clone(), s.b.title.clone(), format!("{} · {}", s.b.kind, s.mark.word()))).collect(),
        pages: links.iter().map(|l| (l.label.clone(), l.to.clone())).collect(),
        harnesses: kinds.read().as_ref().and_then(|r| r.as_ref().ok()).map(|k| k.iter().filter(|k| k.missing.is_empty()).map(|k| k.kind.clone()).collect()).unwrap_or_default(),
        light,
        folded: collapsed(),
        mac: mac(),
    };
    let go = navigator();
    rsx! {
        Palette { open: palette(), entries: entries(&sources), on_close: move |_| palette.set(false),
            on_pick: move |pick: Pick| {
                palette.set(false);
                match pick {
                    Pick::Box(id) => {
                        from_tile(&id);
                        go.push(link(&id));
                    }
                    Pick::Page(to) => {
                        go.push(to);
                    }
                    Pick::FoldPill => collapsed.toggle(),
                    Pick::Theme => on_theme.call(()),
                    Pick::Keys => help.set(true),
                    Pick::Idle => boxes.idle_too.toggle(),
                    Pick::Session(kind) => {
                        spawn(async move {
                            match crate::api::session_open(kind, String::new(), String::new()).await {
                                Ok(s) => {
                                    go.push(link(&format!("session:{}", s.id)));
                                }
                                Err(e) => wrong.set(e.to_string()),
                            }
                        });
                    }
                }
            },
        }
        Shortcuts { open: help(), mac: mac(), on_close: move |_| help.set(false) }
        if !wrong.read().is_empty() { p { class: "command-wrong", role: "alert", onclick: move |_| wrong.set(String::new()), "{wrong}" } }
    }
}
