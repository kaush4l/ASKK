//! # Service, on this machine: start it in the background, find it, stop it
//!
//! What a service is, is said in `core/service.rs`. Here is how it is done on a computer:
//!
//! | step | how |
//! | --- | --- |
//! | start in the background | this same program is started again as a process of its own, with nothing to read and its words going to `service.log`; `askk start` returns when that process answers |
//! | be found | the running service writes `service.json` (address, process number, build, since when) in the service place (`core/places.rs`) |
//! | be told from a leftover | a record whose process is gone is cleaned away ([`check`]) |
//! | stop | it is asked over its own door (`stop_service`), finishes the write in hand, and ends; only one that does not answer is ended from outside |
//!
//! A service started by hand in a terminal (`./scripts/run.sh`) writes the same record, so it
//! is found and stopped the same way. `askk terminal` on its own home writes none: it does
//! not listen.
use crate::core::places;
use crate::core::service::{found, hello, Found, Hello, Record, Status, Verb};
use crate::core::store::{Store, LOCK};
use crate::host::store::{alive, Folder};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const RECORD: &str = "service.json";
const LOG: &str = "service.log";

/// The service place, as a small store of its own (it is not part of the data).
fn place() -> std::sync::Arc<dyn Store> {
    Folder::new(places::service())
}

/// The record a running service left, if there is one that can be read.
pub fn record() -> Option<Record> {
    place().get(RECORD).and_then(|t| serde_json::from_str(&t).ok())
}

fn write(r: &Record) -> Result<(), String> {
    place().put(RECORD, &serde_json::to_string_pretty(r).map_err(|e| e.to_string())?)
}

fn forget() {
    if place().has(RECORD) {
        let _ = place().remove(RECORD);
    }
}

/// The address of the service running for this home, if one is (`askk terminal` asks it
/// instead of being a second host). A record whose process is gone is cleaned away.
pub fn running(args: &[String]) -> Option<String> {
    places::take_args(args);
    let r = record()?;
    if alive(r.pid) {
        return Some(r.address);
    }
    forget();
    None
}

/// Where the service listens: the environment (`IP`, `PORT`) when it says, else the settings.
pub fn listen() -> (String, u16) {
    let (ip, port) = places::listen();
    let set = crate::core::settings::settings().listen.parse::<std::net::SocketAddr>().ok();
    (ip.or(set.map(|s| s.ip().to_string())).unwrap_or_else(|| "127.0.0.1".into()), port.or(set.map(|s| s.port())).unwrap_or(8090))
}

/// The address a client on this machine uses for a service listening at `ip:port`.
fn address(ip: &str, port: u16) -> String {
    format!("http://{}:{port}", if ip == "0.0.0.0" { "127.0.0.1" } else { ip })
}

/// This process is going to listen (it is a service, not a terminal on its own home).
static SERVES: AtomicBool = AtomicBool::new(false);

/// Say that this process serves, and settle where: from here on the web library and the
/// record agree on the address.
pub fn serves() {
    let (ip, port) = listen();
    places::listen_at(&ip, port);
    SERVES.store(true, Ordering::SeqCst);
    let (ip, port) = listen();
    eprintln!("askk: listening at {}", address(&ip, port));
}

/// The world has booted. The process that holds the home starts looking for hand edits; if
/// it also listens, it writes its record and says how it is stopped.
pub fn booted() {
    let me = std::process::id();
    if crate::core::store::data().get(LOCK).and_then(|p| p.trim().parse::<u32>().ok()) != Some(me) {
        return;
    }
    crate::host::watch::start();
    if !SERVES.load(Ordering::SeqCst) {
        return;
    }
    let (ip, port) = listen();
    // Started by `askk start`: the record is there already and names the log.
    let log = record().filter(|r| r.pid == me).map(|r| r.log).unwrap_or_default();
    if let Err(e) = write(&Record::of(&hello(), &address(&ip, port), &places::data().to_string_lossy(), &log)) {
        eprintln!("askk: the service's record could not be written ({e}): `askk status` and `askk terminal` will not find it");
    }
    crate::core::service::stops_with(move || {
        if record().is_some_and(|r| r.pid == me) {
            forget();
        }
        std::thread::spawn(|| {
            // Long enough for the answer to this very question to leave.
            std::thread::sleep(Duration::from_millis(300));
            // Its terminals end with it (docs/concept.md, section 6).
            #[cfg(feature = "terminals")]
            crate::host::terminals::end_all();
            let _ = crate::core::store::data().remove(LOCK);
            crate::host::watch::settle();
            std::process::exit(0);
        });
        Ok("askk is finishing: every engine is kept as its last step left it".into())
    });
}

