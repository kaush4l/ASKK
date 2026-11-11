//! # World: the engines that are running
//!
//! Booting differs per build (a folder and a pid file on a server, IndexedDB and a browser
//! lock in a tab), but what comes out is the same: a list of engines, or the reason there are
//! none. That result lives here, so whoever answers a window's question reads it from the
//! core and never asks which host it is on.
//!
//! A host names its way of booting once ([`boots_with`]); the boot itself runs at the first
//! [`world`] and never again.
use super::Engine;
use std::sync::{Arc, OnceLock};

#[derive(Default)]
pub struct World {
    pub engines: Vec<Arc<Engine>>,
    /// What boot found, in words (`3 engines, 21 elements`).
    pub report: String,
    /// Why some or all engines did not start; empty when all did.
    pub error: String,
}

type Boot = Box<dyn Fn() -> World + Send + Sync>;

static BOOT: OnceLock<Boot> = OnceLock::new();
static WORLD: OnceLock<World> = OnceLock::new();

/// Name how this build boots. The first call wins.
pub fn boots_with(boot: impl Fn() -> World + Send + Sync + 'static) {
    let _ = BOOT.set(Box::new(boot));
}

/// The running engines; booted at first use. A build that named no boot has none, and says so.
pub fn world() -> &'static World {
    WORLD.get_or_init(|| match BOOT.get() {
        Some(boot) => boot(),
        None => World { error: "this build boots no engines (no host named a boot: core/world.rs)".into(), ..Default::default() },
    })
}

/// The world if it has booted; never starts the boot (for code that runs during it).
pub fn started() -> Option<&'static World> {
    WORLD.get()
}

/// The engine at `path` (`askk`, `askk/market`).
pub fn find(path: &str) -> Option<Arc<Engine>> {
    let root = path.split('/').next().unwrap_or_default();
    world().engines.iter().find(|e| e.path == root).and_then(|e| e.find(path))
}
