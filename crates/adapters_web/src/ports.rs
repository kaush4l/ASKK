//! Browser port implementations. Hand-rolled web-sys, no wrapper crates
//! (spike-idb: `indexed_db_futures` costs a 52-crate tree and a pin
//! conflict for ~70 lines of once-written plumbing).

use kernel::{
    BlobStore, BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, KvStore,
    ModelError, ModelPort, ModelReply, NetError, NetPort, RngPort, StoreError, StorePort,
    Timestamp,
};

/// `StorePort` over one IndexedDB database, two object stores (`kv`, `blob`
/// — ADR-005: prefixes migrate in data, not in DDL). One struct implements
/// all three traits: the substrate split is an adapter detail the core
/// never sees.
pub struct IdbStore {
    db: web_sys::IdbDatabase,
}

impl IdbStore {
    /// Open (creating/upgrading the two object stores), request persistence
    /// (`navigator.storage.persist()` at first durable write — ADR-005) and
    /// surface the grant result to the caller for the dashboard panel.
    pub async fn open(name: &str) -> Result<IdbStore, StoreError> {
        let _ = name;
        todo!("G4")
    }
}

impl KvStore for IdbStore {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>> {
        let _ = key;
        todo!("G4")
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = (key, value);
        todo!("G4")
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = key;
        todo!("G4")
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        let _ = prefix;
        todo!("G4")
    }
}

impl BlobStore for IdbStore {
    fn read<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, StoreError>> {
        let _ = path;
        todo!("G4")
    }
    fn write<'a>(
        &'a self,
        path: &'a str,
        bytes: &'a [u8],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = (path, bytes);
        todo!("G4")
    }
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = path;
        todo!("G4")
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        let _ = prefix;
        todo!("G4")
    }
}

impl StorePort for IdbStore {
    fn kv(&self) -> &dyn KvStore {
        todo!("G4")
    }
    fn blob(&self) -> &dyn BlobStore {
        todo!("G4")
    }
}

/// `ModelPort` over fetch. Owns the provider profiles: resolves the symbolic
/// endpoint name to a configured base URL and attaches the credential HERE —
/// the last stop before the network, so a key exists nowhere upstream
/// (ADR-006, §4.1).
pub struct FetchModel {
    profiles_key_prefix: String,
}

impl FetchModel {
    /// Build against the `config/keys/*` profile records (ADR-005 schema).
    pub fn new(profiles_key_prefix: &str) -> FetchModel {
        let _ = profiles_key_prefix;
        todo!("G4")
    }
}

impl ModelPort for FetchModel {
    fn call<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        let _ = (endpoint, body_json);
        todo!("G4")
    }
}

/// `NetPort` over fetch with the user-configured allowlist (I2: outbound
/// traffic only to configured endpoints — enforced here, where the fetch
/// actually happens, not advised in a prompt).
pub struct FetchNet {
    allowlist: Vec<EndpointName>,
}

impl FetchNet {
    /// Allowlist comes from settings — a user action, never a module grant
    /// (ADR-006).
    pub fn new(allowlist: Vec<EndpointName>) -> FetchNet {
        let _ = allowlist;
        todo!("G4")
    }
}

impl NetPort for FetchNet {
    fn fetch<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>> {
        let _ = (endpoint, req);
        todo!("G4")
    }
}

/// `ClockPort` over `Date.now()` — the ONE place wall-clock time enters the
/// system; everything downstream receives it as data (I7).
#[derive(Debug, Default)]
pub struct BrowserClock;

impl ClockPort for BrowserClock {
    fn now(&self) -> Timestamp {
        todo!("G4")
    }
}

/// `RngPort` over `crypto.getRandomValues` — same one-door rationale.
#[derive(Debug, Default)]
pub struct BrowserRng;

impl RngPort for BrowserRng {
    fn fill(&self, buf: &mut [u8]) {
        let _ = buf;
        todo!("G4")
    }
}
