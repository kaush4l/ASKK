//! # Harness: the programs that run another agent's loop (server only)
//!
//! One file per kind; each implements [`Harness`] and is the only place its program is named.
//! This file is what they share: the list of kinds, finding a program, running it in a
//! session's project folder, and the one path a prompt takes ([`prompt`]): record it, run the
//! harness on its own task, record the answer. The caller never waits for the answer; the
//! session's key is marked changed when it lands.
mod claude;
mod codex;
mod muse;

use crate::core::session::{self, Harness, HarnessInfo, Reply, Session};
use std::path::PathBuf;
use std::sync::Arc;

/// The longest a harness may take over one prompt.
const LIMIT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// Every kind of harness, in the order offered.
pub fn all() -> Vec<Arc<dyn Harness>> {
    vec![Arc::new(claude::Claude), Arc::new(codex::Codex), Arc::new(muse::Muse)]
}

pub fn infos() -> Vec<HarnessInfo> {
    all().iter().map(|h| HarnessInfo { kind: h.kind().into(), about: h.about().into(), missing: h.missing().unwrap_or_default() }).collect()
}

/// Where sessions are kept in the store.
fn root() -> String {
    crate::core::manifest::manifest().sessions.clone()
}

fn store() -> Arc<dyn crate::core::store::Store> {
    crate::core::store::data()
}

pub fn list() -> Vec<Session> {
    session::list(&*store(), &root())
}

pub fn open(harness: &str, title: &str, project: &str) -> Result<Session, String> {
    let all = all();
    let kinds: Vec<&str> = all.iter().map(|h| h.kind()).collect();
    session::open(&*store(), &root(), &kinds, harness, title, project)
}

/// Sessions left busy by the last run of the host say so.
pub fn recover() {
    session::recover(&*store(), &root());
}

/// Hand `text` to the session's harness. Returns once the prompt is recorded; the answer (or
/// why there is none) is recorded when the harness ends.
pub fn prompt(id: u64, text: &str) -> Result<(), String> {
    let (h, p) = begin(id, text)?;
    tokio::spawn(async move {
        let _ = finish(h, p, id).await;
    });
    Ok(())
}

/// The same, waited for: the answer itself comes back (a room's seat, the desk agent).
pub async fn turn(id: u64, text: &str) -> Result<String, String> {
    let (h, p) = begin(id, text)?;
    finish(h, p, id).await
}

/// The names of the kinds that can run on this machine now.
pub fn usable() -> Vec<String> {
    all().iter().filter(|h| h.missing().is_none()).map(|h| h.kind().to_string()).collect()
}

/// Record the prompt in the session; its harness and what to hand it come back.
fn begin(id: u64, text: &str) -> Result<(Arc<dyn Harness>, session::Prompt), String> {
    let (st, root) = (store(), root());
    let kind = session::get(&*st, &root, id)?.harness;
    let h = all().into_iter().find(|h| h.kind() == kind).ok_or_else(|| format!("unknown harness '{kind}'"))?;
    if let Some(why) = h.missing() {
        return Err(why);
    }
    // This home's setting for the kind; a file that does not read stops the prompt and says why.
    let key = &crate::core::manifest::manifest().harnesses;
    let set = match st.get(key) {
        Some(t) => session::settings(&t).map_err(|e| format!("{key}: {e}"))?,
        None => Default::default(),
    };
    let mut p = session::ask(&*st, &root, id, text)?;
    if let Some(s) = set.get(&kind) {
        p.model = s.model.trim().to_string();
        p.provider = s.provider.trim().to_string();
    }
    Ok((h, p))
}

/// Run the harness and record how the prompt ended; the answer comes back.
async fn finish(h: Arc<dyn Harness>, p: session::Prompt, id: u64) -> Result<String, String> {
    let r = match tokio::time::timeout(LIMIT, h.prompt(p)).await {
        Ok(r) => r,
        Err(_) => Err(format!("no answer in {} minutes", LIMIT.as_secs() / 60)),
    };
    let said = r.as_ref().map(|r| r.text.clone()).map_err(String::clone);
    if let Err(e) = session::settle(&*store(), &root(), id, r) {
        eprintln!("askk: session {id}: {e}");
    }
    said
}

/// The program `name` on the PATH.
fn found(name: &str) -> Option<PathBuf> {
    crate::core::places::path().into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

/// Why `name` cannot be run; `None` when it is on the PATH.
fn missing(name: &str) -> Option<String> {
    found(name).is_none().then(|| format!("`{name}` is not installed on this machine (not on the PATH)"))
}

/// The folder a session works in: the workspace, or its project folder there (made if absent).
fn folder(project: &str) -> Result<PathBuf, String> {
    session::check_project(project)?;
    crate::host::workspace::project(project)
}

/// What a harness printed.
struct Ran {
    out: String,
    err: String,
    ok: bool,
}

/// Where every program may write besides its own folder and state: devices and its temp files.
const TEMP: &[&str] = &["/dev", "/private/var/folders"];

/// Under the user's home, what every harness needs besides its own state: the login keychain
/// (its sign-in is refreshed there) and caches.
const SHARED: &[&str] = &["Library/Keychains", "Library/Caches"];

/// A path as a quoted string in a sandbox profile.
fn quoted(p: &std::path::Path) -> String {
    format!("\"{}\"", p.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\""))
}

