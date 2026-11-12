//! # World: the running engines (server only)
//!
//! Boot happens once, at process start ([`boot_now`]): take the data store's lock, **seed** it
//! from the defaults store (anything missing), **load** one [`boot::Snapshot`] (the manifest
//! `askk.json` and everything it names), **init** every engine from that snapshot only, with the
//! shared tools ([`crate::host::tools`]) and the models runtime, start one poller per alert, open the
//! board at the manifest's key. Nothing here is built from values written in code: what exists
//! and where it lives is the snapshot's.
//! The result is kept by the core ([`crate::core::world`]), where the rest of the app reads it.
use crate::core::held::Held;
use crate::core::world::World;
use crate::core::{boot, store, Engine};
use std::sync::Arc;

/// The defaults store: `ASKK_DEFAULTS` (default the folder `defaults`; a `.json` path is a
/// one-file bundle). With no such place on this machine, the defaults the program was built
/// with, so the program alone can make a first home.
pub fn defaults() -> Arc<dyn store::Store> {
    let at = crate::core::places::defaults();
    if !std::path::Path::new(&at).exists() {
        eprintln!("askk: no defaults at `{at}`; using the ones this program was built with");
        return Arc::new(store::packed());
    }
    crate::host::store::open(&at).unwrap_or_else(|e| {
        eprintln!("askk: defaults: {e}; using the ones this program was built with");
        Arc::new(store::packed())
    })
}

/// Boot at process start on its own runtime, so engines and alert pollers run before any
/// page is opened.
pub fn boot_now() {
    std::thread::spawn(|| {
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
        rt.block_on(async {
            let w = crate::core::world::world();
            eprintln!("askk: booted {} top-level engine(s) ({}){}", w.engines.len(), w.report, if w.error.is_empty() { String::new() } else { format!("; errors: {}", w.error) });
            // Messages that arrived before a restart are still new: handle them now.
            fn wake_pending(e: &Arc<Engine>) {
                if !crate::core::board::board().new_for(&e.path).is_empty() {
                    e.wake();
                }
                e.subs().iter().for_each(wake_pending);
            }
            w.engines.iter().for_each(wake_pending);
            std::future::pending::<()>().await
        });
    });
}

/// How the server boots (named to the core in `host/mod.rs`).
pub fn start() -> World {
    let data = store::data();
    let infer: Arc<dyn crate::core::Infer> = Arc::new(crate::host::infer::ModelsInfer);
    // One writer per data folder: a second process boots no engines.
    if let Err(e) = store::lock(&*data, std::process::id(), &crate::host::store::alive) {
        eprintln!("askk: {e}");
        return World { error: e, ..Default::default() };
    }
    if let Err(e) = boot::seed(&*defaults(), &*data) {
        eprintln!("seed: {e}");
    }
    // The user's bindings fill the holes in recipes; a broken file binds nothing and says why.
    match crate::host::data::bindings() {
        Ok(b) => crate::core::param::set_bindings(b),
        Err(e) => eprintln!("askk: {e}"),
    }
    let snap = match boot::load(&*data) {
        Ok(s) => s,
        Err(e) => return World { error: e, ..Default::default() },
    };
    let report = snap.report();
    eprintln!("askk: loaded {report}");
    crate::core::manifest::set(snap.manifest.clone());
    let m = snap.manifest;
    crate::host::workspace::recover_jobs(data.clone());
    crate::host::harness::recover();
    crate::host::room::recover();
    let shared = crate::host::tools::shared();
    let mut engines = vec![];
    let mut errors = vec![];
    for t in snap.engines {
        match boot::init(t, data.clone(), &shared, infer.clone()) {
            Ok(e) => engines.push(e),
            Err(e) => errors.push(e),
        }
    }
    for e in &engines {
        watch_all(e.clone());
    }
    // A post wakes the engine it is for; it runs on its own task, so the poster never waits.
    crate::core::board::init(data, &m.board);
    crate::core::board::board().set_wake(Arc::new(|to: &str| {
        let Some(w) = crate::core::world::started() else { return false };
        let root = to.split('/').next().unwrap_or_default();
        match w.engines.iter().find(|e| e.path == root).and_then(|e| e.find(to)) {
            Some(e) => {
                e.wake();
                true
            }
            None => false,
        }
    }));
    crate::core::board::board().set_directory(Arc::new(|| {
        fn walk(e: &Engine, out: &mut Vec<(String, String)>) {
            // Only engines with an element that reads the box can be posted to.
            if e.receives {
                let d = e.file.held().description.clone();
                out.push((e.path.clone(), d));
            }
            for s in e.subs() {
                walk(&s, out);
            }
        }
        let mut out = vec![];
        if let Some(w) = crate::core::world::started() {
            for e in &w.engines {
                walk(e, &mut out);
            }
        }
        out
    }));
    World { engines, report, error: errors.join("\n") }
}

/// One poller per alert, for this engine and its sub-engines.
pub fn watch_all(e: Arc<Engine>) {
    for w in e.watches() {
        let e = e.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_millis(w.every_ms));
            loop {
                tick.tick().await;
                let v = match e.toolbox().call(&w.source.tool, w.source.args.clone()).await {
                    Ok(v) => v.as_f64(),
                    Err(err) => {
                        eprintln!("askk: alert {}/{}: {err}", e.path, w.name);
                        continue;
                    }
                };
                let Some(v) = v else { continue };
                for input in e.observe(&w.name, v) {
                    let e = e.clone();
                    tokio::spawn(async move {
                        let _ = e.run(&input).await;
                    });
                }
            }
        });
    }
    for s in &e.subs() {
        watch_all(s.clone());
    }
}

