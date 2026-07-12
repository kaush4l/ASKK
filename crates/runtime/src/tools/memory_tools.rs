//! Agent-curated memory notes — `remember` / `recall` / `forget` over the
//! injected `KvStore`, following the knowledge-tools pattern. One note per
//! key `notes/<slug>` as `{ "text": .., "ts": .. }`; `recall` lists newest
//! first (bounded) or substring-searches slugs + text.
//!
//! ponytail: shared memory namespace; per-agent scoping when ToolCtx carries
//! the caller. Prefix is `notes/` NOT `memory/` — `memory/<agent_id>` is
//! owned by `MemoryStore` digests and a slug equal to an agent id would
//! clobber that agent's memory.

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::state::{KvStore, LocalBoxFuture};

use super::registry::{RegistryError, ToolRegistry};

const PREFIX: &str = "notes/";
/// `recall` display bound.
const MAX_NOTES: usize = 8;

/// Registers the three memory tools over the given store + clock.
pub fn register_memory_tools(
    reg: &mut ToolRegistry,
    kv: Rc<dyn KvStore>,
    now_ms: impl Fn() -> u64 + Clone + 'static,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(Remember {
        spec: remember_spec(),
        kv: kv.clone(),
        now_ms: Box::new(now_ms),
    }))?;
    reg.register(Rc::new(Recall {
        spec: recall_spec(),
        kv: kv.clone(),
    }))?;
    reg.register(Rc::new(Forget {
        spec: forget_spec(),
        kv,
    }))
}

fn key(slug: &str) -> String {
    format!("{PREFIX}{slug}")
}

fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// Slug from the first words of the text: ascii-alnum lowercased, dash-joined,
/// capped. All-symbol text falls back to `note` (overwrite is fine by spec).
fn auto_slug(text: &str) -> String {
    let mut slug = String::new();
    for word in text.split_whitespace().take(6) {
        let clean: String = word
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .map(|c| c.to_ascii_lowercase())
            .collect();
        if clean.is_empty() {
            continue;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&clean);
        if slug.len() >= 40 {
            break;
        }
    }
    if slug.is_empty() {
        "note".into()
    } else {
        slug
    }
}

/// All stored notes as (slug, text, ts), newest first (ties: slug order).
async fn load_notes(kv: &Rc<dyn KvStore>) -> Result<Vec<(String, String, u64)>, String> {
    let keys = kv
        .list_prefix(PREFIX)
        .await
        .map_err(|e| format!("store: {e:?}"))?;
    let mut notes = Vec::new();
    for k in &keys {
        // Tolerant read: malformed values are skipped, not fatal.
        let Ok(Some(value)) = kv.get(k).await else {
            continue;
        };
        let Some(text) = value.get("text").and_then(Value::as_str) else {
            continue;
        };
        let ts = value.get("ts").and_then(Value::as_u64).unwrap_or(0);
        notes.push((k[PREFIX.len()..].to_string(), text.to_string(), ts));
    }
    notes.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    Ok(notes)
}

struct Remember {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
    now_ms: Box<dyn Fn() -> u64>,
}

fn remember_spec() -> ToolSpec {
    ToolSpec {
        name: "remember".into(),
        description: "Saves one durable memory note that persists across runs. \
                      Use it for user preferences, decisions, and findings \
                      worth keeping. Same slug overwrites."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "text": { "type": "string", "description": "The note to keep (one fact or preference)." },
                "slug": { "type": "string", "description": "Optional id ([a-zA-Z0-9-_]); auto-derived from the text when omitted." }
            },
            "required": ["text"]
        }),
        effect: Effect::Mutating,
    }
}

impl Tool for Remember {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if text.is_empty() {
                return ToolResult::err("remember: missing non-empty string field 'text'");
            }
            // Empty slug counts as omitted — auto-derive instead of erroring.
            let slug = match args
                .get("slug")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(s) if !valid_slug(s) => {
                    return ToolResult::err(format!(
                        "remember: invalid slug '{s}' ([a-zA-Z0-9-_], max 64 chars)"
                    ));
                }
                Some(s) => s.to_string(),
                None => auto_slug(text),
            };
            if ctx.dry_run {
                return ToolResult::ok(format!("would remember '{slug}'"));
            }
            let note = json!({ "text": text, "ts": (self.now_ms)() });
            match self.kv.set(&key(&slug), note).await {
                Ok(()) => ToolResult::ok(format!("remembered '{slug}'")),
                Err(e) => ToolResult::err(format!("remember: store: {e:?}")),
            }
        })
    }
}

struct Recall {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
}

fn recall_spec() -> ToolSpec {
    ToolSpec {
        name: "recall".into(),
        description: "Lists saved memory notes newest-first (no query) or \
                      searches them by case-insensitive substring over slugs \
                      and text. Check memory before asking the user again."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Optional substring to look for." }
            }
        }),
        effect: Effect::Pure,
    }
}

impl Tool for Recall {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|q| !q.is_empty());
            let mut notes = match load_notes(&self.kv).await {
                Ok(notes) => notes,
                Err(e) => return ToolResult::err(format!("recall: {e}")),
            };
            if let Some(q) = query {
                let needle = q.to_lowercase();
                notes.retain(|(slug, text, _)| {
                    slug.to_lowercase().contains(&needle) || text.to_lowercase().contains(&needle)
                });
                if notes.is_empty() {
                    return ToolResult::ok(format!("no notes match '{q}'"));
                }
            } else if notes.is_empty() {
                return ToolResult::ok("(no memory notes yet)");
            }
            notes.truncate(MAX_NOTES);
            let lines: Vec<String> = notes
                .iter()
                .map(|(slug, text, _)| format!("* {slug} — {text}"))
                .collect();
            ToolResult::ok(lines.join("\n"))
        })
    }
}

struct Forget {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
}

fn forget_spec() -> ToolSpec {
    ToolSpec {
        name: "forget".into(),
        description: "Deletes one memory note by its slug (see recall for slugs).".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "slug": { "type": "string", "description": "Slug of the note to delete." }
            },
            "required": ["slug"]
        }),
        effect: Effect::Mutating,
    }
}

impl Tool for Forget {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(slug) = args
                .get("slug")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                return ToolResult::err("forget: missing non-empty string field 'slug'");
            };
            match self.kv.get(&key(slug)).await {
                Ok(Some(_)) => {}
                Ok(None) => return ToolResult::err(format!("forget: no note '{slug}'")),
                Err(e) => return ToolResult::err(format!("forget: store: {e:?}")),
            }
            if ctx.dry_run {
                return ToolResult::ok(format!("would forget '{slug}'"));
            }
            match self.kv.remove(&key(slug)).await {
                Ok(()) => ToolResult::ok(format!("forgot '{slug}'")),
                Err(e) => ToolResult::err(format!("forget: store: {e:?}")),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::super::testutil::block_on;
    use super::*;
    use crate::state::MemKv;

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

    fn call(reg: &ToolRegistry, name: &str, args: Value) -> ToolResult {
        let set = reg
            .build_tool_set(&["remember".into(), "recall".into(), "forget".into()])
            .unwrap();
        block_on(set.get(name).unwrap().call(args, &mut ToolCtx::default()))
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
}
