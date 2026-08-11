//! The three things the agent editor does across the seam: read one agent's
//! `agent.md` back, hand it to the browser as a download, and POST a write or a
//! delete. Split from `authoring.rs` so both hold the 200-line rule (I12);
//! that file owns the pane, this one owns the plumbing.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;
use wasm_bindgen::JsCast;

/// The `agent.md` for one agent, straight off the seam. `GET /agents/file`
/// answers with the FILE, so the editor holds the text rather than scraping it
/// back out of rendered HTML.
pub(crate) fn load(web: &Signal<Option<Rc<WebApp>>>, who: &str) -> Option<String> {
    let app = web.peek().clone()?;
    let res = app.handle(Request::get("/agents/file").with_header("x-agent", who));
    (res.status == 200).then_some(res.body)
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
