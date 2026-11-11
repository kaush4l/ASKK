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

/// The data folder (or a `.json` bundle path).
pub fn data() -> PathBuf {
    place(DATA, "data", || "data".into())
}

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
