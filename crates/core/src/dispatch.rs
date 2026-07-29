//! THE one dispatch point (ADR-004 Option B): route → registry lookup →
//! manifest → invoke by tier. No code outside this file may call module
//! logic — built-in or forged — and no manifest field records origin, so I9
//! erosion is unrepresentable. The CI check is one grep: only this file
//! names built-in handler fns.

use kernel::{ModuleId, Request, Response, Timestamp};

use crate::app::App;

/// A KV view scoped to one prefix (ADR-006: the handle physically cannot
/// form a key outside its slice). Reads are sync against the in-memory
/// projection; writes become `Effect::Persist` — see `core::handle`'s
/// sync-by-design note.
pub struct KvHandle {
    prefix: String,
}

impl KvHandle {
    /// Read one key under the module's prefix (the prefix is prepended here,
    /// not by the caller — callers never spell absolute keys).
    pub fn get(&self, key: &str) -> Option<String> {
        let _ = key;
        todo!("G4")
    }

    /// Stage a write under the prefix; it leaves as an Effect.
    pub fn put(&mut self, key: &str, value: &str) {
        let _ = (key, value);
        todo!("G4")
    }
}

/// The capability context a module's logic receives (§6 `ctx`). Ungranted =
/// `None` = absent, not present-but-refused (ADR-006): a module without the
/// grant has no field to even call. Constructed per invocation from the
/// module's effective grants; never stored.
pub struct Ctx {
    pub kv: Option<KvHandle>,
    /// Injected time, if granted (I7: even built-ins never read a real clock).
    pub clock: Option<Timestamp>,
    /// Emit a Custom event (kind, payload_json), if granted.
    pub emit: Option<Box<dyn FnMut(&str, &str)>>,
}

/// A tier-0 built-in's logic. A plain fn pointer, not a trait object: no
/// state may hide in a built-in (state lives in the log/store like everyone
/// else's — I9), and fn pointers keep the dispatch table one flat array.
pub type BuiltinHandler = fn(&Request, &mut Ctx) -> Response;

/// The tier-0 dispatch table (ADR-004: "populated in exactly one file in
/// core"). This function IS that file's contract: module id in, handler out;
/// an unregistered built-in does not exist.
pub fn builtin_entry(id: &ModuleId) -> Option<BuiltinHandler> {
    let _ = id;
    todo!("G4")
}

/// Route one request: registry lookup, effective-grant `Ctx` construction,
/// tier match (T0 → `builtin_entry`, T1 → `script::call_handle`), 404 as an
/// HTML fragment otherwise. Emits `RequestHandled` (I8). Called only by
/// `core::handle`.
pub fn dispatch(app: &mut App, req: &Request) -> Response {
    let _ = (app, req);
    todo!("G4")
}
