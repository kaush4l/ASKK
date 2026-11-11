//! # Changes, on the server: sleep until something is marked
//!
//! The core keeps the log of what changed ([`crate::core::changes`]). A window asks "what
//! changed after N?" and the server holds the question until there is an answer, so an idle
//! app does no work. Holding a question needs a runtime, which is why this lives here.
use crate::core::changes::{listen, since};
use std::sync::OnceLock;
use tokio::sync::Notify;

/// The one bell every waiter listens to; the core rings it at each mark.
fn bell() -> &'static Notify {
    static BELL: OnceLock<Notify> = OnceLock::new();
    BELL.get_or_init(|| {
        listen(|| bell().notify_waiters());
        Notify::new()
    })
}

/// Wait until something changes after `seen` (or `max` passes), then [`since`].
pub async fn wait(seen: u64, max: std::time::Duration) -> (u64, Vec<(String, u64)>) {
    let deadline = tokio::time::Instant::now() + max;
    loop {
        // Register before checking, so a mark between the check and the await is not lost.
        let n = bell().notified();
        let (now, keys) = since(seen);
        if now != seen || tokio::time::Instant::now() >= deadline {
            return (now, keys);
        }
        let _ = tokio::time::timeout_at(deadline, n).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::changes::{mark, now};

    #[tokio::test]
    async fn wait_returns_on_a_mark_not_on_a_timer() {
        // Other tests mark too: wait until our key shows up, as a reader would.
        let mut seen = now();
        let t = tokio::spawn(async move {
            loop {
                let (n, keys) = wait(seen, std::time::Duration::from_secs(10)).await;
                if keys.iter().any(|(k, _)| k == "test-wait/x") {
                    return n;
                }
                seen = n;
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let started = std::time::Instant::now();
        mark("test-wait/x");
        tokio::time::timeout(std::time::Duration::from_secs(2), t).await.expect("woken by the mark, not the 10 s timer").unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }
}
