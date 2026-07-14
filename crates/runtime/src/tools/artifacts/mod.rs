//! FEATURE: artifacts — `artifact_publish` writes blob `artifact/<slug>`;
//! read side web/src/host/artifacts.rs; gallery ui/artifacts.rs; live re-read
//! run/live.rs.
//!
//! `artifact_publish` — agents publish BIG deliverables (a full HTML page, a
//! markdown report, an external URL/PDF) as named blobs a viewer can render
//! full-size in every tab. One blob per artifact under `artifact/<slug>`;
//! the dispatch seam detects this tool's success and emits
//! `ArtifactAppended { name: slug }`, so the slug lands in
//! `RunProjection.artifacts` and the signal log stays the run-state truth.

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::state::{BlobStore, LocalBoxFuture};

use super::registry::{RegistryError, ToolRegistry};

/// The tool name dispatch keys the `ArtifactAppended` emission on.
pub(crate) const ARTIFACT_TOOL: &str = "artifact_publish";
const PREFIX: &str = "artifact/";
/// Generous but bounded: one artifact may not swallow the blob store.
const MAX_CONTENT_CHARS: usize = 512_000;

/// Registers `artifact_publish` over the given blob store + clock.
pub fn register_artifacts(
    reg: &mut ToolRegistry,
    blobs: Rc<dyn BlobStore>,
    now_ms: impl Fn() -> u64 + 'static,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(ArtifactPublish {
        spec: publish_spec(),
        blobs,
        now_ms: Box::new(now_ms),
    }))
}

/// Slug of a successful publish result (`published artifact [<slug>] …`).
/// `None` for anything else — dry-run previews and errors carry no slug, so
/// dispatch emits no `ArtifactAppended` for them.
pub(crate) fn published_slug(content: &str) -> Option<&str> {
    content
        .strip_prefix("published artifact [")?
        .split_once(']')
        .map(|(slug, _)| slug)
}

/// Board-store slug pattern: lowercase alphanumeric runs joined by `-`.
fn slug(title: &str) -> String {
    let s: String = title
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let parts: Vec<&str> = s.split('-').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        "artifact".to_string()
    } else {
        parts.join("-")
    }
}

struct ArtifactPublish {
    spec: ToolSpec,
    blobs: Rc<dyn BlobStore>,
    now_ms: Box<dyn Fn() -> u64>,
}

fn publish_spec() -> ToolSpec {
    ToolSpec {
        name: ARTIFACT_TOOL.into(),
        description: "Publishes a substantial deliverable — a complete HTML \
                      webpage, a markdown report, or an external URL/PDF link \
                      — as a named artifact every tab can view full-size. Use \
                      it for big outputs instead of pasting them into chat."
            .into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Human-readable artifact name; becomes its slug." },
                "kind": { "type": "string", "description": "html | markdown | url" },
                "content": { "type": "string", "description": "The full document (html/markdown kinds)." },
                "url": { "type": "string", "description": "https:// link to the external page or PDF (url kind)." }
            },
            "required": ["title", "kind"]
        }),
        effect: Effect::Mutating,
    }
}

/// Validate args down to the body that will be stored (content or url).
fn body_for(args: &Value, kind: &str) -> Result<(String, &'static str), String> {
    let field = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim);
    match kind {
        "html" | "markdown" => {
            let content = field("content").filter(|c| !c.is_empty()).ok_or(format!(
                "kind '{kind}' requires a non-empty 'content' with the full document"
            ))?;
            let chars = content.chars().count();
            if chars > MAX_CONTENT_CHARS {
                return Err(format!(
                    "content is {chars} chars; the cap is {MAX_CONTENT_CHARS}. \
                     Publish a trimmed version."
                ));
            }
            Ok((content.to_string(), "content"))
        }
        "url" => {
            let url = field("url")
                .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
                .ok_or("kind 'url' requires 'url' starting with https:// or http://")?;
            Ok((url.to_string(), "url"))
        }
        other => Err(format!(
            "unknown kind '{other}' (expected html, markdown, or url)"
        )),
    }
}

