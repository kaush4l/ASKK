//! WHOSE LINUX THIS IS — the engine credit under the Commands pane, and the
//! crate-wide rule about outbound links that the test at the foot enforces.
//!
//! VISIBLE, not behind a marker (R4-16): the headline claim is "runs in your
//! browser", and where the Linux comes from is part of that claim rather than
//! a footnote inside a collapsed disclosure.
//!
//! THERE IS NOBODY ELSE TO CREDIT NOW. This paragraph used to name a second
//! vendor, whose community licence asked for "appropriate credits" in return
//! for a runtime loaded from their CDN and a disk image streamed from their
//! servers. None of that ships any more — no runtime, no CDN, no third-party
//! image — so a credit naming them would attribute work this product does not
//! use. What is left is the container2wasm attribution and the fact it
//! carries: this site serves its own Linux, and that Linux forgets.
//!
//! EVERY OUTBOUND LINK LEAVES IN A NEW TAB (R14-P1-4). It navigated IN PLACE —
//! a mis-click on a credit unloaded the app, which kills the Worker driving
//! whatever the agent was doing and abandons any command in the Linux. The
//! test below is the rule, not this file: it walks the whole crate.

use dioxus::prelude::*;

pub(crate) fn credit() -> Element {
    rsx! {
        p { class: "note credit",
            "The Linux is an Alpine container built with "
            a {
                href: "https://github.com/ktock/container2wasm",
                target: "_blank",
                rel: "noopener noreferrer",
                "container2wasm",
            }
            ", served by this site — no CDN and no third-party disk. Its filesystem \
             is in memory, so anything written here is gone when the page reloads, \
             and there is no setting that changes that."
        }
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
