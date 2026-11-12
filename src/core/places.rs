//! # Places: every root the app reads, named once
//!
//! The app's memory is not scattered: each kind of thing has one place and one door.
//!
//! | place | env | default | door |
//! | --- | --- | --- | --- |
//! | home | `ASKK_HOME` | none | the app's own environment: everything it writes lives inside |
//! | data | `ASKK_DATA` | `<home>/data`, else `data` | [`super::store::data`]; every key inside is named by the manifest (`askk.json`) |
//! | workspace | `ASKK_WORKSPACE` | `<home>/projects`, else current folder | `host/workspace.rs` and the `workspace` element; projects are made here |
//! | personal | `ASKK_PERSONAL` | `<home>/personal`, else `personal` | the user's own data files (csv, json, text): engines read them, never write (`host/data.rs`) |
//! | media | `ASKK_MEDIA` | `<home>/media`, else `media` | what the user attached (images, sound, video) and what was sensed in it (`host/media.rs`) |
//! | defaults | `ASKK_DEFAULTS` | `defaults` | copied into data at boot for anything missing |
//! | host | `ASKK_HOST` | `http://127.0.0.1:8090` | where a shell (Mac app) finds the running host |
//! | service | none | `<home>/service`, else `<data>/.service` | the running service's own record and log ([`service`]); never part of the state |
//! | listen | `IP`, `PORT` | what `settings.json` says | where the service listens ([`listen`]); the environment wins over the file |
//!
//! With `ASKK_HOME` set (`scripts/sandboxed.sh` does it), the sandbox profile lets the process
//! write there and nowhere else, so the home is the whole of the app's memory and work: move the folder
//! and the app moves with it.
//!
//! Secrets are never stored: a model names an env var and [`secret`] reads it.
//! No other file reads the environment (`structure.rs` checks it).
#![cfg_attr(not(feature = "server"), allow(dead_code))]
use std::path::PathBuf;

const HOME: &str = "ASKK_HOME";
const DATA: &str = "ASKK_DATA";
const DEFAULTS: &str = "ASKK_DEFAULTS";
const WORKSPACE: &str = "ASKK_WORKSPACE";
const PERSONAL: &str = "ASKK_PERSONAL";
const MEDIA: &str = "ASKK_MEDIA";
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
const HOST: &str = "ASKK_HOST";
const ORIGINS: &str = "ASKK_ORIGINS";

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn here() -> PathBuf {
    std::env::current_dir().unwrap_or_default()
}

/// The app's own environment, when it has one.
pub fn home() -> Option<PathBuf> {
    var(HOME).map(PathBuf::from)
}

/// A place: its own variable, else its folder in the home, else `fallback`.
fn place(own: &str, in_home: &str, fallback: impl FnOnce() -> PathBuf) -> PathBuf {
    var(own).map(PathBuf::from).or_else(|| home().map(|h| h.join(in_home))).unwrap_or_else(fallback)
}

/// The web pages, by origin (`https://kaush4l.github.io`), that may ask this server from a
/// browser: `ASKK_ORIGINS`, separated by commas. None by default: a page on another site can
/// then not ask at all. Name only pages you trust; one named here can do what you can.
pub fn origins() -> Vec<String> {
    var(ORIGINS).map(|v| v.split(',').map(|o| o.trim().trim_end_matches('/').to_string()).filter(|o| !o.is_empty()).collect()).unwrap_or_default()
}

/// The data folder (or a `.json` bundle path).
pub fn data() -> PathBuf {
    place(DATA, "data", || "data".into())
}

/// Where the running service keeps its own record (address, process number, since when) and
/// its log. It goes with the data, one service per data place: the folder `service` in the
/// home when the home holds the data; else the hidden folder `.service` inside the data
/// folder (beside it, when the data is one file). It is not state: a name that begins with
/// a dot is no key of the store, so a backup leaves it out, and it is made again at start.
pub fn service() -> PathBuf {
    let data = data();
    match home() {
        Some(home) if data == home.join("data") => home.join("service"),
        _ if data.extension().is_some_and(|x| x == "json") => {
            let name = data.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            data.with_file_name(format!("{name}.service"))
        }
        _ => data.join(".service"),
    }
}

