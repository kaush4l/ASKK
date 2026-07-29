//! module test contract, G4 slice: install/resolve/conflict on the registry
//! fold, and escaping-by-construction on the view primitives.

use kernel::{ModuleId, Version};
use module::view::FragmentBuilder;
use module::{DataSchema, Logic, Manifest, Registry, RouteSpec, Tier};

fn manifest(id: &str, version: u32, routes: &[(&str, &str)]) -> Manifest {
    Manifest {
        id: ModuleId(id.into()),
        name: id.into(),
        version: Version(version),
        description: format!("test module {id}"),
        capabilities: vec![],
        routes: routes
            .iter()
            .map(|(m, p)| RouteSpec {
                method: (*m).to_string(),
                path: (*p).to_string(),
            })
            .collect(),
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: format!("mod/{id}/"),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

#[test]
fn install_resolves_routes_and_rejects_conflicts_and_duplicates() {
    let mut reg = Registry::new();
    reg.install(
        manifest("status", 1, &[("GET", "/panels/status")]),
        Logic::BuiltIn,
    )
    .unwrap();
    let hit = reg.resolve_route("GET", "/panels/status").unwrap();
    assert_eq!(hit.manifest.id.0, "status");
    assert!(reg.resolve_route("POST", "/panels/status").is_none());
    assert!(reg.resolve_route("GET", "/nope").is_none());

    // Same route, different module: rejected at install time (ADR-004).
    let err = reg
        .install(
            manifest("other", 1, &[("GET", "/panels/status")]),
            Logic::BuiltIn,
        )
        .unwrap_err();
    assert!(matches!(err, module::ModuleError::RouteConflict { .. }));

    // Same id+version twice: versions are immutable history.
    let err = reg
        .install(manifest("status", 1, &[]), Logic::BuiltIn)
        .unwrap_err();
    assert!(matches!(err, module::ModuleError::VersionExists { .. }));

    // Deactivation removes from existence without erasing history.
    reg.deactivate(&ModuleId("status".into()), Version(1))
        .unwrap();
    assert!(reg.resolve_route("GET", "/panels/status").is_none());
    let err = reg
        .install(manifest("status", 1, &[]), Logic::BuiltIn)
        .unwrap_err();
    assert!(matches!(err, module::ModuleError::VersionExists { .. }));
}

#[test]
fn fragment_builder_escapes_by_construction() {
    let html = FragmentBuilder::new("div")
        .id("out")
        .class("panel")
        .attr("data-x", "\"quoted\"")
        .hx_get("/panel")
        .text("<script>alert(1)</script> & more")
        .build()
        .into_html();
    assert_eq!(
        html,
        "<div id=\"out\" class=\"panel\" data-x=\"&quot;quoted&quot;\" \
         hx-get=\"/panel\">&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</div>"
    );
}

#[test]
fn fragments_compose_as_children() {
    let inner = FragmentBuilder::new("span").text("hi").build();
    let html = FragmentBuilder::new("div").child(inner).build().into_html();
    assert_eq!(html, "<div><span>hi</span></div>");
}
