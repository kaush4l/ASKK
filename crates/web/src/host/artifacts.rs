//! The artifact READ side (wave-15). The `artifact_publish` tool writes
//! blobs at `artifact/<slug>` whose bytes are one JSON doc:
//! `{title, kind: "html"|"markdown"|"url", content?|url?, ts_ms?}`. This
//! module parses those docs and gives the UI one `HarnessHandle` accessor;
//! a malformed doc is skipped, an empty store is the graceful state.

use std::rc::Rc;

use askk_runtime::state::BlobStore;
use serde_json::Value;

use super::boot::HarnessHandle;

/// Blob path prefix the publish tool writes under.
const PREFIX: &str = "artifact/";

/// One parsed artifact doc — plain data across the ADR-013 seam.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ArtifactDoc {
    pub slug: String,
    pub title: String,
    /// "html" | "url" | "markdown"; unknown kinds coerce to markdown
    /// (plain text is valid markdown — safe for future kinds).
    pub kind: String,
    /// Inline document (`content`) or the external address (`url` kind).
    pub body: String,
    pub ts_ms: u64,
}

/// Parse one blob into a doc. `None` only when the bytes are not a JSON
/// object; fields degrade individually (missing title → the slug).
pub fn parse_doc(slug: &str, bytes: &[u8]) -> Option<ArtifactDoc> {
    let doc: Value = serde_json::from_slice(bytes).ok()?;
    if !doc.is_object() {
        return None;
    }
    let text = |key: &str| {
        doc.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    let kind = match text("kind").as_str() {
        "html" => "html",
        "url" => "url",
        _ => "markdown",
    };
    // The kind names its field; take the other one when it is missing.
    let (primary, fallback) = if kind == "url" {
        ("url", "content")
    } else {
        ("content", "url")
    };
    let body = match text(primary) {
        b if b.is_empty() => text(fallback),
        b => b,
    };
    let title = match text("title") {
        t if t.is_empty() => slug.to_string(),
        t => t,
    };
    Some(ArtifactDoc {
        slug: slug.to_string(),
        title,
        kind: kind.to_string(),
        body,
        ts_ms: doc.get("ts_ms").and_then(Value::as_u64).unwrap_or(0),
    })
}

/// Read + parse every published doc, newest first. Split from the handle
/// method so tests drive it over a `MemBlob`.
async fn collect(blobs: &Rc<dyn BlobStore>) -> Vec<ArtifactDoc> {
    let mut out = Vec::new();
    for path in blobs.list(PREFIX).await.unwrap_or_default() {
        let Ok(Some(bytes)) = blobs.read(&path).await else {
            continue;
        };
        let slug = path.strip_prefix(PREFIX).unwrap_or(&path);
        if let Some(doc) = parse_doc(slug, &bytes) {
            out.push(doc);
        }
    }
    // Newest first; unstamped docs (ts 0) sink to the end, slug breaks ties.
    out.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms).then_with(|| a.slug.cmp(&b.slug)));
    out
}

impl HarnessHandle {
    /// All published artifacts, newest first (the Artifacts stage re-reads
    /// this per refold — the board pattern).
    pub async fn artifacts(&self) -> Vec<ArtifactDoc> {
        collect(&self.blobs).await
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::host::boot::block_on;
    use askk_runtime::state::MemBlob;

    #[test]
    fn parse_reads_the_contract_fields() {
        let doc = parse_doc(
            "report",
            br#"{"title":"Q3 Report","kind":"html","content":"<h1>hi</h1>","ts_ms":42}"#,
        )
        .unwrap();
        assert_eq!(
            doc,
            ArtifactDoc {
                slug: "report".into(),
                title: "Q3 Report".into(),
                kind: "html".into(),
                body: "<h1>hi</h1>".into(),
                ts_ms: 42,
            }
        );
    }

    #[test]
    fn parse_url_kind_takes_the_url_field() {
        let doc = parse_doc(
            "paper",
            br#"{"title":"Paper","kind":"url","url":"https://example.com/x.pdf"}"#,
        )
        .unwrap();
        assert_eq!(doc.kind, "url");
        assert_eq!(doc.body, "https://example.com/x.pdf");
        assert_eq!(doc.ts_ms, 0);
    }

    #[test]
    fn parse_degrades_missing_and_unknown_fields() {
        // No title → slug; unknown kind → markdown; body falls to `url`.
        let doc = parse_doc("notes", br#"{"kind":"webpage","url":"https://a.b"}"#).unwrap();
        assert_eq!(doc.title, "notes");
        assert_eq!(doc.kind, "markdown");
        assert_eq!(doc.body, "https://a.b");
    }

    #[test]
    fn parse_rejects_non_object_bytes() {
        assert_eq!(parse_doc("s", b"not json"), None);
        assert_eq!(parse_doc("s", b"[1,2]"), None);
        assert_eq!(parse_doc("s", b"\"text\""), None);
    }

    #[test]
    fn collect_filters_prefix_and_sorts_newest_first() {
        let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
        for (path, body) in [
            ("artifact/old", br#"{"title":"Old","ts_ms":1}"#.as_slice()),
            ("artifact/new", br#"{"title":"New","ts_ms":9}"#.as_slice()),
            ("artifact/bad", b"{{{".as_slice()), // skipped, never fatal
            ("seg-1.jsonl", b"{}".as_slice()),   // other blobs invisible
        ] {
            block_on(blobs.write(path, body)).unwrap();
        }
        let docs = block_on(collect(&blobs));
        let slugs: Vec<&str> = docs.iter().map(|d| d.slug.as_str()).collect();
        assert_eq!(slugs, vec!["new", "old"]);
    }
}
