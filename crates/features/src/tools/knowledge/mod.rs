//! FEATURE: OKF knowledge bundle — `knowledge_write`/`read`/`list`/`search`
//! over `KvStore` keys `okf/<id>` + `okf/log` (ADR-024); persists across
//! runs/reloads.
//!
//! The agents' curated, persistent knowledge
//! layer in Google's Open Knowledge Format v0.1 (a directory of markdown
//! concept files with YAML frontmatter; the only REQUIRED field is `type`).
//! Concepts persist in the injected `KvStore` under `okf/<concept-id>`
//! (OPFS-backed in the browser), so knowledge survives runs and reloads;
//! `okf/log` mirrors OKF's reserved log.md (newest-first date groups).
//! Spec: github.com/GoogleCloudPlatform/knowledge-catalog okf/SPEC.md.

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use askk_state::{KvStore, LocalBoxFuture};

use super::registry::{RegistryError, ToolRegistry};

const PREFIX: &str = "okf/";
const LOG_KEY: &str = "okf/log";
const MAX_HITS: usize = 8;

/// Registers the four knowledge tools over the given store + clock.
pub fn register_knowledge(
    reg: &mut ToolRegistry,
    kv: Rc<dyn KvStore>,
    now_ms: impl Fn() -> u64 + Clone + 'static,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(KnowledgeWrite {
        spec: write_spec(),
        kv: kv.clone(),
        now_ms: Box::new(now_ms),
    }))?;
    reg.register(Rc::new(KnowledgeRead {
        spec: read_spec(),
        kv: kv.clone(),
    }))?;
    reg.register(Rc::new(KnowledgeList {
        spec: list_spec(),
        kv: kv.clone(),
    }))?;
    reg.register(Rc::new(KnowledgeSearch {
        spec: search_spec(),
        kv,
    }))
}

fn key(id: &str) -> String {
    format!("{PREFIX}{id}")
}

/// Concept ids are bundle-relative paths minus `.md`: `news/okf-launch`.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && !id.ends_with(".md")
        && id != "log"
        && !id.starts_with('/')
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
}

/// Civil date from unix ms (Howard Hinnant's algorithm) — no chrono below web.
fn iso_date(ms: u64) -> String {
    let days = (ms / 86_400_000) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Compose a conformant OKF concept document (frontmatter + body).
fn compose(args: &Value, date: &str) -> Result<String, String> {
    let field = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim);
    let kind = field("type").filter(|t| !t.is_empty()).ok_or(
        "OKF conformance: non-empty 'type' is the one required frontmatter field".to_string(),
    )?;
    let mut fm = format!("---\ntype: {kind}\n");
    for k in ["title", "description", "resource"] {
        if let Some(v) = field(k).filter(|v| !v.is_empty()) {
            fm.push_str(&format!("{k}: {v}\n"));
        }
    }
    if let Some(tags) = args.get("tags").and_then(Value::as_array) {
        let list: Vec<&str> = tags.iter().filter_map(Value::as_str).collect();
        if !list.is_empty() {
            fm.push_str(&format!("tags: [{}]\n", list.join(", ")));
        }
    }
    fm.push_str(&format!("timestamp: {date}\n---\n\n"));
    let body = field("body").unwrap_or("");
    Ok(format!("{fm}{body}\n"))
}

/// First frontmatter value for `key:` in a stored concept, for listings.
fn frontmatter_value<'a>(doc: &'a str, key: &str) -> Option<&'a str> {
    let rest = doc.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    rest[..end]
        .lines()
        .find_map(|l| l.strip_prefix(&format!("{key}: ")))
        .map(str::trim)
}

struct KnowledgeWrite {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
    now_ms: Box<dyn Fn() -> u64>,
}

