//! The three things the agent editor does across the seam: read one agent's
//! `agent.md` back, hand it to the browser as a download, and POST a write or a
//! delete. Split from `authoring.rs` so both hold the 200-line rule (I12);
//! that file owns the pane, this one owns the plumbing.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::Button;
use wasm_bindgen::JsCast;

/// The `agent.md` for one agent, straight off the seam. `GET /agents/file`
/// answers with the FILE, so the editor holds the text rather than scraping it
/// back out of rendered HTML.
pub(crate) fn load(web: &Signal<Option<Rc<WebApp>>>, who: &str) -> Option<String> {
    let app = web.peek().clone()?;
    let res = app.handle(Request::get("/agents/file").with_header("x-agent", who));
    (res.status == 200).then_some(res.body)
}

/// THE EDITOR ARRIVES OPEN (R7-8). "Open its agent file" on the shared-space
/// card routed to the Agents view and left an empty form: the one instruction
/// that card gives could not be carried out from the link offering it. The
/// pane mounts only on its own view, so arriving loads the agent the page is
/// pointed at — into an UNTOUCHED form only, because a draft belongs to
/// whoever typed it.
pub(crate) fn open_selected(
    web: Signal<Option<Rc<WebApp>>>,
    who: &str,
    mut draft: Signal<String>,
    mut name: Signal<String>,
) {
    if !draft.peek().is_empty() || who.is_empty() {
        return;
    }
    if let Some(text) = load(&web, who) {
        draft.set(text);
        name.set(who.to_string());
    }
}

/// Hand the text to the browser as a download named the way the repo names it.
/// A data: URL rather than a Blob so this stays four lines of `web_sys`; the
/// file is a few kilobytes of markdown.
pub(crate) fn export(name: &str, text: &str) {
    let encoded: String = text
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect();
    let Some(document) = web_sys::window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(anchor) = document.create_element("a") else {
        return;
    };
    let _ = anchor.set_attribute("href", &format!("data:text/markdown;charset=utf-8,{encoded}"));
    let _ = anchor.set_attribute("download", &format!("{name}-agent.md"));
    if let Some(el) = anchor.dyn_ref::<web_sys::HtmlElement>() {
        el.click();
    }
}


/// The sentence out of a one-element fragment. The core wrote it — a refusal
/// names the fix — and a second sentence written here could only disagree with
/// it. Reading the text out of ONE element is not the view-scraping the
/// codebase refuses; the alternative is duplicating every refusal.
fn said(fragment: &str) -> String {
    let mut text = String::new();
    let mut inside = false;
    for c in fragment.chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            c if !inside => text.push(c),
            _ => {}
        }
    }
    text.replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

/// One seam POST, with the pane's status line set from whatever came back.
pub(crate) fn post(
    web: Signal<Option<Rc<WebApp>>>,
    mut status: Signal<String>,
    mut refused: Signal<bool>,
    mut tick: Signal<u32>,
    req: Request,
) {
    let Some(app) = web.peek().clone() else { return };
    let res = app.handle(req);
    // A refusal is a BLOCKING condition, not help text — the same rule the
    // settings pane follows since increment 05's walk.
    refused.set(res.status != 200);
    status.set(said(&res.body));
    let n = tick.peek().to_owned();
    tick.set(n + 1);
}

/// The row that loads an existing agent, or starts a blank one. Its own fn so
/// the pane's body stays inside the 40-line rule (I12).
pub(crate) fn picker(
    web: Signal<Option<Rc<WebApp>>>,
    loaded: Signal<Vec<String>>,
    mut draft: Signal<String>,
    mut name: Signal<String>,
) -> Element {
    rsx! {
        div { class: "editor-picks",
            for who in loaded.read().clone() {
                Button {
                    key: "{who}",
                    variant: "secondary",
                    onclick: {
                        let who = who.clone();
                        move |_| {
                            if let Some(text) = load(&web, &who) {
                                draft.set(text);
                                name.set(who.clone());
                            }
                        }
                    },
                    "Load {who}"
                }
            }
            Button {
                variant: "secondary",
                onclick: move |_| {
                    name.set(String::new());
                    draft.set(BLANK.to_string());
                },
                "Blank file"
            }
        }
    }
}

/// The starting point for a new agent: every key the loader reads, so nobody
/// has to remember which ones exist. `tools: []` is the MAXIMAL grant and the
/// comment above it says so — it read as "no tools" (11b walk).
///
/// `space:` CARRIES ITS GLOSS WHERE IT IS MET (R17-P1-8): every word on this
/// page says workspace and the key in the file says space, and the two are the
/// same thing. The key is not renamed — see `agentkeys.rs`.
pub(crate) const BLANK: &str = "---\nname: \ndescription: \nmodel: \nengine: react\n\
                     # space: is the WORKSPACE — name one and the agent gets that folder\n\
                     # in Linux, and shares its facts and notes with every agent naming it.\n\
                     space: \n\
                     # tools: [] means every built-in tool, write_agent included;\n\
                     # tools: [now] is only that one.\n\
                     tools: []\ncompact_at: 8\nkeep_recent: 3\n---\n\nYou are …\n";
