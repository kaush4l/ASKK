//! WHOSE LINUX THIS IS — the engine credit under the Commands pane. Split from
//! `terminal.rs` for the 200-line rule (I12).
//!
//! VISIBLE, not behind a marker (R4-16): the headline claim is "runs in your
//! browser" and the one third-party dependency it rests on was named only
//! inside a collapsed disclosure. …AND IT NAMES THE ENGINE THAT IS ACTUALLY
//! RUNNING (increment 18): crediting Leaning Tech under a page running
//! container2wasm would be a false attribution in the one paragraph whose whole
//! job is attribution — and it would hide that the c2w page has no third party
//! to credit, which is the reason c2w exists.
//!
//! The CheerpX Community Licence asks for "appropriate credits"; this is it.
//!
//! EVERY OUTBOUND LINK LEAVES IN A NEW TAB (R14-P1-4). These two are the only
//! links in the product that go anywhere but this page, and both navigated IN
//! PLACE — a mis-click on a credit unloaded the app, which kills the Worker
//! driving whatever the agent was doing and abandons any command in the Linux.
//! The test below is the rule, not this file: it walks the whole crate.

use dioxus::prelude::*;

pub(crate) fn credit() -> Element {
    match adapters_web::engine() {
        adapters_web::Engine::Cheerpx => rsx! {
            p { class: "note credit",
                "The Linux runs on "
                a {
                    href: "https://cheerpx.io/",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    "CheerpX",
                }
                " by Leaning Tech, loaded from their CDN under the CheerpX Community \
                 Licence, with the Alpine disk image published by the WebVM project. \
                 Everything else on this page is served by this site."
            }
        },
        adapters_web::Engine::C2w => rsx! {
            p { class: "note credit",
                "The Linux is an Alpine container built with "
                a {
                    href: "https://github.com/ktock/container2wasm",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    "container2wasm",
                }
                ", served by this site — no CDN and no third-party disk. Its filesystem \
                 is in memory, so anything written here is gone when the page reloads; \
                 Settings has the other engine, which keeps files."
            }
        },
    }
}

#[cfg(test)]
mod tests {
    /// R14-P1-4: an anchor anywhere in this crate whose href starts with a
    /// scheme and that does not also say `target` navigates the app away in
    /// place, which kills the Worker driving the run.
    /// The rule is checked over the SOURCE, so a third link added tomorrow is
    /// covered by the same test rather than by remembering this one.
    #[test]
    fn every_outbound_link_opens_in_a_new_tab() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut bare = Vec::new();
        let mut files = vec![src];
        while let Some(path) = files.pop() {
            if path.is_dir() {
                files.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
                continue;
            }
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            // ponytail: `target:` within the 200 characters after the href,
            // which is the whole of an `a { … }` in this crate. Read the
            // element properly if one ever grows past that.
            for (n, _) in text.match_indices("href: \"http") {
                let rest = &text[n..text.len().min(n + 200)];
                if !rest.contains("target:") {
                    let line = text[..n].matches('\n').count() + 1;
                    bare.push(format!("{}:{line}", path.display()));
                }
            }
        }
        assert!(bare.is_empty(), "outbound links with no target: {bare:?}");
    }
}
