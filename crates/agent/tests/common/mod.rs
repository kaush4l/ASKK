//! THE SHIPPED BRIEFS, FOR TESTS THAT WALK STAGES.
//!
//! A stage that has a brief refuses to be entered without it (`agent::brief`),
//! so every test that walks one has to install the same words the app installs.
//! It reads the real `public/stages/*.md` rather than a fixture for the reason
//! `tests/stages.rs` reads the real `agent.md`: a brief file deleted or emptied
//! in the repo should fail here, not in a browser.
//!
//! `include_str!` IS ALLOWED HERE AND NOWHERE IN `crates/*/src`. Compiling the
//! words into a test binary is the test declaring what it expects; compiling
//! them into the shipped path would be the fallback this increment deleted.

#![allow(dead_code)] // one helper per test binary; not every binary wants both

/// The five files, as the `(key, text)` pairs `assets::fetch_briefs` produces.
pub fn brief_pairs() -> Vec<(String, String)> {
    vec![
        (agent::STAGE_STRATEGY.to_string(), include_str!("../../../../public/stages/strategy.md").to_string()),
        (agent::STAGE_PLAN.to_string(), include_str!("../../../../public/stages/plan.md").to_string()),
        (agent::STAGE_VERIFY.to_string(), include_str!("../../../../public/stages/verify.md").to_string()),
        (agent::STAGE_CRITIQUE.to_string(), include_str!("../../../../public/stages/critique.md").to_string()),
        (agent::BRIEF_DURABLE.to_string(), include_str!("../../../../public/stages/durable.md").to_string()),
    ]
}

/// …loaded, which is the only way a `Briefs` can be built.
pub fn shipped_briefs() -> agent::Briefs {
    agent::load_briefs(brief_pairs()).expect("the shipped stage briefs load")
}

/// …and adopted onto a state, beside the spec, exactly as `core` does it.
pub fn brief(state: &mut agent::AgentState) {
    agent::adopt_briefs(state, &shipped_briefs());
}
