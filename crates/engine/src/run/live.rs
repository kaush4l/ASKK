//! Live artifact refresh (ADR-033): task-scoped state whose LATEST version
//! is re-read from its source before every LLM call — the model sees current
//! state, never the mutation trail. Split from `turn.rs` for the ADR-012 cap.

use crate::config::AgentConfig;
use crate::run::session::{RunState, Shared};

/// Per-artifact prompt budget: enough for a working document, never enough
/// to swallow the context window. Head-clamped with a visible marker.
const ARTIFACT_PROMPT_CHARS: usize = 4_000;

/// The run's live ARTIFACT blocks, re-read from their sources NOW (ADR-033):
/// the latest body of every artifact this run published. Latest state only;
/// the mutation trail stays out of context.
pub(crate) async fn live_artifacts(
    shared: &Shared,
    run: &RunState,
    _agent: &AgentConfig,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if !run.published.is_empty() {
        let blobs = shared.log.lock().await.blobs();
        for slug in &run.published {
            let Ok(Some(bytes)) = blobs.read(&format!("artifact/{slug}")).await else {
                continue;
            };
            let Ok(doc) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
                continue;
            };
            let body = doc
                .get("content")
                .or_else(|| doc.get("url"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let total = body.chars().count();
            let shown = if total > ARTIFACT_PROMPT_CHARS {
                let head: String = body.chars().take(ARTIFACT_PROMPT_CHARS).collect();
                format!(
                    "{head}
[…clipped: {total} chars total…]"
                )
            } else {
                body.to_string()
            };
            out.push((slug.clone(), shown));
        }
    }
    out
}
