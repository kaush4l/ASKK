//! Board tool tests (over the public registry surface): lifecycle rules,
//! readable misses, dry-run previews. The through-the-loop exercise lives in
//! workflows.rs (`board_card_lifecycle_through_the_loop`).

use std::rc::Rc;

use askk_core::{ToolCtx, ToolResult};
use askk_engine::state::{KvStore, MemKv};
use askk_engine::testutil::block_on;
use askk_engine::tools::{register_board, ToolRegistry};
use serde_json::{json, Value};

fn reg() -> ToolRegistry {
    let kv: Rc<dyn KvStore> = Rc::new(MemKv::new());
    let mut reg = ToolRegistry::new();
    register_board(&mut reg, kv).unwrap();
    reg
}

async fn call(reg: &ToolRegistry, name: &str, args: Value) -> ToolResult {
    let tool = reg.get(name).expect("tool registered");
    let mut ctx = ToolCtx::default();
    tool.call(args, &mut ctx).await
}

#[test]
fn add_list_move_check_full_lifecycle() {
    block_on(async {
        let reg = reg();
        let added = call(
            &reg,
            "board_add",
            json!({"title": "Ship search", "goal": "make it fast",
                   "criteria": ["under 100ms", "has tests"], "stage": "planning"}),
        )
        .await;
        assert!(added.ok, "{}", added.content);
        assert!(added.content.contains("[ship-search]"));

        let listed = call(&reg, "board_list", json!({})).await;
        assert!(listed.content.contains("## planning"), "{}", listed.content);
        assert!(listed.content.contains("(0/2 criteria)"));

        // Done refused while criteria are open — the planning<->testing bounce.
        let blocked = call(
            &reg,
            "board_move",
            json!({"id": "ship-search", "stage": "done"}),
        )
        .await;
        assert!(!blocked.ok);
        assert!(
            blocked.content.contains("unmet criteria"),
            "{}",
            blocked.content
        );

        let m1 = call(
            &reg,
            "board_check",
            json!({"id": "ship-search", "criterion": 1, "note": "62ms measured"}),
        )
        .await;
        assert!(
            m1.ok && m1.content.contains("1 unmet remain"),
            "{}",
            m1.content
        );
        // By substring, and explicitly unmet-able.
        let m2 = call(
            &reg,
            "board_check",
            json!({"id": "ship-search", "criterion": "tests", "met": true}),
        )
        .await;
        assert!(
            m2.ok && m2.content.contains("0 unmet remain"),
            "{}",
            m2.content
        );

        let done = call(
            &reg,
            "board_move",
            json!({"id": "ship-search", "stage": "done", "note": "verified"}),
        )
        .await;
        assert!(done.ok, "{}", done.content);

        let detail = call(&reg, "board_list", json!({"id": "ship-search"})).await;
        assert!(detail.content.contains("done"), "{}", detail.content);
        assert!(detail.content.contains("[x] under 100ms"));
        assert!(detail.content.contains("62ms measured"));
    });
}

#[test]
fn readable_misses_and_dry_run() {
    block_on(async {
        let reg = reg();
        assert!(
            !call(&reg, "board_move", json!({"id": "ghost", "stage": "doing"}))
                .await
                .ok
        );
        assert!(
            !call(&reg, "board_add", json!({"title": "x", "stage": "done"}))
                .await
                .ok
        );
        let added = call(
            &reg,
            "board_add",
            json!({"title": "One", "criteria": ["a", "aa"]}),
        )
        .await;
        assert!(added.ok);
        let ambiguous = call(&reg, "board_check", json!({"id": "one", "criterion": "a"})).await;
        assert!(!ambiguous.ok && ambiguous.content.contains("be specific"));

        let tool = reg.get("board_add").unwrap();
        let mut ctx = ToolCtx::default();
        ctx.dry_run = true;
        let preview = tool.call(json!({"title": "Preview"}), &mut ctx).await;
        assert!(preview.ok && preview.content.starts_with("would add"));
        // Nothing was written.
        let listed = call(&reg, "board_list", json!({})).await;
        assert!(!listed.content.contains("preview"), "{}", listed.content);
    });
}
