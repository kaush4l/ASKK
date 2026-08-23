//! **THE LOG'S SHAPE IS A MIGRATION SURFACE, AND THIS EXECUTES THAT CLAIM.**
//!
//! `core::log::store::persist` writes every event to `events/{seq}` as serde
//! JSON. `core::boot::replay_events` reads them back at boot and its own doc
//! comment says corrupt records "refuse boot loudly (ADR-005: no silent drops
//! of history)". Put those two together and a field added to an `EventKind`
//! variant without `#[serde(default)]` is not a degradation — it is a brick:
//! every browser holding a log written by an earlier deploy fails to boot, and
//! `I11 Updatable` ("any release is reachable by refresh, with migrations,
//! without data loss") is broken by a one-line struct edit.
//!
//! That reasoning lived in nobody's head and in no command. It lives here now,
//! because I17 says a claim the gate cannot execute is not a verified claim,
//! and "the migration is safe" is exactly such a claim.
//!
//! WHAT IT DOES NOT COVER, SAID PLAINLY. This pins DESERIALIZATION of a record
//! written before a field existed. It does not pin the boot path end to end —
//! `replay_events` is `pub(crate)` behind an async `StorePort`, and reaching it
//! would need a store double this test does not have. The machine fact that
//! would settle the wider claim is a `pub` replay entry point taking raw
//! records; there is none, so the narrower claim is what is asserted.

use kernel::{Event, EventKind};

/// A `ModelCalled` record exactly as deploys before `evicted` wrote it: two
/// fields, no third. Verbatim JSON and not a re-serialization of today's type,
/// which would only prove serde round-trips with itself.
const BEFORE_EVICTED: &str = r#"{
  "id": 7,
  "seq": 7,
  "at": 1753800000000,
  "kind": { "ModelCalled": { "document_hash": "abc123def4567890", "spent_tokens": 512 } }
}"#;

/// **A LOG WRITTEN BEFORE THE FIELD EXISTED STILL READS.** Positive control:
/// delete `#[serde(default)]` from `evicted` in `crates/kernel/src/event.rs`
/// and this goes red with "missing field `evicted`" — which is precisely the
/// error every existing browser would have refused to boot with.
#[test]
fn a_record_written_before_the_evicted_field_still_replays() {
    let event: Event = serde_json::from_str(BEFORE_EVICTED)
        .expect("a ModelCalled record from an earlier deploy must still deserialize");
    match event.kind {
        EventKind::ModelCalled { document_hash, spent_tokens, evicted } => {
            assert_eq!(document_hash, "abc123def4567890");
            assert_eq!(spent_tokens, 512);
            assert!(
                evicted.is_empty(),
                "a record that never carried the fact must not invent one: {evicted:?}"
            );
        }
        other => panic!("the record read as the wrong fact: {other:?}"),
    }
}

/// …AND THE FIELD IS CARRIED WHEN IT IS THERE. Without this the test above is
/// satisfied by a field serde ignores entirely, which is the failure mode a
/// default quietly produces.
#[test]
fn a_record_that_carries_an_eviction_reads_it_back() {
    let with = r#"{
      "id": 8, "seq": 8, "at": 1753800000000,
      "kind": { "ModelCalled": {
        "document_hash": "f00", "spent_tokens": 1, "evicted": ["observations"]
      } }
    }"#;
    let event: Event = serde_json::from_str(with).expect("a record with the field deserializes");
    let EventKind::ModelCalled { evicted, .. } = event.kind else {
        panic!("wrong fact");
    };
    assert_eq!(evicted, vec![kernel::SectionId("observations".into())]);
}
