//! FEATURE: agent-curated notes — `remember`/`recall`/`forget` over `KvStore`;
//! distinct from `state/memory.rs` per-agent digests.
//!
//! Follows the knowledge-tools pattern: one note per key as
//! `{ "text": .., "ts": .. }`; `recall` lists newest first (bounded) or
//! substring-searches slugs + text.
//!
//! Scoping (closes GAPS 49): when the ctx carries `AGENT_ID_SLICE` (set by
//! tool dispatch), notes live under `notes/<agent_id>/<slug>` — writes are
//! per-agent, `recall`/`forget` fall back to legacy shared `notes/<slug>`
//! keys (readable/deletable by all; a scoped note shadows a legacy slug tie).
//! A ctx without the slice (direct/test callers) keeps the flat legacy view.
//! Unambiguous by construction: slugs reject `/` (`valid_slug`) and agent
//! ids are validated slugs, so `notes/x` and `notes/a/x` never collide.
//! Prefix is `notes/` NOT `memory/` — `memory/<agent_id>` is owned by
//! `MemoryStore` digests and a slug equal to an agent id would clobber
//! that agent's memory.

use std::collections::BTreeMap;
use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec, AGENT_ID_SLICE};
use serde_json::{json, Value};

use askk_state::{KvStore, LocalBoxFuture};

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

/// The caller's namespace: `notes/<agent_id>/` when the ctx carries the
/// dispatch-supplied agent id, else the legacy shared `notes/`.
fn prefix(ctx: &ToolCtx) -> String {
    match ctx.slice(AGENT_ID_SLICE).and_then(Value::as_str) {
        Some(id) if !id.is_empty() => format!("{PREFIX}{id}/"),
        _ => PREFIX.to_string(),
    }
}

fn key(ctx: &ToolCtx, slug: &str) -> String {
    format!("{}{slug}", prefix(ctx))
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

/// Tolerant read of one note value: malformed entries are skipped, not fatal.
async fn read_note(kv: &Rc<dyn KvStore>, key: &str) -> Option<(String, u64)> {
    let value = kv.get(key).await.ok()??;
    let text = value.get("text").and_then(Value::as_str)?.to_string();
    let ts = value.get("ts").and_then(Value::as_u64).unwrap_or(0);
    Some((text, ts))
}

/// The caller's visible notes as (slug, text, ts), newest first (ties: slug
/// order). A scoped caller sees its own `notes/<agent_id>/<slug>` notes plus
/// the legacy shared `notes/<slug>` keys (scoped wins on slug ties); an
/// unscoped caller keeps the flat legacy view of everything under `notes/`.
async fn load_notes(
    kv: &Rc<dyn KvStore>,
    ctx: &ToolCtx,
) -> Result<Vec<(String, String, u64)>, String> {
    let scope = prefix(ctx);
    let keys = kv
        .list_prefix(PREFIX)
        .await
        .map_err(|e| format!("store: {e:?}"))?;
    let mut by_slug: BTreeMap<String, (String, u64)> = BTreeMap::new();
    // Legacy pass: bare `notes/<slug>` keys when scoped; every key when not.
    for k in &keys {
        let rem = &k[PREFIX.len()..];
        if scope != PREFIX && rem.contains('/') {
            continue; // some agent's scoped note; own scope reads below
        }
        if let Some(note) = read_note(kv, k).await {
            by_slug.insert(rem.to_string(), note);
        }
    }
    // Scoped pass second: a scoped note shadows a legacy slug tie.
    if scope != PREFIX {
        for k in keys.iter().filter(|k| k.starts_with(&scope)) {
            if let Some(note) = read_note(kv, k).await {
                by_slug.insert(k[scope.len()..].to_string(), note);
            }
        }
    }
    let mut notes: Vec<(String, String, u64)> = by_slug
        .into_iter()
        .map(|(slug, (text, ts))| (slug, text, ts))
        .collect();
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
            match self.kv.set(&key(ctx, &slug), note).await {
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

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|q| !q.is_empty());
            let mut notes = match load_notes(&self.kv, ctx).await {
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
            // Scoped key first, legacy shared `notes/<slug>` as fallback —
            // legacy notes stay deletable by everyone (GAPS 49 migration).
            let scoped = key(ctx, slug);
            let legacy = format!("{PREFIX}{slug}");
            let target = match self.kv.get(&scoped).await {
                Ok(Some(_)) => scoped,
                Ok(None) if scoped != legacy => match self.kv.get(&legacy).await {
                    Ok(Some(_)) => legacy,
                    Ok(None) => return ToolResult::err(format!("forget: no note '{slug}'")),
                    Err(e) => return ToolResult::err(format!("forget: store: {e:?}")),
                },
                Ok(None) => return ToolResult::err(format!("forget: no note '{slug}'")),
                Err(e) => return ToolResult::err(format!("forget: store: {e:?}")),
            };
            if ctx.dry_run {
                return ToolResult::ok(format!("would forget '{slug}'"));
            }
            match self.kv.remove(&target).await {
                Ok(()) => ToolResult::ok(format!("forgot '{slug}'")),
                Err(e) => ToolResult::err(format!("forget: store: {e:?}")),
            }
        })
    }
}

#[cfg(test)]
mod tests;
