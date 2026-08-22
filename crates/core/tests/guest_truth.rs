//! **THE DECLARATION AND THE PORT, ASSERTED TO AGREE (I16).**
//!
//! `agent::environment` tells the model that nothing written in the workspace
//! survives a reload. `WorkspacePort::durable` is where the machine says the
//! same thing, and the two live in different crates: the declaration is pure
//! and the port is the browser's. Nothing connected them, so a port that began
//! keeping files would leave a prompt telling every agent it does not — which
//! is the exact drift I16 exists to make impossible.
//!
//! It has to be HERE and not in `crates/agent`: `agent` has no dev-dependency
//! on a workspace at all, and adding one to reach a fake would be a dependency
//! bought for a test. `core` already holds `adapters_test`, whose `FakeShell`
//! answers what the shipped container2wasm engine answers, by construction and
//! by its own test (`shell/port.rs`: "the default is container2wasm").
//!
//! THE HONEST LIMIT, stated where it bites: this asserts the declaration
//! against the PORT CONTRACT, not against the image. Only a build settles the
//! second, and the build is frozen.

use adapters_test::FakeShell;
use kernel::WorkspacePort;

/// The one fact both halves state, stated once in each and compared.
#[test]
fn the_declaration_and_the_workspace_port_agree_that_nothing_is_kept() {
    assert_eq!(
        agent::GUEST_DURABLE,
        FakeShell::new().durable(),
        "`agent::environment::DURABLE` and `WorkspacePort::durable()` disagree about \
         whether the guest keeps what is written in it. One of them is lying to a model."
    );
    assert!(!agent::GUEST_DURABLE, "and the answer is no, permanently (owner ruling)");
}

/// …and the sentence the model reads carries the SAME CLAUSE the panes print a
/// person. Not the same sentence — the pane speaks to somebody who can copy a
/// file out and the prompt to somebody who cannot, so the two end differently on
/// purpose — but the half that matters is one constant, and this is the assertion
/// that it is still spliced into the block a model actually sees.
///
/// It reads the RENDERED `## space` block rather than `environment::lines`,
/// because that is where the clause lives and why: `environment::facts` is a
/// function of the toolbox and renders nothing for an agent that has a folder
/// and no workspace tools, which is the shipped `critic` exactly. The oracle is
/// `agent::GUEST_MEMORY` — the same string the wording is built from and the
/// same string `crates/ui` pins its panes to, so a rewording that reaches one
/// reader and not the other cannot be green in both crates.
#[test]
fn the_model_and_the_person_are_told_the_same_thing_about_the_folder() {
    let space = agent::Space::named("crew").expect("`crew` is a legal space name");
    let said = agent::SharedSpace {
        space: Some(space),
        tools: agent::Toolbox::of(agent::workspace_tools()),
    }
    .text();

    assert!(
        said.contains(agent::GUEST_MEMORY),
        "the `## space` block no longer carries `agent::GUEST_MEMORY`, so the model is \
         being told something about this folder that the panes do not say: {said}"
    );
    assert!(
        said.contains("survives a reload"),
        "the clause reached the block without the consequence that makes it matter: {said}"
    );
}
