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

/// Re-read the scrollback from the core.
fn scrollback(web: &Signal<Option<Rc<WebApp>>>) -> String {
    match web.peek().clone() {
        Some(app) => app.handle(Request::get("/terminal")).body,
        None => String::new(),
    }
}

#[component]
pub fn Terminal(web: Signal<Option<Rc<WebApp>>>, tick: Signal<u32>) -> Element {
    let mut panel = use_signal(String::new);
    let mut draft = use_signal(String::new);
    let mut running = use_signal(|| false);
    use_effect(move || {
        let _ = tick();
        panel.set(scrollback(&web));
    });
    let mut submit = move || {
        let command = draft().trim().to_string();
        if command.is_empty() || running() {
            return;
        }
        let Some(app) = web.peek().clone() else { return };
        let before = commands_in(&panel.peek().clone());
        draft.set(String::new());
        running.set(true);
        panel.set(
            app.handle(Request::post_form("/terminal", &[("command", &command)]))
                .body,
        );
        spawn(async move {
            // Watch until the command COUNT rises — not until the pane stops
            // changing. A first boot streams a disk over the network and can
            // take a minute; "the pane looks the same as last tick" is true
            // for every one of those ticks, and stopping on it would replace
            // the "running…" line with an empty scrollback and give up.
            for _ in 0..MAX_TICKS {
                if sleep(TICK_MS).await.is_err() {
                    break;
                }
                let next = scrollback(&web);
                if commands_in(&next) > before {
                    panel.set(next);
                    break;
                }
            }
            running.set(false);
        });
    };
    rsx! {
        section { class: "panel", aria_label: "Workspace terminal",
            h2 { "Workspace" }
            p { class: "note",
                "A real Linux, running in this tab. The agents in this space build here with \
                 exec, read_file, write_file and list_files, and you can run a command \
                 yourself. It boots on the first command — the disk streams over the \
                 network, so that one takes a while and the rest do not. What is written \
                 here is kept in this browser and is still there after a reload."
            }
            div { aria_live: "polite", dangerous_inner_html: "{panel}" }
            form {
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
                    disabled: running(),
                    oninput: move |e| draft.set(e.value()),
                }
                button {
                    r#type: "submit",
                    disabled: running(),
                    if running() { "Running…" } else { "Run" }
                }
            }
            p { class: "note credit",
                "The Linux runs on "
                a { href: "https://cheerpx.io/", rel: "noopener", "CheerpX" }
                " by Leaning Tech, loaded from their CDN under the CheerpX Community \
                 Licence, with the Alpine disk image published by the WebVM project."
            }
        }
    }
}