/// Ask a service the question `name` (no arguments) over its plain door.
async fn ask<T: serde::de::DeserializeOwned>(address: &str, name: &str, wait: Duration) -> Result<T, String> {
    let client = reqwest::Client::builder().timeout(wait).build().map_err(|e| e.to_string())?;
    let res = client.post(format!("{address}/ask/{name}")).json(&serde_json::json!({})).send().await.map_err(|e| format!("nothing answered at {address} ({e})"))?;
    let v: serde_json::Value = res.json().await.map_err(|e| format!("the reply from {address} could not be read: {e}"))?;
    match v.get("error").and_then(|e| e.as_str()) {
        Some(e) => Err(e.to_string()),
        None => serde_json::from_value(v["ok"].clone()).map_err(|e| format!("the answer to '{name}' is not what this program expects: {e}")),
    }
}

/// The record, held against the machine. A leftover is cleaned away.
async fn check() -> Found {
    let r = record();
    let answered = match &r {
        Some(r) if alive(r.pid) => ask::<Hello>(&r.address, "hello", Duration::from_secs(3)).await.ok(),
        _ => None,
    };
    // A process number is given out again after a while: one that is running, silent and not
    // this program is some other program, and the record is a leftover.
    let f = found(r, |pid| alive(pid) && (answered.is_some() || ours(pid)), answered.as_ref());
    if matches!(f, Found::Stale(_)) {
        forget();
    }
    f
}