fn write_spec() -> ToolSpec {
    ToolSpec {
        name: "knowledge_write".into(),
        description: "Saves (or overwrites) a concept in the persistent OKF \
                      knowledge bundle: one markdown file with frontmatter. \
                      Use it to keep what you learned — news findings, facts, \
                      runbooks — recallable in later runs via knowledge_search."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Concept id (path, no .md), e.g. news/okf-launch." },
                "type": { "type": "string", "description": "Concept kind, e.g. News Finding, Runbook, API." },
                "title": { "type": "string" },
                "description": { "type": "string", "description": "One-sentence summary." },
                "tags": { "type": "array", "items": { "type": "string" } },
                "body": { "type": "string", "description": "Markdown body (headings/lists/tables preferred)." }
            },
            "required": ["id", "type", "body"]
        }),
        effect: Effect::Mutating,
    }
}

impl Tool for KnowledgeWrite {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(id) = args.get("id").and_then(Value::as_str).map(str::trim) else {
                return ToolResult::err("knowledge_write: missing string field 'id'");
            };
            if !valid_id(id) {
                return ToolResult::err(format!(
                    "knowledge_write: invalid id '{id}' (path segments of \
                     [a-zA-Z0-9-_.], no .md suffix, no leading /, not 'log')"
                ));
            }
            let date = iso_date((self.now_ms)());
            let doc = match compose(&args, &date) {
                Ok(doc) => doc,
                Err(e) => return ToolResult::err(format!("knowledge_write: {e}")),
            };
            if ctx.dry_run {
                return ToolResult::ok(format!("would write concept {id} ({} bytes)", doc.len()));
            }
            let existed = matches!(self.kv.get(&key(id)).await, Ok(Some(_)));
            if let Err(e) = self.kv.set(&key(id), Value::String(doc)).await {
                return ToolResult::err(format!("knowledge_write: store: {e:?}"));
            }
            // OKF log.md convention: newest-first date groups.
            let verb = if existed { "Update" } else { "Creation" };
            let entry = format!("* **{verb}**: [{id}](/{id}.md)");
            let log = match self.kv.get(LOG_KEY).await {
                Ok(Some(Value::String(s))) => s,
                _ => String::from("# Knowledge update log\n"),
            };
            let log = if log.contains(&format!("## {date}")) {
                log.replacen(&format!("## {date}"), &format!("## {date}\n{entry}"), 1)
            } else {
                log.replacen(
                    "# Knowledge update log\n",
                    &format!("# Knowledge update log\n\n## {date}\n{entry}\n"),
                    1,
                )
            };
            let _ = self.kv.set(LOG_KEY, Value::String(log)).await;
            ToolResult::ok(format!("saved concept {id}"))
        })
    }
}

struct KnowledgeRead {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
}

fn read_spec() -> ToolSpec {
    ToolSpec {
        name: "knowledge_read".into(),
        description: "Reads one concept (or 'log' for the update history) \
                      from the OKF knowledge bundle, returning its full \
                      markdown."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Concept id from knowledge_list/search, or 'log'." }
            },
            "required": ["id"]
        }),
        effect: Effect::Pure,
    }
}

impl Tool for KnowledgeRead {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(id) = args.get("id").and_then(Value::as_str).map(str::trim) else {
                return ToolResult::err("knowledge_read: missing string field 'id'");
            };
            match self.kv.get(&key(id)).await {
                Ok(Some(Value::String(doc))) => ToolResult::ok(doc),
                Ok(_) => ToolResult::err(format!("knowledge_read: no concept '{id}'")),
                Err(e) => ToolResult::err(format!("knowledge_read: store: {e:?}")),
            }
        })
    }
}

struct KnowledgeList {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
}

fn list_spec() -> ToolSpec {
    ToolSpec {
        name: "knowledge_list".into(),
        description: "Lists every concept in the OKF knowledge bundle as an \
                      index (id — type — description)."
            .into(),
        input_schema: json!({ "type": "object", "properties": {} }),
        effect: Effect::Pure,
    }
}

