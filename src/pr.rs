//! # PRs, changelog and restart: static features of the app
//!
//! Every git worktree is a PR: its branch, its `pr.md` (`# Title`, optional `status: …`, then
//! `## Section` blocks), the commits it has over `main`, and its diff. `main` itself shows its
//! uncommitted work, and its log is the changelog.
//!
//! Restart is a separate service. Run under `scripts/service.sh` (recommended), the supervisor
//! keeps the terminal and does the restart when asked (flag file `data/.restart`), so the app's
//! output stays there. Otherwise: the steps in `data/service.json` (`update`, `build`, `stop`,
//! `start`, each a shell command; empty = skip) are written to a runner script and started
//! detached, so it outlives this process. A failed update or build stops there and the app
//! keeps running. Progress goes to `data/service-status.json`, which the next process reads.
//!
//! Exposed as server functions for the PR page and as tools (`list_prs`, `changelog`,
//! `restart`) so engines and scripts can use them too.
#![cfg_attr(not(feature = "server"), allow(dead_code))]
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

pub const MAIN: &str = "main";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Section {
    pub name: String,
    pub body: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PrFile {
    pub title: String,
    pub status: String,
    pub sections: Vec<Section>,
}

/// `# Title`, then `status: x` before any section, then `## Section` with text.
pub fn parse_pr(text: &str) -> PrFile {
    let mut f = PrFile::default();
    for line in text.lines() {
        if let Some(t) = line.strip_prefix("## ") {
            f.sections.push(Section { name: t.trim().into(), body: String::new() });
        } else if let (Some(t), true) = (line.strip_prefix("# "), f.title.is_empty() && f.sections.is_empty()) {
            f.title = t.trim().into();
        } else if let (Some(s), true) = (line.to_lowercase().strip_prefix("status:").map(|s| s.trim().to_string()), f.sections.is_empty()) {
            f.status = s;
        } else if let Some(s) = f.sections.last_mut() {
            s.body.push_str(line);
            s.body.push('\n');
        }
    }
    for s in &mut f.sections {
        s.body = s.body.trim().into();
    }
    f
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Row {
    /// hunk | add | del | ctx
    pub kind: String,
    pub old: u32,
    pub new: u32,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    pub rows: Vec<Row>,
}

/// A unified diff as files with numbered rows.
pub fn parse_diff(text: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = vec![];
    let (mut old, mut new) = (0u32, 0u32);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let path = rest.rsplit_once(" b/").map_or(rest, |(_, p)| p);
            files.push(FileDiff { path: path.into(), ..Default::default() });
            continue;
        }
        let Some(f) = files.last_mut() else { continue };
        if line.starts_with("@@") {
            let num = |sign: char| {
                line.split_whitespace().find_map(|w| w.strip_prefix(sign)).and_then(|w| w.split(',').next()?.parse().ok()).unwrap_or(0)
            };
            (old, new) = (num('-'), num('+'));
            f.rows.push(Row { kind: "hunk".into(), old: 0, new: 0, text: line.into() });
        } else if f.rows.is_empty() {
            continue;
        } else if let Some(t) = line.strip_prefix('+') {
            f.added += 1;
            f.rows.push(Row { kind: "add".into(), old: 0, new, text: t.into() });
            new += 1;
        } else if let Some(t) = line.strip_prefix('-') {
            f.removed += 1;
            f.rows.push(Row { kind: "del".into(), old, new: 0, text: t.into() });
            old += 1;
        } else if let Some(t) = line.strip_prefix(' ') {
            f.rows.push(Row { kind: "ctx".into(), old, new, text: t.into() });
            old += 1;
            new += 1;
        }
    }
    files
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Commit {
    pub id: String,
    pub subject: String,
    pub at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Pr {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub title: String,
    /// From pr.md (`working`, `ready`, …); empty when pr.md has none.
    pub status: String,
    pub has_pr_file: bool,
    pub sections: Vec<Section>,
    pub commits: Vec<Commit>,
    pub files: Vec<FileDiff>,
    pub cut: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Board {
    pub prs: Vec<Pr>,
    pub changelog: Vec<Commit>,
    pub service: ServiceStatus,
    pub error: String,
}

/// Last restart progress (`data/service-status.json`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ServiceStatus {
    /// queued | update | build | stop | start | started | failed
    #[serde(default)]
    pub step: String,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub at: u64,
}

/// `data/service.json`: the restart steps, each a shell command run from the app folder.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Service {
    #[serde(default)]
    pub update: String,
    #[serde(default)]
    pub build: String,
    #[serde(default)]
    pub stop: String,
    #[serde(default)]
    pub start: String,
}

fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The runner: each step records itself in `status`, stops on failure; `start` runs detached.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub fn runner(svc: &Service, status: &str, log: &str) -> String {
    let mut s = format!(
        "#!/bin/sh\n# Written by askk restart; runs outside the app.\nmark() {{ printf '{{\"step\":\"%s\",\"ok\":%s,\"note\":\"%s\",\"at\":%s}}\\n' \"$1\" \"$2\" \"$3\" \"$(date +%s)\" > {st}; }}\n: > {lg}\n",
        st = quote(status),
        lg = quote(log)
    );
    for (step, cmd) in [("update", &svc.update), ("build", &svc.build)] {
        if !cmd.trim().is_empty() {
            s.push_str(&format!("mark {step} true ''\n( {cmd} ) >> {lg} 2>&1 || {{ mark failed false {step}; exit 1; }}\n", lg = quote(log)));
        }
    }
    if !svc.stop.trim().is_empty() {
        s.push_str(&format!("mark stop true ''\n( {} ) >> {} 2>&1\nsleep 1\n", svc.stop, quote(log)));
    }
    if !svc.start.trim().is_empty() {
        s.push_str(&format!("mark start true ''\nnohup sh -c {} >> {} 2>&1 &\n", quote(&svc.start), quote(log)));
    }
    s.push_str("mark started true ''\n");
    s
}

#[cfg(feature = "server")]
pub use server::*;

#[cfg(feature = "server")]
mod server {
    use super::*;
    use crate::core::{tool, Tool};
    use serde_json::{json, Value};
    use std::{path::Path, sync::Arc};

    const MAX_DIFF: usize = 1_000_000;

    fn git(cwd: &Path, args: &[&str]) -> Option<String> {
        let o = std::process::Command::new("git").args(args).current_dir(cwd).output().ok()?;
        o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
    }

    fn commits(cwd: &Path, range: &[&str]) -> Vec<Commit> {
        let mut args = vec!["log", "--format=%h%x1f%s%x1f%aI%x1e"];
        args.extend(range);
        git(cwd, &args)
            .unwrap_or_default()
            .split('\x1e')
            .map(str::trim)
            .filter(|e| !e.is_empty())
            .map(|e| {
                let mut p = e.split('\x1f');
                Commit { id: p.next().unwrap_or_default().into(), subject: p.next().unwrap_or_default().into(), at: p.next().unwrap_or_default().into() }
            })
            .collect()
    }

    fn read_pr(dir: &Path) -> Option<PrFile> {
        ["pr.md", "PR.md"].iter().find_map(|f| std::fs::read_to_string(dir.join(f)).ok()).map(|t| parse_pr(&t))
    }

    /// One worktree as a PR: branch commits/diff against main, or main's uncommitted work.
    fn read(dir: &Path, branch: &str, head: &str) -> Pr {
        let on_main = branch == MAIN;
        let base = if on_main { "HEAD".to_string() } else { git(dir, &["merge-base", MAIN, "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_else(|| "HEAD".into()) };
        let mut diff = git(dir, &["diff", &base, "--", ".", ":!pr.md", ":!PR.md"]).unwrap_or_default();
        let cut = diff.len() > MAX_DIFF;
        if cut {
            diff.truncate((0..=MAX_DIFF).rev().find(|i| diff.is_char_boundary(*i)).unwrap_or(0));
        }
        let commits = if on_main { vec![] } else { commits(dir, &[&format!("{base}..HEAD")]) };
        let file = read_pr(dir);
        Pr {
            path: dir.display().to_string(),
            branch: branch.into(),
            head: head.into(),
            title: file.as_ref().map(|f| f.title.clone()).filter(|t| !t.is_empty()).or_else(|| commits.last().map(|c| c.subject.clone())).unwrap_or_else(|| if on_main { "Working changes".into() } else { branch.into() }),
            status: file.as_ref().map(|f| f.status.clone()).unwrap_or_default(),
            has_pr_file: file.is_some(),
            sections: file.map(|f| f.sections).unwrap_or_default(),
            commits,
            files: parse_diff(&diff),
            cut,
        }
    }

    /// `git worktree list --porcelain` → (path, branch, head).
    pub fn worktrees(repo: &Path) -> Vec<(String, String, String)> {
        let mut out = vec![];
        let (mut path, mut head, mut branch) = (String::new(), String::new(), String::new());
        for line in git(repo, &["worktree", "list", "--porcelain"]).unwrap_or_default().lines().chain([""]) {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = p.into();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.chars().take(7).collect();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = b.trim_start_matches("refs/heads/").into();
            } else if line.is_empty() && !path.is_empty() {
                out.push((std::mem::take(&mut path), if branch.is_empty() { "detached".into() } else { std::mem::take(&mut branch) }, std::mem::take(&mut head)));
            }
        }
        out
    }

    pub fn repo() -> std::path::PathBuf {
        std::env::var("ASKK_REPO").map(Into::into).unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
    }

    pub fn board(repo: &Path) -> Board {
        let trees = worktrees(repo);
        if trees.is_empty() {
            return Board { error: format!("{} is not a git repository", repo.display()), ..Default::default() };
        }
        Board {
            prs: trees.iter().map(|(p, b, h)| read(Path::new(p), b, h)).collect(),
            changelog: commits(repo, &["-30", MAIN]),
            service: status(),
            error: String::new(),
        }
    }

    fn data(f: &str) -> std::path::PathBuf {
        crate::api::data_dir().join(f)
    }

    pub fn status() -> ServiceStatus {
        std::fs::read_to_string(data("service-status.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Write the runner and start it detached (own process group), so stopping the app does
    /// not stop the restart.
    pub fn restart() -> Result<String, String> {
        let svc: Service = serde_json::from_str(&std::fs::read_to_string(data("service.json")).map_err(|e| format!("data/service.json: {e}"))?).map_err(|e| format!("data/service.json: {e}"))?;
        if svc.start.trim().is_empty() {
            return Err("data/service.json has no start command".into());
        }
        // Under scripts/service.sh the supervisor owns the terminal: ask it, it does the rest.
        if std::env::var("ASKK_SUPERVISED").is_ok() {
            std::fs::write(data(".restart"), now().to_string()).map_err(|e| e.to_string())?;
            std::fs::write(data("service-status.json"), json!({"step": "queued", "ok": true, "at": now()}).to_string()).map_err(|e| e.to_string())?;
            return Ok("restart requested from the supervisor (scripts/service.sh); output stays in its terminal".into());
        }
        let abs = |f: &str| std::path::absolute(data(f)).unwrap_or_else(|_| data(f)).display().to_string();
        let script = abs(".restart.sh");
        std::fs::write(&script, runner(&svc, &abs("service-status.json"), &abs("service.log"))).map_err(|e| e.to_string())?;
        std::fs::write(data("service-status.json"), json!({"step": "queued", "ok": true, "at": now()}).to_string()).map_err(|e| e.to_string())?;
        use std::os::unix::process::CommandExt;
        std::process::Command::new("sh")
            .arg(&script)
            .current_dir(repo())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok("restart started: update, build, stop, start (see data/service.log)".into())
    }

    fn now() -> u64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
    }

    /// Last lines of the restart log.
    pub fn log_tail() -> String {
        let s = std::fs::read_to_string(data("service.log")).unwrap_or_default();
        let lines: Vec<&str> = s.lines().collect();
        lines[lines.len().saturating_sub(30)..].join("\n")
    }

    /// Squash a ready PR's branch into main with its pr.md as the message. Refuses when main
    /// has uncommitted tracked changes, the branch is unknown, or its pr.md is not `ready`.
    pub fn squash_merge(repo: &Path, branch: &str) -> Result<String, String> {
        if branch == MAIN || branch.is_empty() {
            return Err("pick a PR branch".into());
        }
        let trees = worktrees(repo);
        let (path, _, _) = trees.iter().find(|(_, b, _)| b == branch).ok_or_else(|| format!("no worktree on {branch}"))?;
        let pr = read_pr(Path::new(path)).ok_or("no pr.md in that worktree")?;
        if pr.status != "ready" {
            return Err(format!("{branch} is '{}', not ready", if pr.status.is_empty() { "working" } else { &pr.status }));
        }
        let main_tree = trees.iter().find(|(_, b, _)| b == MAIN).map(|(p, _, _)| p.clone()).ok_or("main is not checked out in any worktree")?;
        let main_tree = Path::new(&main_tree);
        if !git(main_tree, &["status", "--porcelain", "--untracked-files=no"]).unwrap_or_default().trim().is_empty() {
            return Err("main has uncommitted changes; commit or stash them first".into());
        }
        let run = |args: &[&str]| -> Result<String, String> {
            let o = std::process::Command::new("git").args(args).current_dir(main_tree).output().map_err(|e| e.to_string())?;
            if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
        };
        if let Err(e) = run(&["merge", "--squash", branch]) {
            let _ = run(&["merge", "--abort"]);
            let _ = run(&["reset", "--merge"]);
            return Err(format!("conflicts with main: {e}"));
        }
        if run(&["diff", "--cached", "--quiet"]).is_ok() {
            return Err("nothing to merge: main already has these changes".into());
        }
        let body: Vec<String> = pr.sections.iter().map(|s| format!("{}:\n{}", s.name, s.body)).collect();
        let message = [pr.title.clone(), body.join("\n\n")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
        run(&["commit", "-q", "-m", &message])?;
        let id = run(&["rev-parse", "--short", "HEAD"])?.trim().to_string();
        Ok(format!("squashed {branch} into main as {id}"))
    }

    pub fn tools() -> Vec<Arc<dyn Tool>> {
        vec![
            tool("list_prs", "every worktree as a PR: branch, pr.md title/status/sections, commits, changed files", Value::Null, |_| {
                let b = board(&repo());
                Ok(json!(b.prs.iter().map(|p| json!({"branch": p.branch, "title": p.title, "status": p.status, "path": p.path, "commits": p.commits.len(), "files": p.files.iter().map(|f| format!("{} +{} -{}", f.path, f.added, f.removed)).collect::<Vec<_>>()})).collect::<Vec<_>>()))
            }),
            tool("changelog", "recent commits on main", Value::Null, |_| Ok(json!(commits(&repo(), &["-30", MAIN])))),
            tool("restart", "update, build, stop and restart the app (configured in data/service.json)", Value::Null, |_| restart().map(Value::String)),
        ]
    }
}

#[server]
pub async fn pr_board() -> Result<Board, ServerFnError> {
    Ok(board(&repo()))
}

#[server]
pub async fn merge_pr(branch: String) -> Result<String, ServerFnError> {
    squash_merge(&repo(), &branch).map_err(ServerFnError::new)
}

#[server]
pub async fn restart_app() -> Result<String, ServerFnError> {
    restart().map_err(ServerFnError::new)
}

#[server]
pub async fn service_state() -> Result<(ServiceStatus, String), ServerFnError> {
    Ok((status(), log_tail()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_md_has_title_status_and_sections() {
        let f = parse_pr("# Add PR page\nstatus: Ready\n\n## Why\nSee every worktree.\n\n## Changes\n- pr.rs\n- view\n");
        assert_eq!((f.title.as_str(), f.status.as_str()), ("Add PR page", "ready"));
        assert_eq!(f.sections, vec![Section { name: "Why".into(), body: "See every worktree.".into() }, Section { name: "Changes".into(), body: "- pr.rs\n- view".into() }]);
    }

    #[test]
    fn diffs_become_numbered_rows() {
        let d = "diff --git a/x.rs b/x.rs\nindex 1..2\n--- a/x.rs\n+++ b/x.rs\n@@ -3,2 +3,3 @@ fn\n keep\n-old\n+new\n+more\n";
        let f = &parse_diff(d)[0];
        assert_eq!((f.path.as_str(), f.added, f.removed), ("x.rs", 2, 1));
        let rows: Vec<(String, u32, u32)> = f.rows.iter().map(|r| (r.kind.clone(), r.old, r.new)).collect();
        assert_eq!(rows, [("hunk".into(), 0, 0), ("ctx".into(), 3, 3), ("del".into(), 4, 0), ("add".into(), 0, 4), ("add".into(), 0, 5)]);
    }

    /// The runner stops at a failed build (the app keeps running) and otherwise reaches
    /// `started` with the new process detached.
    #[test]
    fn restart_runner_stops_on_failed_build_and_otherwise_starts() {
        let dir = std::env::temp_dir().join(format!("askk-svc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |svc: Service| {
            let (st, lg, sh) = (dir.join("st.json"), dir.join("log"), dir.join("r.sh"));
            std::fs::write(&sh, runner(&svc, &st.display().to_string(), &lg.display().to_string())).unwrap();
            assert!(std::process::Command::new("sh").arg(&sh).current_dir(&dir).status().is_ok());
            std::thread::sleep(std::time::Duration::from_millis(300));
            let s: ServiceStatus = serde_json::from_str(&std::fs::read_to_string(st).unwrap()).unwrap();
            (s, std::fs::read_to_string(lg).unwrap())
        };
        let (s, log) = run(Service { build: "echo building; exit 2".into(), stop: "echo stopping".into(), start: "echo started-it".into(), ..Default::default() });
        assert_eq!((s.step.as_str(), s.ok, s.note.as_str()), ("failed", false, "build"));
        assert!(log.contains("building") && !log.contains("stopping"), "{log}");
        let (s, log) = run(Service { update: "echo pulled".into(), build: "echo built".into(), stop: "echo stopping".into(), start: "echo \"up and running\"".into() });
        assert_eq!((s.step.as_str(), s.ok), ("started", true));
        assert!(["pulled", "built", "stopping", "up and running"].iter().all(|w| log.contains(w)), "{log}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Squash-merge only takes a ready PR, refuses a dirty main, and commits with pr.md.
    #[cfg(feature = "server")]
    #[test]
    fn squash_merge_takes_ready_prs_into_a_clean_main() {
        use std::process::Command;
        let root = std::env::temp_dir().join(format!("askk-merge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let g = |dir: &std::path::Path, args: &[&str]| { let o = Command::new("git").args(args).current_dir(dir).output().unwrap(); assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr)); };
        g(&root, &["init", "-q", "-b", "main"]);
        g(&root, &["config", "user.email", "t@t"]);
        g(&root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        g(&root, &["add", "."]);
        g(&root, &["commit", "-qm", "start"]);
        let wt = root.join(".worktrees/x");
        g(&root, &["worktree", "add", "-q", "-b", "feature/x", wt.to_str().unwrap()]);
        std::fs::write(wt.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(wt.join("pr.md"), "# Add two\nstatus: working\n\n## Why\nNeed two.\n").unwrap();
        g(&wt, &["add", "."]);
        g(&wt, &["commit", "-qm", "wip"]);
        assert!(squash_merge(&root, "feature/x").unwrap_err().contains("not ready"));
        std::fs::write(wt.join("pr.md"), "# Add two\nstatus: ready\n\n## Why\nNeed two.\n").unwrap();
        std::fs::write(root.join("a.txt"), "dirty\n").unwrap();
        assert!(squash_merge(&root, "feature/x").unwrap_err().contains("uncommitted"));
        g(&root, &["checkout", "-q", "a.txt"]);
        let ok = squash_merge(&root, "feature/x").unwrap();
        assert!(ok.starts_with("squashed feature/x into main"), "{ok}");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "one\ntwo\n");
        let log = String::from_utf8(Command::new("git").args(["log", "-1", "--format=%B"]).current_dir(&root).output().unwrap().stdout).unwrap();
        assert!(log.starts_with("Add two") && log.contains("Why:\nNeed two."), "{log}");
        assert!(squash_merge(&root, "feature/nope").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
