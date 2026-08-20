//! THE SHIPPED STAGE BRIEFS, FOR TESTS THAT WALK STAGES.
//!
//! A stage that has a brief refuses to be entered without it (`agent::brief`),
//! so an app booted in a test installs them exactly as the composition root
//! does — `core::install_briefs`, from the same `public/stages/*.md` the page
//! fetches. It reads the real files rather than a fixture for the reason the
//! agent tests read the real `agent.md`: a brief deleted or emptied in the repo
//! should fail here, not in a browser.
//!
//! `include_str!` is a test compiling in what it expects; the shipped path has
//! no compiled-in copy of these words, which is the whole increment.

#![allow(dead_code)] // one helper, many test binaries; not all of them walk stages

/// Install the five briefs onto a booted app.
pub fn brief(app: &mut core::App) {
    core::install_briefs(app, briefs());
}

fn briefs() -> Vec<(String, String)> {
    let files = [
        ("strategy", include_str!("../../../../public/stages/strategy.md")),
        ("plan", include_str!("../../../../public/stages/plan.md")),
        ("verify", include_str!("../../../../public/stages/verify.md")),
        ("critique", include_str!("../../../../public/stages/critique.md")),
        ("durable", include_str!("../../../../public/stages/durable.md")),
    ];
    files.iter().map(|(k, t)| (k.to_string(), t.to_string())).collect()
}
