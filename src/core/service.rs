//! # Service: the one askk that runs, and how everything else knows it
//!
//! One program runs the engines for a home: the **service**. Windows, terminals and scripts
//! are **clients**: they come and go, the service stays. Three small things make that work,
//! and they are all said here, in the core's words (how each is done on a machine is
//! `host/service.rs`):
//!
//! | thing | what it is | who uses it |
//! | --- | --- | --- |
//! | [`Hello`] | who the service is right now: version, build, since when, process number | a client, to tell "the same service", "it restarted", "it was rebuilt" (`ui/features/service.rs`) |
//! | [`Record`] | the same, plus where it listens and where its log is, written beside the data while it runs | a client that has no address yet (`askk terminal`, `askk status`) |
//! | [`Found`] | what a record means once it is checked against the machine | `askk start`, `stop`, `status` |
//!
//! A build with no service behind it (the browser tab is its own host) still says hello: it
//! is then its own service, with process number 0.
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Who the service is right now. Two hellos with the same `started` and `pid` are the same
/// run of the service; a different `build` means the program itself was made again.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Hello {
    /// The version written in `Cargo.toml` (`0.1.0`).
    pub version: String,
    /// One short name for exactly the source it was built from (`core/places.rs`, `BUILD`).
    pub build: String,
    /// When this run of the service began: milliseconds since 1970.
    pub started: u64,
    /// Its process number on the machine; 0 where there is none (a browser tab).
    pub pid: u32,
}

static HELLO: OnceLock<Hello> = OnceLock::new();

fn now_ms() -> u64 {
    web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The host says the service has begun, and under which process number. The first call wins.
pub fn began(pid: u32) {
    let _ = HELLO.set(Hello { version: env!("CARGO_PKG_VERSION").into(), build: super::places::BUILD.into(), started: now_ms(), pid });
}

/// Who this service is. With no host having said so, it began when it was first asked.
pub fn hello() -> Hello {
    HELLO.get_or_init(|| Hello { version: env!("CARGO_PKG_VERSION").into(), build: super::places::BUILD.into(), started: now_ms(), pid: 0 }).clone()
}

/// What a running service writes beside its data, and takes away when it stops.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Record {
    /// Where it answers (`http://127.0.0.1:8090`).
    pub address: String,
    pub pid: u32,
    pub version: String,
    pub build: String,
    /// Milliseconds since 1970; 0 while it is still starting.
    pub started: u64,
    /// The data place it holds.
    pub data: String,
    /// The file it writes what it says to; empty when it runs in a terminal and says it there.
    #[serde(default)]
    pub log: String,
}

impl Record {
    pub fn of(hello: &Hello, address: &str, data: &str, log: &str) -> Record {
        Record { address: address.into(), pid: hello.pid, version: hello.version.clone(), build: hello.build.clone(), started: hello.started, data: data.into(), log: log.into() }
    }
}

/// What a record means once it is held against the machine.
#[derive(Clone, Debug, PartialEq)]
pub enum Found {
    /// No record: no service runs for this home.
    Nothing,
    /// A record whose process is gone (the machine was switched off, the program was ended
    /// the hard way). It is cleaned away and means the same as nothing.
    Stale(Record),
    /// Its process is there but nothing answers at its address as that process: it is still
    /// starting, or it hangs.
    Silent(Record),
    /// It runs and answers.
    Running(Record),
}

/// Decide what `record` means: `alive` says whether a process number is running, `hello` is
/// what answered at the record's address (nothing, or some service's hello).
pub fn found(record: Option<Record>, alive: impl Fn(u32) -> bool, hello: Option<&Hello>) -> Found {
    match record {
        None => Found::Nothing,
        Some(r) if !alive(r.pid) => Found::Stale(r),
        Some(r) if hello.is_some_and(|h| h.pid == r.pid) => Found::Running(r),
        Some(r) => Found::Silent(r),
    }
}

/// What a person can ask of the service from the command line.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verb {
    Start,
    Stop,
    Status,
    Restart,
}

/// The answer to a [`Verb`]: one sentence, and what is known about the service now.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Status {
    pub running: bool,
    /// What happened, as one sentence (`askk is already running at …`).
    pub said: String,
    pub record: Option<Record>,
    /// The engines it runs, by path.
    pub engines: Vec<String>,
    /// What it can do and what it cannot (`core/caps.rs`).
    pub caps: Vec<super::caps::Cap>,
}

type Stop = Box<dyn Fn() -> Result<String, String> + Send + Sync>;

static STOP: OnceLock<Stop> = OnceLock::new();

/// Name how this build ends itself when asked to. The first call wins.
pub fn stops_with(stop: impl Fn() -> Result<String, String> + Send + Sync + 'static) {
    let _ = STOP.set(Box::new(stop));
}

/// Ask the service to finish. It answers first and ends a moment later. A build that is not
/// a service of its own says so.
pub fn stop() -> Result<String, String> {
    match STOP.get() {
        Some(stop) => stop(),
        None => Err("this build is not a background service: there is nothing to stop but the window itself".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_is_nothing_stale_silent_or_running() {
        let r = Record { pid: 7, address: "http://127.0.0.1:1".into(), ..Default::default() };
        let hello = |pid| Hello { pid, ..Default::default() };
        assert_eq!(found(None, |_| true, None), Found::Nothing);
        assert_eq!(found(Some(r.clone()), |_| false, Some(&hello(7))), Found::Stale(r.clone()), "a record whose process is gone is stale, whoever answers");
        assert_eq!(found(Some(r.clone()), |_| true, None), Found::Silent(r.clone()));
        assert_eq!(found(Some(r.clone()), |_| true, Some(&hello(8))), Found::Silent(r.clone()), "another service at that address is not this one");
        assert_eq!(found(Some(r.clone()), |_| true, Some(&hello(7))), Found::Running(r));
    }

    #[test]
    fn hello_is_the_same_for_as_long_as_the_process_runs() {
        let (a, b) = (hello(), hello());
        assert_eq!(a, b);
        assert_eq!(a.build.len(), 16, "the build id is 16 letters and digits: {}", a.build);
        assert!(a.started > 1_600_000_000_000 && !a.version.is_empty());
    }
}
