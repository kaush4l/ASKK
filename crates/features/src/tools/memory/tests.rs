//! Tests for `tools/memory/mod.rs` — the `remember`/`recall`/`forget` note
//! tools: legacy flat-namespace behavior (default ctx) and per-agent scoping
//! via `AGENT_ID_SLICE` (GAPS 49).

use std::cell::Cell;

use super::super::testutil::block_on;
use super::*;
use askk_state::MemKv;

/// Registry over MemKv with a ticking clock (each remember is newer).
fn setup() -> (ToolRegistry, Rc<MemKv>) {
    let kv = Rc::new(MemKv::new());
    let mut reg = ToolRegistry::new();
    let tick = Rc::new(Cell::new(0u64));
    let now = move || {
        tick.set(tick.get() + 1);
        tick.get()
    };
    register_memory_tools(&mut reg, kv.clone(), now).unwrap();
    (reg, kv)
}

/// A ToolCtx carrying the dispatch-supplied caller agent id.
fn agent_ctx(id: &str) -> ToolCtx {
    let mut ctx = ToolCtx::default();
    ctx.set_slice(AGENT_ID_SLICE, json!(id));
    ctx
}

fn call_as(reg: &ToolRegistry, name: &str, args: Value, ctx: &mut ToolCtx) -> ToolResult {
    let set = reg
        .build_tool_set(&["remember".into(), "recall".into(), "forget".into()])
        .unwrap();
    block_on(set.get(name).unwrap().call(args, ctx))
}

fn call(reg: &ToolRegistry, name: &str, args: Value) -> ToolResult {
    call_as(reg, name, args, &mut ToolCtx::default())
}

#[test]
fn remember_recall_round_trip_newest_first() {
    let (reg, _) = setup();
    for (slug, text) in [("likes-rust", "prefers Rust"), ("hates-yaml", "avoid YAML")] {
        let out = call(&reg, "remember", json!({"slug": slug, "text": text}));
        assert!(out.ok, "{}", out.content);
        assert_eq!(out.content, format!("remembered '{slug}'"));
    }
    let out = call(&reg, "recall", json!({}));
    assert!(out.ok);
    assert_eq!(
        out.content,
        "* hates-yaml — avoid YAML\n* likes-rust — prefers Rust"
    );
}

#[test]
fn auto_slug_comes_from_the_first_words() {
    let (reg, kv) = setup();
    let out = call(
        &reg,
        "remember",
        json!({"text": "User prefers dark mode, always."}),
    );
    assert!(out.ok);
    assert_eq!(out.content, "remembered 'user-prefers-dark-mode-always'");
    assert!(block_on(kv.get("notes/user-prefers-dark-mode-always"))
        .unwrap()
        .is_some());
    // All-symbol text still lands somewhere deterministic.
    assert_eq!(auto_slug("!!! ???"), "note");
}

#[test]
fn same_slug_overwrites() {
    let (reg, _) = setup();
    call(&reg, "remember", json!({"slug": "pref", "text": "v1"}));
    call(&reg, "remember", json!({"slug": "pref", "text": "v2"}));
    let out = call(&reg, "recall", json!({}));
    assert_eq!(out.content, "* pref — v2");
}

#[test]
fn recall_substring_matches_slugs_and_text_case_insensitively() {
    let (reg, _) = setup();
    call(
        &reg,
        "remember",
        json!({"slug": "editor", "text": "uses Helix"}),
    );
    call(
        &reg,
        "remember",
        json!({"slug": "os", "text": "runs NixOS"}),
    );
    let by_text = call(&reg, "recall", json!({"query": "HELIX"}));
    assert_eq!(by_text.content, "* editor — uses Helix");
    let by_slug = call(&reg, "recall", json!({"query": "os"}));
    assert!(by_slug.content.contains("* os — runs NixOS"));
    let none = call(&reg, "recall", json!({"query": "absent"}));
    assert!(none.ok);
    assert_eq!(none.content, "no notes match 'absent'");
}

#[test]
fn recall_is_bounded_and_empty_store_reads_readably() {
    let (reg, _) = setup();
    assert_eq!(
        call(&reg, "recall", json!({})).content,
        "(no memory notes yet)"
    );
    for i in 0..10 {
        call(
            &reg,
            "remember",
            json!({"slug": format!("n{i}"), "text": "x"}),
        );
    }
    let out = call(&reg, "recall", json!({}));
    assert_eq!(out.content.lines().count(), MAX_NOTES);
    assert!(out.content.starts_with("* n9 — x")); // newest first
}

#[test]
fn forget_removes_and_misses_readably() {
    let (reg, kv) = setup();
    call(&reg, "remember", json!({"slug": "gone", "text": "bye"}));
    let out = call(&reg, "forget", json!({"slug": "gone"}));
    assert!(out.ok);
    assert_eq!(out.content, "forgot 'gone'");
    assert!(block_on(kv.get("notes/gone")).unwrap().is_none());
    let miss = call(&reg, "forget", json!({"slug": "gone"}));
    assert!(!miss.ok);
    assert_eq!(miss.content, "forget: no note 'gone'");
}

