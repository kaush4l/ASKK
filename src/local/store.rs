//! # The tab's disk form of the store
//!
//! [`Store`] is synchronous; a browser's disk is not. So the working copy is a bundle in memory
//! (every read and write is answered from it at once) and the disk follows: a write marks its
//! key *dirty*, and the dirty keys go to IndexedDB (`store.js`) together, in one transaction,
//! right after the code that wrote them yields. An engine step's writes land all or none.
//!
//! What can be lost: only writes made in the instant before the tab dies — and a run cut off
//! that way is read back as `interrupted` at the next boot, as on the server.
//!
//! One tab writes a world ([`open`] takes a browser lock for the tab's life), the same rule as
//! the server's `askk.pid`.
use crate::core::held::Held;
use crate::core::store::{export, join, Bundle, Entry, Store};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
use std::sync::{Arc, Mutex, OnceLock};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/local/store.js")]
extern "C" {
    #[wasm_bindgen(catch)]
    async fn load() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn write(puts: String, removes: String) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn lock() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn persist() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn reset() -> Result<JsValue, JsValue>;
}

/// A bundle in memory whose writes follow to the browser's disk.
pub struct Kept {
    mem: Bundle,
    /// Keys written or deleted since the last flush; what each holds is read at flush time.
    dirty: Mutex<BTreeSet<String>>,
    flushing: AtomicBool,
}

/// What the page shows about the disk.
#[derive(Clone, Default, PartialEq)]
pub struct Status {
    /// This tab holds the world (false: another tab does, and this one runs nothing).
    pub held: bool,
    /// Keys read from the disk at start (0 = a fresh world, seeded from the defaults).
    pub restored: usize,
    /// The browser agreed not to evict the data.
    pub persisted: bool,
    /// Transactions written since start.
    pub flushes: usize,
    pub error: String,
}

static KEPT: OnceLock<Arc<Kept>> = OnceLock::new();
static STATUS: Mutex<Status> = Mutex::new(Status { held: false, restored: 0, persisted: false, flushes: 0, error: String::new() });
static FLUSHES: AtomicUsize = AtomicUsize::new(0);

pub fn status() -> Status {
    let mut s = STATUS.held().clone();
    s.flushes = FLUSHES.load(SeqCst);
    s
}

fn fail(what: &str, e: JsValue) {
    STATUS.held().error = format!("{what}: {e:?}");
}

impl Kept {
    /// `key` and every key under it.
    fn under(&self, key: &str) -> Vec<String> {
        let mut out: Vec<String> = export(&self.mem, key).into_keys().collect();
        out.push(key.to_string());
        out
    }

    fn mark(&self, keys: impl IntoIterator<Item = String>) {
        self.dirty.held().extend(keys);
        if self.flushing.swap(true, SeqCst) {
            return;
        }
        // Runs once the writer yields, so everything it wrote in one go is one transaction.
        wasm_bindgen_futures::spawn_local(async {
            let Some(kept) = KEPT.get() else { return };
            loop {
                let batch = std::mem::take(&mut *kept.dirty.held());
                if batch.is_empty() {
                    break;
                }
                let mut puts = BTreeMap::new();
                let mut removes = vec![];
                for k in batch {
                    match kept.mem.get(&k) {
                        Some(text) => drop(puts.insert(k, text)),
                        None => removes.push(k),
                    }
                }
                match write(serde_json::to_string(&puts).unwrap_or_default(), serde_json::to_string(&removes).unwrap_or_default()).await {
                    Ok(_) => drop(FLUSHES.fetch_add(1, SeqCst)),
                    Err(e) => fail("write", e),
                }
            }
            kept.flushing.store(false, SeqCst);
        });
    }
}

impl Store for Kept {
    fn get(&self, key: &str) -> Option<String> {
        self.mem.get(key)
    }
    fn put(&self, key: &str, text: &str) -> Result<(), String> {
        self.mem.put(key, text)?;
        self.mark([key.to_string()]);
        Ok(())
    }
    fn list(&self, key: &str) -> Vec<Entry> {
        self.mem.list(key)
    }
    fn has(&self, key: &str) -> bool {
        self.mem.has(key)
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let old = self.under(from);
        self.mem.rename(from, to)?;
        let new: Vec<String> = old.iter().map(|k| join(to, k[from.len()..].trim_start_matches('/'))).collect();
        self.mark(old.into_iter().chain(new));
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), String> {
        let old = self.under(key);
        self.mem.remove(key)?;
        self.mark(old);
        Ok(())
    }
}

/// Take the world for this tab and read it from the disk; the app's data store is set from it.
/// Without the lock nothing is set: the tab keeps the core's empty store and boots no engine.
pub async fn open() {
    let held = lock().await.ok().and_then(|v| v.as_bool()).unwrap_or(false);
    STATUS.held().held = held;
    if !held {
        return;
    }
    let keys: BTreeMap<String, String> = match load().await {
        Ok(v) => v.as_string().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        Err(e) => {
            fail("read", e);
            Default::default()
        }
    };
    let persisted = persist().await.ok().and_then(|v| v.as_bool()).unwrap_or(false);
    {
        let mut s = STATUS.held();
        s.restored = keys.len();
        s.persisted = persisted;
    }
    let kept = Arc::new(Kept { mem: Bundle::memory(keys), dirty: Default::default(), flushing: AtomicBool::new(false) });
    let _ = KEPT.set(kept.clone());
    crate::core::store::set_data(kept);
}

/// Delete the whole world on the disk and start over (the page loads again).
pub fn wipe() {
    // A tab that does not hold the world must not delete it under the one that does.
    if !status().held {
        return;
    }
    wasm_bindgen_futures::spawn_local(async {
        if let Err(e) = reset().await {
            fail("reset", e);
        }
    });
}
