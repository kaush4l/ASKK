//! Contract tests for Spike B. These ARE the spike's claims (see README.md).

use forge_spike::{Capability, ForgeError, Host, Manifest, Module};

const CLOCK: i64 = 1_700_000_000;

fn demo_module(capabilities: Vec<Capability>) -> Module {
    Module {
        manifest: Manifest {
            id: "demo".into(),
            route: "/panels/demo".into(),
            capabilities,
        },
        // Logic arrives as DATA: a rhai source string, not compiled-in Rust.
        script: r#"
            fn handle() {
                let t = clock_now();
                `<div id="demo">tick ${t}</div>`
            }
        "#
        .into(),
    }
}

fn host_with(granted: &[Capability], module: Module) -> Host {
    let mut host = Host::new(granted, CLOCK);
    host.register(module).expect("module registers from string");
    host
}

// (a) module loads from a string and serves its declared route.
#[test]
fn loads_from_string_and_serves_route() {
    let host = host_with(
        &[Capability::ClockNow],
        demo_module(vec![Capability::ClockNow]),
    );
    assert!(host.handle("/panels/demo").is_ok());
    assert_eq!(
        host.handle("/panels/nope"),
        Err(ForgeError::RouteNotFound("/panels/nope".into()))
    );
}

// (b) the fragment is the expected HTML. (d) the granted capability works:
// the injected deterministic clock value appears in the output.
#[test]
fn renders_expected_fragment_via_granted_capability() {
    let host = host_with(
        &[Capability::ClockNow],
        demo_module(vec![Capability::ClockNow]),
    );
    assert_eq!(
        host.handle("/panels/demo").unwrap(),
        r#"<div id="demo">tick 1700000000</div>"#
    );
}

// (c) calling an ungranted capability yields a TYPED denial — declared in the
// manifest but not granted by the host.
#[test]
fn ungranted_capability_is_typed_denial() {
    let mut module = demo_module(vec![Capability::ClockNow, Capability::KvGet]);
    module.script = r#"fn handle() { kv_get("secret") }"#.into();
    let host = host_with(&[Capability::ClockNow], module); // host grants no KvGet
    assert_eq!(
        host.handle("/panels/demo"),
        Err(ForgeError::CapabilityDenied {
            module_id: "demo".into(),
            capability: Capability::KvGet,
        })
    );
}

// (e) a capability NOT declared in the manifest is denied even though the
// host could provide it (host grant set includes KvGet).
#[test]
fn undeclared_capability_denied_despite_host_grant() {
    let mut module = demo_module(vec![Capability::ClockNow]); // no KvGet declared
    module.script = r#"fn handle() { kv_get("secret") }"#.into();
    let host = host_with(&[Capability::ClockNow, Capability::KvGet], module);
    assert_eq!(
        host.handle("/panels/demo"),
        Err(ForgeError::CapabilityDenied {
            module_id: "demo".into(),
            capability: Capability::KvGet,
        })
    );
}

// Engine limits: a runaway script is stopped by max_operations and surfaces
// as a typed Script error, not a hang and not a panic.
#[test]
fn runaway_script_hits_operation_limit() {
    let mut module = demo_module(vec![]);
    module.script = r#"fn handle() { loop {} }"#.into();
    let host = host_with(&[], module);
    match host.handle("/panels/demo") {
        Err(ForgeError::Script { message, .. }) => {
            assert!(message.to_lowercase().contains("operations"), "{message}")
        }
        other => panic!("expected Script error, got {other:?}"),
    }
}

// A second module on an already-served route is a typed conflict, not a
// silent overwrite.
#[test]
fn duplicate_route_is_typed_conflict() {
    let mut host = host_with(&[], demo_module(vec![]));
    assert_eq!(
        host.register(demo_module(vec![])),
        Err(ForgeError::RouteConflict("/panels/demo".into()))
    );
}
