//! ARTIFACTS, HOSTED: where a space's shelf actually lives, and the one reader
//! both halves of the faculty share. `agent::artifact` decides; this directory
//! moves the bytes, exactly as `super::shared` does for the space itself.
//!
//! **It lives in `Ports::spaces`, not in `Ports::store`, and that is the whole
//! placement decision.** `spaces` is ONE database (`harness-spaces`) that the
//! page and every sub-agent's Worker open by the same name
//! (`crates/adapters_web/src/worker/world.rs:40`), which is what makes a shelf
//! one shelf across threads that share no memory. `store` is the opposite by
//! construction — `harness-agent-<name>` per Worker — and a deliverable put
//! there would be invisible to the group that asked for it.
//!
//! **The key layout is `space/<space>/a/<name>`, one key per artifact.** One
//! mutation is therefore one store operation, with no half of a single put and
//! no read-modify-write of a whole document — the rule `super::shared` states at
//! `crates/core/src/space/shared.rs:11-14` and the reason it states it. The `a/`
//! prefix sits beside the `f/` and `n/` that space already owns, and
//! `shared::load` ignores it: its `rest.split_once('/')` matches only those two.
//!
//! Keyed by NAME rather than by a stamp, unlike a note, because re-recording an
//! artifact must REPLACE its record rather than leave two. That is also why the
//! cap is a render cap and not a store cap — `agent::SHELF_LIMIT` says why.
//!
//! Two halves sit beside this index: [`sense`] fills the prompt block before
//! every model call, [`host`] runs `record_artifact` and `read_artifact`. Both
//! read through [`load`], and neither caches.

pub(crate) mod host;
pub(crate) mod sense;

use agent::{Artifact, Shelf};
use kernel::KvStore;

/// The one prefix a space's shelf owns inside `Ports::spaces`.
fn prefix(space: &str) -> String {
    format!("space/{space}/a/")
}

/// The whole shelf of one space, in key order — which is name order, and the
/// order the block renders in.
///
/// A key that will not read, or a record that will not parse, costs THAT
/// artifact and nothing else. Refusing the turn over one unreadable entry would
/// cost the conversation instead, which is `shared::load`'s ruling
/// (`crates/core/src/space/shared.rs:31-33`) and the reason for it.
pub(crate) async fn load(kv: &dyn KvStore, space: &str) -> Shelf {
    let mut shelf = Shelf::default();
    let at = prefix(space);
    for key in kv.list_prefix(&at).await.unwrap_or_default() {
        let Ok(Some(json)) = kv.get(&key).await else {
            continue;
        };
        let Ok(artifact) = serde_json::from_str::<Artifact>(&json) else {
            continue;
        };
        shelf.items.push(artifact);
    }
    shelf
}

/// Perform the ONE operation a record asked for: one put, under the artifact's
/// own key. There is no trim beside it and no second write — see this module's
/// header for why the cap does not live here.
pub(crate) async fn write(
    kv: &dyn KvStore,
    space: &str,
    artifact: &Artifact,
) -> Result<(), String> {
    let json =
        serde_json::to_string(artifact).map_err(|e| format!("the record would not encode: {e}"))?;
    kv.put(&format!("{}{}", prefix(space), artifact.name), &json)
        .await
        .map_err(|e| format!("{e:?}"))
}