/// Whether the process `pid` is this program (by its file's name), so that only askk is ever
/// ended from outside.
fn ours(pid: u32) -> bool {
    let name = |p: &str| p.trim().rsplit('/').next().unwrap_or_default().chars().take(15).collect::<String>();
    let me = std::env::current_exe().map(|p| name(&p.to_string_lossy())).unwrap_or_default();
    let out = std::process::Command::new("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output();
    out.is_ok_and(|o| !me.is_empty() && name(&String::from_utf8_lossy(&o.stdout)) == me)
}

async fn gone_within(pid: u32, wait: Duration) -> bool {
    let until = tokio::time::Instant::now() + wait;
    while alive(pid) {
        if tokio::time::Instant::now() >= until {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    true
}

/// The running service `r` as a status: what it says of itself, its engines, what it can do.
async fn told(r: Record, said: String) -> Status {
    let wait = Duration::from_secs(60);
    let engines = ask(&r.address, "engine_paths", wait).await.unwrap_or_default();
    let caps = ask(&r.address, "capabilities", wait).await.unwrap_or_default();
    Status { running: true, said, record: Some(r), engines, caps }
}

fn silent(r: &Record) -> String {
    let log = if r.log.is_empty() { String::new() } else { format!(" Its log: {}", r.log) };
    format!("askk (process {}) holds this home but does not answer at {}: it hangs, or was just started. `askk stop` ends it.{log}", r.pid, r.address)
}

async fn status() -> Status {
    match check().await {
        Found::Running(r) => {
            let said = format!("askk is running at {}", r.address);
            told(r, said).await
        }
        Found::Silent(r) => Status { said: silent(&r), record: Some(r), ..Default::default() },
        Found::Stale(r) => Status { said: format!("askk is not running (process {} ended without saying so; what it left is cleaned away)", r.pid), ..Default::default() },
        Found::Nothing => Status { said: "askk is not running".into(), ..Default::default() },
    }
}

/// Wait until the service at `r` answers as the process it names, then say it runs.
async fn answers(r: Record, mut child: Option<std::process::Child>, said: &str) -> Result<Status, String> {
    for _ in 0..300 {
        if let Ok(h) = ask::<Hello>(&r.address, "hello", Duration::from_secs(3)).await {
            if h.pid == r.pid {
                let r = Record::of(&h, &r.address, &r.data, &r.log);
                write(&r)?;
                let said = format!("{said} at {}", r.address);
                return Ok(told(r, said).await);
            }
        }
        let ended = match child.as_mut() {
            Some(c) => c.try_wait().ok().flatten().map(|code| code.to_string()),
            None => (!alive(r.pid)).then(|| "it is gone".to_string()),
        };
        if let Some(how) = ended {
            forget();
            // The end of its log, without the web library's list of every route it serves.
            let log = crate::host::store::tail(std::path::Path::new(&r.log), 400);
            let said: Vec<&str> = log.lines().filter(|l| !l.contains("Registering: ")).collect();
            return Err(format!("the service ended as soon as it was started ({how}). What it said:\n{}", said[said.len().saturating_sub(12)..].join("\n")));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("the service (process {}) did not answer at {} within a minute. It was left running; its log: {}", r.pid, r.address, r.log))
}

async fn start() -> Result<Status, String> {
    match check().await {
        Found::Running(r) => {
            let said = format!("askk is already running at {} (process {})", r.address, r.pid);
            return Ok(told(r, said).await);
        }
        // Started a moment ago by someone else: wait for it rather than start a second one.
        Found::Silent(r) => return answers(r.clone(), None, "askk is already running").await.map_err(|_| silent(&r)),
        Found::Stale(_) | Found::Nothing => {}
    }
    if let Some(pid) = crate::core::store::data().get(LOCK).and_then(|p| p.trim().parse::<u32>().ok()).filter(|p| alive(*p)) {
        return Err(format!("another askk (process {pid}) is using this home without listening: an `askk terminal`, perhaps. End it first, or use --desk <another folder>"));
    }
    let (ip, port) = listen();
    if let Err(e) = std::net::TcpListener::bind((ip.as_str(), port)) {
        return Err(format!("{ip}:{port} cannot be listened at ({e}). Another program may be using it: name another address in settings.json (`listen`) or in PORT"));
    }
    let log = places::service().join(LOG);
    let out = crate::host::store::appended(&log)?;
    let err = out.try_clone().map_err(|e| format!("{}: {e}", log.display()))?;
    let exe = std::env::current_exe().map_err(|e| format!("this program could not find its own file to start it again: {e}"))?;
    let mut cmd = std::process::Command::new(exe);
    cmd.env("PORT", port.to_string()).env("IP", &ip).stdin(std::process::Stdio::null()).stdout(out).stderr(err);
    // A group of its own: closing the terminal, or Ctrl-C in it, does not reach the service.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let child = cmd.spawn().map_err(|e| format!("the service could not be started: {e}"))?;
    let r = Record { address: address(&ip, port), pid: child.id(), version: hello().version, build: hello().build, started: 0, data: places::data().to_string_lossy().into_owned(), log: log.to_string_lossy().into_owned() };
    write(&r)?;
    answers(r, Some(child), "askk is running").await
}

async fn stop() -> Result<Status, String> {
    let (r, answers) = match check().await {
        Found::Nothing | Found::Stale(_) => return Ok(Status { said: "askk is not running, so there is nothing to stop".into(), ..Default::default() }),
        Found::Running(r) => (r, true),
        Found::Silent(r) => (r, false),
    };
    let asked = answers && ask::<String>(&r.address, "stop_service", Duration::from_secs(5)).await.is_ok();
    let mut said = "askk has stopped".to_string();
    if !(asked && gone_within(r.pid, Duration::from_secs(10)).await) {
        // It did not finish when asked. It is known to be askk (it answered as that process,
        // or it is this program: `check`), so it may be ended from outside.
        for signal in ["-TERM", "-KILL"] {
            let _ = std::process::Command::new("kill").args([signal, &r.pid.to_string()]).status();
            if gone_within(r.pid, Duration::from_secs(5)).await {
                break;
            }
        }
        if alive(r.pid) {
            return Err(format!("askk (process {}) could not be ended", r.pid));
        }
        said = format!("askk did not finish when asked, so its process ({}) was ended", r.pid);
    }
    forget();
    Ok(Status { said, ..Default::default() })
}

/// Do what was asked on the command line (`askk start`, `stop`, `status`, `restart`).
pub fn act(verb: Verb, args: &[String]) -> Result<Status, String> {
    if !cfg!(unix) {
        return Err("askk start, stop, status and restart are not there yet on Windows: run the program itself and leave its window open".into());
    }
    places::take_args(args);
    crate::host::store::start();
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| format!("this program could not start its own clock and network: {e}"))?;
    rt.block_on(async {
        match verb {
            Verb::Start => start().await,
            Verb::Stop => stop().await,
            Verb::Status => Ok(status().await),
            Verb::Restart => {
                stop().await?;
                start().await
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_client_is_given_an_address_it_can_reach() {
        assert_eq!(address("127.0.0.1", 8090), "http://127.0.0.1:8090");
        assert_eq!(address("0.0.0.0", 9), "http://127.0.0.1:9", "listening everywhere is reached here");
        assert!(ours(std::process::id()), "this process is this program");
        assert!(!ours(1), "the machine's first process is not askk");
    }
}
