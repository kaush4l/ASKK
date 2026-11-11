//! # Changes: objects mark themselves changed; readers pick changes up at their own rate (P8)
//!
//! Every domain object has a **key** — the same slash path it is stored at (`theme.json`,
//! `routes/models/page.json`, `engines/askk/market`). When an object changes it calls
//! [`mark`]; nothing is pushed and nothing is fetched. A reader (the UI) holds the last
//! sequence number it saw and asks [`since`] for the keys changed after it. A build that wants
//! to sleep until the next mark registers with [`listen`] (the server does, so an idle app
//! costs nothing).
//!
//! Marks come from two places, both outside any view:
//! - the store: every `put` / `rename` / `remove` marks its key ([`Marked`](super::store::Marked)),
//! - running objects that change without writing (an engine's live activity): they mark their
//!   own key (`Engine::bump`).
//!
//! A reader matches keys by prefix ([`matches`]): `engines/askk` sees `engines/askk/market` too.
use crate::core::held::Held;
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

#[derive(Default)]
struct Log {
    seq: u64,
    /// Last sequence at which each key changed.
    keys: BTreeMap<String, u64>,
}

fn log() -> &'static Mutex<Log> {
    static LOG: OnceLock<Mutex<Log>> = OnceLock::new();
    LOG.get_or_init(Default::default)
}

/// Called at every [`mark`]: how a build wakes whoever waits for changes (see [`listen`]).
type Heard = Box<dyn Fn() + Send + Sync>;

fn ears() -> &'static Mutex<Vec<Heard>> {
    static EARS: OnceLock<Mutex<Vec<Heard>>> = OnceLock::new();
    EARS.get_or_init(Default::default)
}

/// Call `heard` each time something is marked. It must return at once and mark nothing.
/// The core only keeps the list; waiting is the build's own business (the server:
/// `host/changes.rs`).
pub fn listen(heard: impl Fn() + Send + Sync + 'static) {
    ears().held().push(Box::new(heard));
}

/// This process's id for change sequences: a reader that saw another process's numbers starts
/// over (sequences restart at 0 with the process).
pub fn epoch() -> u64 {
    static E: OnceLock<u64> = OnceLock::new();
    *E.get_or_init(|| web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1))
}

/// Record that the object at `key` changed.
pub fn mark(key: &str) {
    {
        let mut l = log().held();
        l.seq += 1;
        let s = l.seq;
        l.keys.insert(key.trim_matches('/').to_string(), s);
    }
    for heard in ears().held().iter() {
        heard();
    }
}

/// The current sequence number.
pub fn now() -> u64 {
    log().held().seq
}

/// `(now, keys changed after seen)`, each with the sequence of its last change.
pub fn since(seen: u64) -> (u64, Vec<(String, u64)>) {
    let l = log().held();
    (l.seq, l.keys.iter().filter(|(_, s)| **s > seen).map(|(k, s)| (k.clone(), *s)).collect())
}

/// `key` is `prefix` or below it; the empty prefix matches everything.
pub fn matches(prefix: &str, key: &str) -> bool {
    let p = prefix.trim_matches('/');
    p.is_empty() || key == p || key.strip_prefix(p).is_some_and(|r| r.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mark_is_seen_once_by_prefix_and_never_again() {
        let seen = now();
        mark("test-changes/a/b.json");
        mark("test-changes/c");
        let (n, keys) = since(seen);
        assert!(n >= seen + 2);
        let ks: Vec<&str> = keys.iter().map(|(k, _)| k.as_str()).filter(|k| k.starts_with("test-changes")).collect();
        assert_eq!(ks, ["test-changes/a/b.json", "test-changes/c"]);
        assert!(since(n).1.iter().all(|(k, _)| !k.starts_with("test-changes")), "nothing new after n");
        assert!(matches("test-changes/a", "test-changes/a/b.json") && matches("", "x"));
        assert!(!matches("engines/askk", "engines/askkx"), "prefix is by segment");
    }

    #[test]
    fn a_listener_hears_every_mark() {
        static HEARD: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        listen(|| {
            HEARD.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        let before = HEARD.load(std::sync::atomic::Ordering::SeqCst);
        mark("test-listen/x");
        assert!(HEARD.load(std::sync::atomic::Ordering::SeqCst) > before);
    }
}