#[test]
fn invalid_inputs_fail_readably() {
    let (reg, _) = setup();
    assert!(!call(&reg, "remember", json!({})).ok);
    assert!(!call(&reg, "remember", json!({"text": "  "})).ok);
    // Empty slug counts as omitted → auto-slug, not an error.
    let out = call(
        &reg,
        "remember",
        json!({"slug": "", "text": "empty slug ok"}),
    );
    assert_eq!(out.content, "remembered 'empty-slug-ok'");
    for bad in ["has space", "a/b", "x".repeat(65).as_str()] {
        let out = call(&reg, "remember", json!({"slug": bad, "text": "t"}));
        assert!(!out.ok, "slug '{bad}' should be rejected");
    }
    assert!(!call(&reg, "forget", json!({})).ok);
}

#[test]
fn dry_run_touches_nothing() {
    let (reg, kv) = setup();
    call(&reg, "remember", json!({"slug": "keep", "text": "stays"}));
    let set = reg
        .build_tool_set(&["remember".into(), "forget".into()])
        .unwrap();
    let mut ctx = ToolCtx::default();
    ctx.dry_run = true;
    let out = block_on(
        set.get("remember")
            .unwrap()
            .call(json!({"slug": "ghost", "text": "boo"}), &mut ctx),
    );
    assert!(out.ok);
    assert_eq!(out.content, "would remember 'ghost'");
    assert!(block_on(kv.get("notes/ghost")).unwrap().is_none());
    let out = block_on(
        set.get("forget")
            .unwrap()
            .call(json!({"slug": "keep"}), &mut ctx),
    );
    assert!(out.ok);
    assert_eq!(out.content, "would forget 'keep'");
    assert!(block_on(kv.get("notes/keep")).unwrap().is_some());
}

#[test]
fn scoped_agents_do_not_see_each_other() {
    let (reg, kv) = setup();
    let (mut alice, mut bob) = (agent_ctx("alice"), agent_ctx("bob"));
    let out = call_as(
        &reg,
        "remember",
        json!({"slug": "secret", "text": "alice only"}),
        &mut alice,
    );
    assert!(out.ok, "{}", out.content);
    assert!(block_on(kv.get("notes/alice/secret")).unwrap().is_some());
    let mine = call_as(&reg, "recall", json!({}), &mut alice);
    assert_eq!(mine.content, "* secret — alice only");
    let theirs = call_as(&reg, "recall", json!({}), &mut bob);
    assert_eq!(theirs.content, "(no memory notes yet)");
}

#[test]
fn legacy_notes_stay_visible_to_all_and_forgettable() {
    let (reg, kv) = setup();
    call(&reg, "remember", json!({"slug": "old", "text": "shared"})); // legacy bare key
    let (mut alice, mut bob) = (agent_ctx("alice"), agent_ctx("bob"));
    for ctx in [&mut alice, &mut bob] {
        let out = call_as(&reg, "recall", json!({}), ctx);
        assert_eq!(out.content, "* old — shared");
    }
    // Scoped forget falls back to the legacy key.
    let out = call_as(&reg, "forget", json!({"slug": "old"}), &mut alice);
    assert!(out.ok);
    assert_eq!(out.content, "forgot 'old'");
    assert!(block_on(kv.get("notes/old")).unwrap().is_none());
}

#[test]
fn ctx_without_agent_slice_keeps_legacy_keys() {
    let (reg, kv) = setup();
    call(&reg, "remember", json!({"slug": "plain", "text": "flat"}));
    assert!(block_on(kv.get("notes/plain")).unwrap().is_some()); // bare key
    assert_eq!(call(&reg, "recall", json!({})).content, "* plain — flat");
    let out = call(&reg, "forget", json!({"slug": "plain"}));
    assert!(out.ok);
    assert!(block_on(kv.get("notes/plain")).unwrap().is_none());
}

#[test]
fn scoped_note_shadows_a_legacy_slug_tie_in_recall() {
    let (reg, kv) = setup();
    call(&reg, "remember", json!({"slug": "pref", "text": "legacy"}));
    let mut alice = agent_ctx("alice");
    call_as(
        &reg,
        "remember",
        json!({"slug": "pref", "text": "scoped"}),
        &mut alice,
    );
    let out = call_as(&reg, "recall", json!({}), &mut alice);
    assert_eq!(out.content, "* pref — scoped");
    // Scoped forget removes the scoped note first; the legacy one remains.
    let out = call_as(&reg, "forget", json!({"slug": "pref"}), &mut alice);
    assert!(out.ok);
    assert!(block_on(kv.get("notes/alice/pref")).unwrap().is_none());
    assert!(block_on(kv.get("notes/pref")).unwrap().is_some());
}
