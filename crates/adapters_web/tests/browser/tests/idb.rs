//! `IdbStore` against a REAL IndexedDB (I17). Every claim here was `cargo
//! check`ed and nothing more until this file existed: the host suite runs
//! `MemStore`, a `HashMap` whose futures are already ready, so a transaction
//! that never commits, a key range that leaks, and a `put` that silently drops
//! a value all pass it identically.
//!
//! The port traits are what is exercised — `KvStore`/`BlobStore`, not
//! `IdbStore`'s inherent methods — because a trait object is all the core ever
//! holds (`crates/adapters_web/src/lib.rs:110-118`).

use kernel::{BlobStore, KvStore};
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

use adapters_web::IdbStore;

wasm_bindgen_test_configure!(run_in_browser);

/// One database per test. IndexedDB is per-ORIGIN, and every test in this file
/// shares one page, so a shared name would let one test's leftovers decide
/// another's result — the state-bleed that makes a browser suite unreadable.
async fn store(name: &str) -> IdbStore {
    IdbStore::open(name).await.expect("IdbStore::open")
}

/// The whole `KvStore` contract in one pass. `open` creating its two object
/// stores is the precondition: an `IdbStore` whose `kv` store was never created
/// opens fine and fails on the first transaction, which is why a test that only
/// asserted `open` returned `Ok` would prove nothing.
#[wasm_bindgen_test]
async fn a_value_put_through_the_kv_port_reads_back_and_then_deletes() {
    let store = store("idb-kv").await;
    assert_eq!(store.get("greeting").await.expect("get"), None, "a fresh store is empty");

    store.put("greeting", "hello").await.expect("put");
    assert_eq!(store.get("greeting").await.expect("get"), Some("hello".into()));

    store.put("greeting", "goodbye").await.expect("overwrite");
    assert_eq!(
        store.get("greeting").await.expect("get"),
        Some("goodbye".into()),
        "a second put replaces rather than appends"
    );

    KvStore::delete(&store, "greeting").await.expect("delete");
    assert_eq!(store.get("greeting").await.expect("get"), None);
}

/// The ponytail bound (`idb.rs:64-66`): `list_prefix` is a KEY RANGE, not a
/// `starts_with` filter, and a range's job is to stop. `events0` sorts
/// immediately after `events/` and is the key a wrong upper bound hands back.
#[wasm_bindgen_test]
async fn list_prefix_is_a_range_that_stops_at_the_prefix() {
    let store = store("idb-prefix").await;
    for key in ["events/1", "events/2", "events/10", "events0", "eventt", "meta/x"] {
        store.put(key, "v").await.expect("put");
    }

    let found = KvStore::list_prefix(&store, "events/").await.expect("list_prefix");
    assert_eq!(
        found,
        ["events/1", "events/10", "events/2"],
        "in IndexedDB's key order, and nothing outside the prefix"
    );
}

/// `replace_prefix` is the one method with a REASON to exist: the default
/// implementation would do these writes in separate transactions, and this one
/// does them in one (`idb/kv.rs:59-97`). What is observable from outside is the
/// outcome — the old range gone, the new range there, and a key that merely
/// looks adjacent untouched.
#[wasm_bindgen_test]
async fn replace_prefix_swaps_the_whole_range_and_leaves_its_neighbours() {
    let store = store("idb-replace").await;
    for key in ["events/1", "events/2", "events/3"] {
        store.put(key, "old").await.expect("put");
    }
    store.put("events0", "neighbour").await.expect("put");
    store.put("meta/schema_version", "2").await.expect("put");

    let fresh = vec![("events/1".to_string(), "new".to_string())];
    store.replace_prefix("events/", &fresh).await.expect("replace_prefix");

    assert_eq!(KvStore::list_prefix(&store, "events/").await.expect("list"), ["events/1"]);
    assert_eq!(store.get("events/1").await.expect("get"), Some("new".into()));
    assert_eq!(store.get("events/2").await.expect("get"), None, "the old range is gone");
    assert_eq!(
        store.get("events0").await.expect("get"),
        Some("neighbour".into()),
        "the range stopped where the prefix did"
    );
    assert_eq!(store.get("meta/schema_version").await.expect("get"), Some("2".into()));
}

/// An EMPTY rewrite has only the delete to wait on (`idb/kv.rs:88-95`), and a
/// `match last` that awaited nothing would let the transaction outlive the call
/// — the caller would read the range back before it had emptied.
#[wasm_bindgen_test]
async fn an_empty_replace_prefix_clears_the_range_before_it_returns() {
    let store = store("idb-replace-empty").await;
    store.put("events/1", "old").await.expect("put");

    store.replace_prefix("events/", &[]).await.expect("replace_prefix");

    let found = KvStore::list_prefix(&store, "events/").await.expect("list");
    assert!(found.is_empty(), "still there: {found:?}");
}

/// The blob half. Bytes, not strings: a `Uint8Array` round-trip through
/// IndexedDB's structured clone is a different path from `kv`'s string put, and
/// 0x00 and 0xFF are the two bytes a string-shaped adapter would lose.
#[wasm_bindgen_test]
async fn blob_bytes_survive_the_round_trip_and_a_missing_path_is_none() {
    let store = store("idb-blob").await;
    assert_eq!(store.read("work/absent.bin").await.expect("read"), None);

    let bytes = vec![0u8, 1, 2, 254, 255];
    store.write("work/a.bin", &bytes).await.expect("write");
    assert_eq!(store.read("work/a.bin").await.expect("read"), Some(bytes));

    store.write("work/b.bin", b"b").await.expect("write");
    assert_eq!(
        BlobStore::list_prefix(&store, "work/").await.expect("list"),
        ["work/a.bin", "work/b.bin"]
    );

    BlobStore::delete(&store, "work/a.bin").await.expect("delete");
    assert_eq!(store.read("work/a.bin").await.expect("read"), None);
}