impl Tool for ArtifactPublish {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(title) = args
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|t| !t.is_empty())
            else {
                return ToolResult::err("artifact_publish: missing non-empty string field 'title'");
            };
            let kind = args
                .get("kind")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            let (body, body_key) = match body_for(&args, kind) {
                Ok(pair) => pair,
                Err(e) => return ToolResult::err(format!("artifact_publish: {e}")),
            };
            let chars = body.chars().count();
            if ctx.dry_run {
                return ToolResult::ok(format!(
                    "would publish artifact '{title}' ({kind}, {chars} chars)"
                ));
            }
            // Dedupe like the board store: slug, then -2, -3… on collision.
            // ponytail: same-turn parallel publishes of one title race this
            // list (last writer wins, like board/ADR-015); a reserving write
            // is the upgrade if concurrent same-title publishes ever matter.
            let existing = match self.blobs.list(PREFIX).await {
                Ok(paths) => paths,
                Err(e) => return ToolResult::err(format!("artifact_publish: store: {e}")),
            };
            let base = slug(title);
            let mut name = base.clone();
            let mut n = 1u32;
            while existing.contains(&format!("{PREFIX}{name}")) {
                n += 1;
                name = format!("{base}-{n}");
            }
            let doc = json!({
                "title": title,
                "kind": kind,
                body_key: body,
                "ts": (self.now_ms)(),
            });
            let bytes = doc.to_string();
            if let Err(e) = self
                .blobs
                .write(&format!("{PREFIX}{name}"), bytes.as_bytes())
                .await
            {
                return ToolResult::err(format!("artifact_publish: store: {e}"));
            }
            ToolResult::ok(format!(
                "published artifact [{name}] '{title}' ({kind}, {chars} chars)"
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::block_on;
    use super::*;
    use crate::state::MemBlob;

    fn setup() -> (ToolRegistry, Rc<MemBlob>) {
        let blobs = Rc::new(MemBlob::new());
        let mut reg = ToolRegistry::new();
        register_artifacts(&mut reg, blobs.clone(), || 7).unwrap();
        (reg, blobs)
    }

    fn call(reg: &ToolRegistry, args: Value) -> ToolResult {
        let set = reg.build_tool_set(&[ARTIFACT_TOOL.into()]).unwrap();
        block_on(
            set.get(ARTIFACT_TOOL)
                .unwrap()
                .call(args, &mut ToolCtx::default()),
        )
    }

    #[test]
    fn publish_html_round_trips_as_json_blob() {
        let (reg, blobs) = setup();
        let out = call(
            &reg,
            json!({"title": "Q3 Report!", "kind": "html", "content": "<h1>Q3</h1>"}),
        );
        assert!(out.ok, "{}", out.content);
        assert_eq!(
            out.content,
            "published artifact [q3-report] 'Q3 Report!' (html, 11 chars)"
        );
        let bytes = block_on(blobs.read("artifact/q3-report")).unwrap().unwrap();
        let doc: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(doc["title"], "Q3 Report!");
        assert_eq!(doc["kind"], "html");
        assert_eq!(doc["content"], "<h1>Q3</h1>");
        assert_eq!(doc["ts"], 7);
    }

    #[test]
    fn url_kind_stores_url_and_requires_scheme() {
        let (reg, blobs) = setup();
        let bad = call(
            &reg,
            json!({"title": "Spec", "kind": "url", "url": "ftp://x"}),
        );
        assert!(!bad.ok);
        assert!(bad.content.contains("https://"), "{}", bad.content);
        let out = call(
            &reg,
            json!({"title": "Spec", "kind": "url", "url": "https://example.com/spec.pdf"}),
        );
        assert!(out.ok, "{}", out.content);
        let bytes = block_on(blobs.read("artifact/spec")).unwrap().unwrap();
        let doc: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(doc["url"], "https://example.com/spec.pdf");
        assert!(doc.get("content").is_none());
    }

    #[test]
    fn slug_collisions_get_numeric_suffixes() {
        let (reg, blobs) = setup();
        for _ in 0..3 {
            let out = call(
                &reg,
                json!({"title": "My Page", "kind": "markdown", "content": "x"}),
            );
            assert!(out.ok, "{}", out.content);
        }
        assert_eq!(
            block_on(blobs.list("artifact/")).unwrap(),
            vec![
                "artifact/my-page",
                "artifact/my-page-2",
                "artifact/my-page-3"
            ]
        );
    }

    #[test]
    fn bad_args_are_readable_errors() {
        let (reg, _) = setup();
        let missing_title = call(&reg, json!({"kind": "html", "content": "x"}));
        assert!(!missing_title.ok);
        assert!(missing_title.content.contains("'title'"));
        let bad_kind = call(&reg, json!({"title": "T", "kind": "pdf", "content": "x"}));
        assert!(!bad_kind.ok);
        assert!(bad_kind.content.contains("unknown kind 'pdf'"));
        let no_content = call(&reg, json!({"title": "T", "kind": "markdown"}));
        assert!(!no_content.ok);
        assert!(no_content.content.contains("non-empty 'content'"));
        let oversize = call(
            &reg,
            json!({"title": "T", "kind": "html", "content": "x".repeat(MAX_CONTENT_CHARS + 1)}),
        );
        assert!(!oversize.ok);
        assert!(
            oversize.content.contains("cap is 512000"),
            "{}",
            oversize.content
        );
    }

    #[test]
    fn dry_run_previews_and_writes_nothing() {
        let (reg, blobs) = setup();
        let set = reg.build_tool_set(&[ARTIFACT_TOOL.into()]).unwrap();
        let mut ctx = ToolCtx::default();
        ctx.dry_run = true;
        let out = block_on(set.get(ARTIFACT_TOOL).unwrap().call(
            json!({"title": "Ghost", "kind": "markdown", "content": "boo"}),
            &mut ctx,
        ));
        assert!(out.ok);
        assert!(out.content.contains("would publish"));
        assert!(published_slug(&out.content).is_none()); // no ArtifactAppended
        assert!(block_on(blobs.list("artifact/")).unwrap().is_empty());
    }

    #[test]
    fn published_slug_parses_only_the_ok_shape() {
        assert_eq!(
            published_slug("published artifact [q3-report] 'Q3' (html, 9 chars)"),
            Some("q3-report")
        );
        assert_eq!(
            published_slug("would publish artifact 'Q3' (html, 9 chars)"),
            None
        );
        assert_eq!(published_slug("artifact_publish: unknown kind 'pdf'"), None);
    }

    #[test]
    fn slug_falls_back_when_title_has_no_alphanumerics() {
        assert_eq!(slug("!!!"), "artifact");
        assert_eq!(slug("  Hello,  World  "), "hello-world");
    }
}