impl Tool for KnowledgeList {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, _args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let keys = match self.kv.list_prefix(PREFIX).await {
                Ok(keys) => keys,
                Err(e) => return ToolResult::err(format!("knowledge_list: store: {e:?}")),
            };
            let mut lines = Vec::new();
            for k in keys.iter().filter(|k| k.as_str() != LOG_KEY) {
                let id = &k[PREFIX.len()..];
                let (kind, desc) = match self.kv.get(k).await {
                    Ok(Some(Value::String(doc))) => (
                        frontmatter_value(&doc, "type").unwrap_or("?").to_string(),
                        frontmatter_value(&doc, "description")
                            .unwrap_or("")
                            .to_string(),
                    ),
                    _ => ("?".into(), String::new()),
                };
                lines.push(format!("* [{id}](/{id}.md) — {kind} — {desc}"));
            }
            if lines.is_empty() {
                return ToolResult::ok("(knowledge bundle is empty)");
            }
            ToolResult::ok(lines.join("\n"))
        })
    }
}

struct KnowledgeSearch {
    spec: ToolSpec,
    kv: Rc<dyn KvStore>,
}

fn search_spec() -> ToolSpec {
    ToolSpec {
        name: "knowledge_search".into(),
        description: "Searches the OKF knowledge bundle (ids, frontmatter, \
                      bodies; case-insensitive) and returns matching concepts \
                      with the first matching line."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Substring to look for." }
            },
            "required": ["query"]
        }),
        effect: Effect::Pure,
    }
}

