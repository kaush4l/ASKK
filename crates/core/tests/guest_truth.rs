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

/// **THE GUEST BOOTS NON-INTERACTIVE, AND THE TEST READS THE SHIPPED `.js`.**
///
/// There is no terminal on the far end of that PTY and nobody can press `q`, so
/// a command that opens a pager or an editor does not slow a turn down — it
/// eats the whole 180 s watchdog and comes back `[PARTIAL: …]` with the work
/// gone. That is the "environment loses work" failure with no error message at
/// all, and the three exports are the whole fix.
///
/// Asserted against `crates/adapters_web/src/c2w.js` and not against a comment,
/// for the reason `crates/agent/tests/environment.rs` reads the same file for
/// `RUN_MS`: the boot line is JavaScript in the one crate the pure core may not
/// depend on (I3), so grepping the source is the only check that exists. That
/// is the weaker half of I17 and it is said out loud — what a booted
/// container2wasm actually has in its environment is UNPINNABLE from any gate
/// command here, and the machine fact that would settle it is a
/// cross-origin-isolated document serving the ~48 MB image inside the harness.
#[test]
fn the_guest_boots_with_nothing_in_it_that_can_wait_for_a_keypress() {
    let js = std::fs::read_to_string(C2W_JS).expect("c2w.js is readable");
    let boot = js
        .split("const setup =")
        .nth(1)
        .expect("c2w.js still builds a boot `setup` line")
        // The assignment and nothing after it: a bounded window, so this cannot
        // pass on an export that happens to appear elsewhere in the file.
        .lines()
        .take(3)
        .collect::<String>();
    for export in ["PAGER=cat", "GIT_PAGER=cat", "EDITOR=true"] {
        assert!(
            boot.contains(export),
            "the boot line no longer exports {export}, so a command that opens a pager or an \
             editor in this guest waits for a keypress nobody can send until the watchdog \
             kills it: {boot}"
        );
    }
    // …AND EVERY VALUE IT NAMES IS A BINARY THE DECLARATION CARRIES (I16). An
    // `EDITOR` pointing at something this guest does not have is the same trap
    // wearing a fix, so the values are checked and not only the keys.
    //
    // `true` IS THE ONE EXEMPTION, AND IT IS A LABELLED GAP, NOT A WAIVER
    // (I17). It is an ash builtin in the same class as `set`, `printf` and
    // `test`, which the declaration does carry — but `agent::GUEST_BINARIES` is
    // pinned to `image/Dockerfile`'s inventory by
    // `crates/agent/tests/inventory.rs`, the Dockerfile is the source of truth,
    // and the image is FROZEN. So the machine fact that would settle `true` is
    // one line in a recipe this round may not edit, and pretending otherwise by
    // adding the name here would put the declaration and its source out of
    // agreement — the exact drift both files exist to prevent. Listed by name
    // so a second exemption has to be argued for rather than slipped in.
    let builtin_not_in_the_recipe = ["true"];
    for named in ["cat", "true"] {
        assert!(
            agent::GUEST_BINARIES.contains(&named) || builtin_not_in_the_recipe.contains(&named),
            "the boot line sets a variable to `{named}`, which \
             `agent::environment::BINARIES` does not declare this guest has"
        );
    }
}

/// Where the shipped watchdog and boot line actually live.
const C2W_JS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../adapters_web/src/c2w.js");
