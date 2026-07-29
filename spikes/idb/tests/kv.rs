//! Headless-browser probe: round-trip correctness + crude timing.
//! Timing numbers are INDICATIVE (single run, headless Chrome), not a
//! benchmark; they are recorded as ranges in docs/research/indexeddb.md.
#![cfg(target_arch = "wasm32")]

use idb_spike::open;
use serde_json::json;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn now() -> f64 {
    web_sys::window().unwrap().performance().unwrap().now()
}

#[wasm_bindgen_test]
async fn roundtrip() {
    let db = open("spike-d").await.unwrap();
    assert_eq!(db.get("rt/missing").await.unwrap(), None);
    let v = json!({"n": 1, "s": "x", "nest": {"a": [1, 2, 3]}});
    db.put("rt/a", &v).await.unwrap();
    assert_eq!(db.get("rt/a").await.unwrap(), Some(v));
    db.put("rt/a", &json!(2)).await.unwrap(); // overwrite: last write wins
    assert_eq!(db.get("rt/a").await.unwrap(), Some(json!(2)));
}

#[wasm_bindgen_test]
async fn prefix_listing() {
    let db = open("spike-d").await.unwrap();
    for k in ["p/b", "p/a", "q/x"] {
        db.put(k, &json!(1)).await.unwrap();
    }
    assert_eq!(db.list_prefix("p/").await.unwrap(), vec!["p/a", "p/b"]);
    assert!(db.list_prefix("zz/").await.unwrap().is_empty());
}

#[wasm_bindgen_test]
async fn timing_probe() {
    let db = open("spike-d").await.unwrap();
    // ~230-byte payload, roughly one chat-turn metadata record.
    let payload = json!({"role": "user", "text": "x".repeat(200)});
    let mut puts = Vec::with_capacity(100);
    for i in 0..100 {
        let key = format!("t/{i:03}");
        let t0 = now();
        db.put(&key, &payload).await.unwrap();
        puts.push(now() - t0);
    }
    let mut gets = Vec::with_capacity(100);
    for i in 0..100 {
        let key = format!("t/{i:03}");
        let t0 = now();
        let v = db.get(&key).await.unwrap();
        gets.push(now() - t0);
        assert!(v.is_some(), "put earlier in this test");
    }
    report("put(txn-commit)", &mut puts);
    report("get", &mut gets);
}

fn report(name: &str, samples: &mut [f64]) {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = samples.len();
    let sum: f64 = samples.iter().sum();
    console_log!(
        "{name}: n={n} min={:.2}ms p50={:.2}ms p90={:.2}ms max={:.2}ms mean={:.2}ms",
        samples[0],
        samples[n / 2],
        samples[n * 9 / 10],
        samples[n - 1],
        sum / n as f64
    );
}