impl Tool for KnowledgeSearch {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(q) = args
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|q| !q.is_empty())
            else {
                return ToolResult::err("knowledge_search: missing string field 'query'");
            };
            let needle = q.to_lowercase();
            let keys = match self.kv.list_prefix(PREFIX).await {
                Ok(keys) => keys,
                Err(e) => return ToolResult::err(format!("knowledge_search: store: {e:?}")),
            };
            let mut hits = Vec::new();
            for k in keys.iter().filter(|k| k.as_str() != LOG_KEY) {
                if hits.len() >= MAX_HITS {
                    break;
                }
                let id = &k[PREFIX.len()..];
                let Ok(Some(Value::String(doc))) = self.kv.get(k).await else {
                    continue;
                };
                if id.to_lowercase().contains(&needle) || doc.to_lowercase().contains(&needle) {
                    let line = doc
                        .lines()
                        .find(|l| l.to_lowercase().contains(&needle))
                        .unwrap_or("")
                        .trim();
                    hits.push(format!("* [{id}](/{id}.md) — {line}"));
                }
            }
            if hits.is_empty() {
                return ToolResult::ok(format!("no knowledge matches '{q}'"));
            }
            ToolResult::ok(hits.join("\n"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::block_on;
    use super::*;
    use askk_state::MemKv;

    fn setup() -> (ToolRegistry, Rc<MemKv>) {
        let kv = Rc::new(MemKv::new());
        let mut reg = ToolRegistry::new();
        register_knowledge(&mut reg, kv.clone(), || 1_783_776_000_000).unwrap(); // 2026-07-11 UTC
        (reg, kv)
    }

    fn call(reg: &ToolRegistry, name: &str, args: Value) -> ToolResult {
        let set = reg
            .build_tool_set(&[
                "knowledge_write".into(),
                "knowledge_read".into(),
                "knowledge_list".into(),
                "knowledge_search".into(),
            ])
            .unwrap();
        block_on(set.get(name).unwrap().call(args, &mut ToolCtx::default()))
    }

    #[test]
    fn write_read_round_trip_is_conformant_okf() {
        let (reg, _) = setup();
        let out = call(
            &reg,
            "knowledge_write",
            json!({
                "id": "news/okf-launch",
                "type": "News Finding",
                "title": "Google ships OKF",
                "description": "Open Knowledge Format v0.1 released.",
                "tags": ["news", "ai"],
                "body": "# Summary\n\nOKF is markdown + frontmatter.\n\n# Citations\n\n[1] [spec](https://github.com/GoogleCloudPlatform/knowledge-catalog)"
            }),
        );
        assert!(out.ok, "{}", out.content);
        let doc = call(&reg, "knowledge_read", json!({"id": "news/okf-launch"}));
        assert!(doc.ok);
        assert!(doc.content.starts_with("---\ntype: News Finding\n"));
        assert!(doc.content.contains("timestamp: 2026-07-11"));
        assert!(doc.content.contains("tags: [news, ai]"));
        assert!(doc.content.contains("# Citations"));
    }

    #[test]
    fn type_is_the_one_required_field() {
        let (reg, _) = setup();
        let out = call(
            &reg,
            "knowledge_write",
            json!({"id": "x", "body": "no type"}),
        );
        assert!(!out.ok);
        assert!(out.content.contains("type"));
    }

    #[test]
    fn ids_are_validated_and_log_is_reserved() {
        let (reg, _) = setup();
        for bad in ["", "log", "/abs", "a/../b", "has space", "file.md"] {
            let out = call(
                &reg,
                "knowledge_write",
                json!({"id": bad, "type": "T", "body": "b"}),
            );
            assert!(!out.ok, "id '{bad}' should be rejected");
        }
    }

    #[test]
    fn list_and_search_surface_concepts() {
        let (reg, _) = setup();
        for (id, desc) in [("a/one", "first thing"), ("b/two", "second thing")] {
            call(
                &reg,
                "knowledge_write",
                json!({"id": id, "type": "Note", "description": desc, "body": "needle here"}),
            );
        }
        let listing = call(&reg, "knowledge_list", json!({}));
        assert!(listing.ok);
        assert!(listing
            .content
            .contains("[a/one](/a/one.md) — Note — first thing"));
        assert!(listing.content.contains("[b/two]"));
        let found = call(&reg, "knowledge_search", json!({"query": "NEEDLE"}));
        assert!(found.ok);
        assert!(found.content.contains("a/one"));
        assert!(found.content.contains("needle here"));
        let none = call(&reg, "knowledge_search", json!({"query": "absent"}));
        assert!(none.ok);
        assert!(none.content.contains("no knowledge matches"));
    }

    #[test]
    fn log_groups_by_date_newest_first_and_tracks_verbs() {
        let (reg, _) = setup();
        call(
            &reg,
            "knowledge_write",
            json!({"id": "n", "type": "T", "body": "v1"}),
        );
        call(
            &reg,
            "knowledge_write",
            json!({"id": "n", "type": "T", "body": "v2"}),
        );
        let log = call(&reg, "knowledge_read", json!({"id": "log"}));
        assert!(log.ok);
        assert!(log.content.contains("## 2026-07-11"));
        assert!(log.content.contains("**Creation**: [n](/n.md)"));
        assert!(log.content.contains("**Update**: [n](/n.md)"));
    }

    #[test]
    fn dry_run_touches_nothing() {
        let (reg, kv) = setup();
        let set = reg.build_tool_set(&["knowledge_write".into()]).unwrap();
        let mut ctx = ToolCtx::default();
        ctx.dry_run = true;
        let out = block_on(
            set.get("knowledge_write")
                .unwrap()
                .call(json!({"id": "ghost", "type": "T", "body": "b"}), &mut ctx),
        );
        assert!(out.ok);
        assert!(out.content.contains("would write"));
        assert!(block_on(kv.get("okf/ghost")).unwrap().is_none());
    }

    #[test]
    fn iso_date_converts_unix_ms() {
        assert_eq!(iso_date(0), "1970-01-01");
        assert_eq!(iso_date(1_783_776_000_000), "2026-07-11");
        assert_eq!(iso_date(1_783_825_000_000), "2026-07-12"); // past midnight UTC
    }
}
