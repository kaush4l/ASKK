//! `Terminal` — the Alpine workspace (plan, "UI shape": the one component with
//! no Python counterpart). It owns the command you are typing and nothing
//! else; the scrollback is the core's projection of the `exec` facts (I8), so
//! it is the same list whether the agent ran the command or you did, and it is
//! still there after a reload.
//!
//! The credit to Leaning Tech is part of this pane, not a footnote: the
//! CheerpX Community Licence's action point is "give appropriate credits", and
//! the engine is what this pane is a window onto.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

/// A command runs in the async half, so the pane re-reads until the scrollback
/// grows. 700 ms: a person is watching, not racing. `MAX_TICKS` is generous
/// because the FIRST command streams a disk image over the network.
const TICK_MS: i32 = 700;
const MAX_TICKS: usize = 430; // ~5 minutes

/// How many commands the scrollback holds, off the pane's own attribute — the
/// core counts them, this only reads the number back.
fn commands_in(html: &str) -> usize {
    html.split_once("data-commands=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .and_then(|(n, _)| n.parse().ok())
        .unwrap_or(0)
}

/// Re-read the scrollback from the core, for the SELECTED agent (10 walk,
/// finding 3): this was the one per-agent read that sent no `x-agent`.
///
/// The second return is whether a command TYPED here would run in the
/// workspace this pane names — the core's own answer, on a header, because the
/// box was live for every agent while always executing in this page's own
/// space (11b walk).
fn scrollback(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> (String, bool) {
    let Some(app) = web.peek().clone() else {
        return (String::new(), false);
    };
    let res = app.handle(Request::get("/terminal").with_header("x-agent", agent));
    let typeable = res.headers.iter().any(|(k, v)| k == "x-typeable" && v == "1");
    (res.body, typeable)
}

/// Put the newest output where it can be read (10 walk, finding 1): the pane
/// is a fixed-height scroller and nothing ever moved it, so a command's answer
/// was LESS visible after it finished than while it ran — 1300px below the
/// fold, with `scrollTop` still 0. Not application logic (I5): it is a scroll
/// position, and it is set from Rust.
///
/// Takes the element now: the conversation became a scroller of its own in
/// 12c (the primary column is the height of the viewport), and it has exactly
/// this problem for exactly this reason.
pub(crate) fn show_newest(id: &str) {
    if let Some(pane) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id(id))
    {
        pane.set_scroll_top(pane.scroll_height());
    }
}

#[component]
pub fn Terminal(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
) -> Element {
    let mut panel = use_signal(String::new);
    let mut draft = use_signal(String::new);
    let mut running = use_signal(|| false);
    let mut typeable = use_signal(|| false);
    use_effect(move || {
        let _ = (tick(), agent());
        let (body, can_type) = scrollback(&web, &agent());
        panel.set(body);
        typeable.set(can_type);
    });
    let mut submit = move || {
        let command = draft().trim().to_string();
        if command.is_empty() || running() || !typeable() {
            return;
        }
        let Some(app) = web.peek().clone() else { return };
        let before = commands_in(&panel.peek().clone());
        draft.set(String::new());
        running.set(true);
        panel.set(
            app.handle(
                Request::post_form("/terminal", &[("command", &command)])
                    .with_header("x-agent", &agent()),
            )
            .body,
        );
        spawn(async move {
            // The echoed "running…" is at the bottom of the scrollback too.
            let _ = sleep(30).await;
            show_newest("terminal");
            // Watch until the command COUNT rises — not until the pane stops
            // changing. A first boot streams a disk over the network and can
            // take a minute; "the pane looks the same as last tick" is true
            // for every one of those ticks, and stopping on it would replace
            // the "running…" line with an empty scrollback and give up.
            for _ in 0..MAX_TICKS {
                if sleep(TICK_MS).await.is_err() {
                    break;
                }
                let (next, _) = scrollback(&web, &agent());
                if commands_in(&next) > before {
                    panel.set(next);
                    // The DOM catches up on the next frame; then scroll, or
                    // the output that just arrived stays below the fold.
                    let _ = sleep(30).await;
                    show_newest("terminal");
                    break;
                }
            }
            running.set(false);
        });
    };
    rsx! {
        section { class: "panel", aria_label: "Workspace terminal",
            h2 { "Workspace" }
            div { aria_live: "polite", dangerous_inner_html: "{panel}" }
            form {
                class: "oneline",
                onsubmit: move |e| {
                    e.prevent_default();
                    submit();
                },
                input {
                    r#type: "text",
                    value: "{draft}",
                    aria_label: "Command to run in the workspace",
                    placeholder: "uname -a",
                    autocomplete: "off",
                    disabled: running() || !typeable(),
                    oninput: move |e| draft.set(e.value()),
                }
                button {
                    r#type: "submit",
                    disabled: running() || !typeable(),
                    if running() { "Running…" } else { "Run" }
                }
            }
            // Six lines of explanation above two lines of shell output was the
            // worst of the three (12b walk, finding D2). The credit is part of
            // the pane and stays a credit — one click, every word.
            details { class: "panel-note",
                summary { "What runs these commands" }
                p { class: "note credit",
                    "The Linux runs on "
                    a { href: "https://cheerpx.io/", rel: "noopener", "CheerpX" }
                    " by Leaning Tech, loaded from their CDN under the CheerpX Community \
                     Licence, with the Alpine disk image published by the WebVM project."
                }
            }
        }
    }
}