/// The sandbox a session's program runs in (macOS): it may read and run as the user can, but
/// it may **write** only in its own folder (`dir`), in `temp`, and under `home` where a path
/// begins with one of `state`. So one project's agent cannot change another project, the
/// app's data, or the user's files.
fn profile(dir: &std::path::Path, home: &std::path::Path, state: &[&str], temp: &[&str]) -> String {
    let mut p = format!("(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath {}))\n", quoted(dir));
    for t in temp {
        p.push_str(&format!("(allow file-write* (subpath {}))\n", quoted(std::path::Path::new(t))));
    }
    for s in state {
        // A prefix, not a folder: `.claude` covers `.claude/` and `.claude.json`.
        let at: String = home.join(s).to_string_lossy().chars().flat_map(|c| if c.is_ascii_alphanumeric() || c == '/' { vec![c] } else { vec!['\\', c] }).collect();
        p.push_str(&format!("(allow file-write* (regex #\"^{at}\"))\n"));
    }
    p
}

/// Run `name args…` in the project folder with `input` on stdin, to its end, confined to that
/// folder and the program's own `state` ([`profile`]). The process dies with its task (a
/// prompt that hits [`LIMIT`] leaves nothing running).
async fn run(name: &str, args: &[String], input: &str, project: &str, state: &[&str]) -> Result<Ran, String> {
    use tokio::io::AsyncWriteExt;
    let prog = found(name).ok_or_else(|| missing(name).unwrap_or_default())?;
    let dir = folder(project)?;
    let dir = dir.canonicalize().unwrap_or(dir);
    let mut cmd = match crate::core::places::user_home() {
        Some(home) if cfg!(target_os = "macos") => {
            let all: Vec<&str> = state.iter().chain(SHARED).copied().collect();
            let mut c = tokio::process::Command::new("/usr/bin/sandbox-exec");
            c.arg("-p").arg(profile(&dir, &home, &all, TEMP)).arg(prog);
            c
        }
        // No such sandbox on this system: the harness's own limits are all there is.
        _ => tokio::process::Command::new(prog),
    };
    let mut child = cmd
        .args(args)
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("{name}: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    stdin.write_all(input.as_bytes()).await.map_err(|e| format!("{name}: {e}"))?;
    drop(stdin);
    let o = child.wait_with_output().await.map_err(|e| format!("{name}: {e}"))?;
    Ok(Ran { out: String::from_utf8_lossy(&o.stdout).into_owned(), err: String::from_utf8_lossy(&o.stderr).trim().to_string(), ok: o.status.success() })
}

/// A harness's parsed output, or what it printed to stderr when that says more.
fn or_stderr(name: &str, parsed: Result<Reply, String>, ran: &Ran) -> Result<Reply, String> {
    parsed.map_err(|e| if ran.ok || ran.err.is_empty() { format!("{name}: {e}") } else { format!("{name}: {e} ({})", ran.err.lines().last().unwrap_or_default()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_obeys_the_contract() {
        let all = all();
        let mut kinds: Vec<&str> = all.iter().map(|h| h.kind()).collect();
        assert!(all.iter().all(|h| !h.kind().is_empty() && !h.about().is_empty()));
        kinds.sort();
        kinds.dedup();
        assert_eq!(kinds.len(), all.len(), "one kind, one name");
        // A kind that cannot run says why instead of failing a prompt later.
        for i in infos() {
            assert!(i.missing.is_empty() || i.missing.contains(&i.kind), "{i:?}");
        }
    }

    /// The rule itself, enforced by the OS: a program in a project's sandbox writes in its
    /// folder and in its own state, and is refused next door.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_session_writes_only_in_its_project_and_its_own_state() {
        let root = std::env::temp_dir().join(format!("askk-sandbox-{}", std::process::id())).canonicalize().unwrap_or_else(|_| {
            let r = std::env::temp_dir().canonicalize().unwrap().join(format!("askk-sandbox-{}", std::process::id()));
            r
        });
        for d in ["projects/mine", "projects/other", "home/.tool"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        let (mine, home) = (root.join("projects/mine"), root.join("home"));
        let p = profile(&mine, &home, &[".tool"], &["/dev"]);
        let script = "echo a > in.txt; echo b > ../other/out.txt; echo c > ../../home/.tool/state.txt; echo d > ../../home/notes.txt; true";
        let o = std::process::Command::new("/usr/bin/sandbox-exec").arg("-p").arg(&p).args(["/bin/sh", "-c", script]).current_dir(&mine).output().unwrap();
        let made = |f: &str| root.join(f).is_file();
        assert!(made("projects/mine/in.txt") && made("home/.tool/state.txt"), "its folder and its state are writable: {}", String::from_utf8_lossy(&o.stderr));
        assert!(!made("projects/other/out.txt"), "another project is not");
        assert!(!made("home/notes.txt"), "the rest of the home is not");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_state_path_is_a_prefix_and_cannot_break_out_of_the_profile() {
        let p = profile(std::path::Path::new("/w/a \"b\""), std::path::Path::new("/Users/me"), &[".claude"], &[]);
        assert!(p.contains(r#"(subpath "/w/a \"b\"")"#), "{p}");
        assert!(p.contains(r#"(regex #"^/Users/me/\.claude")"#), "{p}");
        assert!(p.starts_with("(version 1)\n(allow default)\n(deny file-write*)\n"));
    }

    #[test]
    fn a_program_that_is_not_installed_is_named() {
        assert!(missing("askk-no-such-program").unwrap().contains("askk-no-such-program"));
        assert!(missing("sh").is_none());
    }
}
