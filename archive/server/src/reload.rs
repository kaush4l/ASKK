//! Hot reload: `data/engines/**` is watched (notify, debounced) and also re-scanned on a timer,
//! because macOS FSEvents can drop events. Both just call `Hub::reload`, which is idempotent: a
//! scan of an unchanged folder — including the files the server itself just wrote for a
//! structure action — changes nothing and broadcasts nothing, so there is no loop.

use notify::{RecursiveMode, Watcher};
use askk_core::Hub;
use std::{path::PathBuf, time::Duration};
use tokio::{sync::{mpsc, watch}, task::JoinHandle};

/// Quiet time after the last file event before reloading.
pub const DEBOUNCE: Duration = Duration::from_millis(300);
/// The fallback re-scan.
pub const RESCAN: Duration = Duration::from_secs(2);

/// Runs until `stopping` turns true.
pub fn watch(hub: Hub, dir: PathBuf, mut stopping: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel::<()>();
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok_and(|e| !matches!(e.kind, notify::EventKind::Access(_))) {
                let _ = tx.send(());
            }
        })
        .and_then(|mut w| w.watch(&dir, RecursiveMode::Recursive).map(|_| w));
        let _watcher = match watcher {
            Ok(w) => Some(w),
            Err(e) => {
                eprintln!("reload: cannot watch {} ({e}); re-scanning every {RESCAN:?} only", dir.display());
                None
            }
        };
        let mut rescan = tokio::time::interval(RESCAN);
        rescan.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = async { let _ = stopping.wait_for(|s| *s).await; } => return,
                Some(()) = rx.recv() => {
                    // debounce: wait until events stop for DEBOUNCE
                    while let Ok(Some(())) = tokio::time::timeout(DEBOUNCE, rx.recv()).await {}
                    run(&hub, "change").await;
                }
                _ = rescan.tick() => run(&hub, "rescan").await,
            }
        }
    })
}

async fn run(hub: &Hub, why: &str) {
    match hub.reload().await {
        Ok(true) => println!("reload ({why}): configuration changed"),
        Ok(false) => {}
        Err(e) => eprintln!("reload ({why}) failed, keeping the last good world: {e:#}"),
    }
}