/// Where the environment says the service listens: `IP` and `PORT`, each only when set.
/// (The web library reads the same two names when it opens the door.)
pub fn listen() -> (Option<String>, Option<u16>) {
    (var("IP"), var("PORT").and_then(|p| p.parse().ok()))
}

/// Settle where this process listens, for a name the environment left unsaid: the web
/// library reads the same two names when it opens the door, so both then agree.
pub fn listen_at(ip: &str, port: u16) {
    if var("IP").is_none() {
        std::env::set_var("IP", ip);
    }
    if var("PORT").is_none() {
        std::env::set_var("PORT", port.to_string());
    }
}

/// The build id: one short name for exactly the source this program was made from
/// (`build.rs` works it out). The service and the page it serves carry the same one.
pub const BUILD: &str = env!("ASKK_BUILD");

/// The defaults store location.
pub fn defaults() -> String {
    var(DEFAULTS).unwrap_or_else(|| "defaults".into())
}

/// The folder engines work in (files, commands).
pub fn workspace() -> PathBuf {
    place(WORKSPACE, "projects", here)
}

/// The user's own data files: read by engines, written only by the user.
pub fn personal() -> PathBuf {
    place(PERSONAL, "personal", || "personal".into())
}

/// What the user attached, and what was sensed in it.
pub fn media() -> PathBuf {
    place(MEDIA, "media", || "media".into())
}

/// Where a shell finds the running host. A phone app is not started with the user's
/// environment, so the address given when the app was built (`ASKK_HOST=… dx build --ios`) is
/// used when the running environment names none.
#[cfg_attr(not(any(feature = "desktop", feature = "mobile")), allow(dead_code))]
pub fn host_url() -> String {
    var(HOST).or_else(|| option_env!("ASKK_HOST").filter(|v| !v.is_empty()).map(String::from)).unwrap_or_else(|| "http://127.0.0.1:8090".into())
}

/// The user's own home folder (`HOME`), where other agents' programs keep their state.
pub fn user_home() -> Option<PathBuf> {
    var("HOME").map(PathBuf::from)
}

/// The folders programs are looked for in (`PATH`), in order.
pub fn path() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

/// The person's own shell: what a terminal runs when no command is named. `SHELL` where
/// there is one (Mac, Linux), else the system's command line (`COMSPEC` on Windows).
#[cfg_attr(not(feature = "terminals"), allow(dead_code))]
pub fn shell() -> String {
    var("SHELL").or_else(|| var("COMSPEC")).unwrap_or_else(|| if cfg!(windows) { "cmd.exe".into() } else { "/bin/sh".into() })
}

/// Whether the person, or their terminal, asked for lines without colour: `NO_COLOR` set
/// (the convention of no-color.org), or a terminal that says it cannot (`TERM=dumb`).
pub fn plain_lines() -> bool {
    var("NO_COLOR").is_some() || var("TERM").as_deref() == Some("dumb")
}

/// Whether the terminal says it cannot be drawn on as a full screen (`TERM=dumb`): then the
/// terminal UI writes lines.
pub fn dumb_terminal() -> bool {
    var("TERM").as_deref() == Some("dumb")
}

/// A secret by the name of the env var that holds it.
pub fn secret(name: &str) -> Option<String> {
    (!name.is_empty()).then(|| var(name)).flatten()
}

/// Command-line overrides: `--desk <dir>` uses another data folder.
pub fn take_args(args: &[String]) {
    if let Some(d) = args.iter().position(|a| a == "--desk").and_then(|i| args.get(i + 1)) {
        std::env::set_var(DATA, d);
    }
}
