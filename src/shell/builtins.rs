//! Shell builtins over the workspace filesystem.
//!
//! Each builtin returns its printable output (no trailing newline) or a
//! human-readable error. Directories exist both explicitly (`mkdir` entries)
//! and implicitly (every ancestor of a stored path); the pure helpers
//! [`implied_dirs`] and [`children_of`] reconstruct that structure from the
//! flat `(path, is_dir)` listing so they stay host-testable.

use super::fs::ShellFs;
use super::{ShellSession, display_path, resolve_path};
use crate::state::AppResult;
use std::collections::BTreeSet;

/// Dispatch one tokenized builtin. `argv` is non-empty and `argv[0]` is one of
/// the names routed here by [`super::run_line`].
pub async fn run_builtin(
    session: &mut ShellSession,
    fs: &ShellFs,
    argv: &[String],
) -> AppResult<String> {
    let Some(command) = argv.first() else {
        return Ok(String::new());
    };
    match command.as_str() {
        "help" => Ok(help_text()),
        "pwd" => Ok(display_path(&session.cwd)),
        "echo" => Ok(argv[1..].join(" ")),
        "ls" => ls(session, fs, argv.get(1).map(String::as_str)).await,
        "cat" => cat(session, fs, argv).await,
        "cd" => cd(session, fs, argv).await,
        "mkdir" => mkdir(session, fs, argv).await,
        "touch" => touch(session, fs, argv).await,
        "rm" => rm(session, fs, argv).await,
        "mv" => mv(session, fs, argv).await,
        other => Err(format!("command not found: {other} (type help)")),
    }
}

fn help_text() -> String {
    [
        "ASKK shell — builtins:",
        "  ls [path]        list directory contents",
        "  cat <file>       print a file",
        "  cd <dir>         change directory",
        "  pwd              print working directory",
        "  mkdir <dir>      create a directory",
        "  rm [-r] <path>   remove a file (-r: recurse into a directory)",
        "  mv <from> <to>   move/rename a file or directory",
        "  touch <file>     create an empty file",
        "  echo <text...>   print text",
        "  clear            clear the terminal",
        "  help             show this help",
        "",
        "runtimes:",
        "  js <file> | node <file>   run a JS file in the sandboxed Web Worker",
        "  python <file> [args]      Python runtime (lands in a sibling unit)",
        "  run <file.wasm> [args]    WASM runtime (lands in a sibling unit)",
    ]
    .join("\n")
}

/// Every directory implied by the entry set: explicit directory entries plus
/// each ancestor directory of any stored path.
fn implied_dirs(entries: &[(String, bool)]) -> BTreeSet<String> {
    let mut dirs = BTreeSet::new();
    for (path, is_dir) in entries {
        if *is_dir {
            dirs.insert(path.clone());
        }
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        let mut acc = String::new();
        for part in parts.iter().take(parts.len().saturating_sub(1)) {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(part);
            dirs.insert(acc.clone());
        }
    }
    dirs
}

/// Direct children of `dir` (`""` = root) as `(name, is_dir)`, directories
/// first, each group sorted. A name that is both a file and an implied
/// directory shows as a directory.
fn children_of(entries: &[(String, bool)], dir: &str) -> Vec<(String, bool)> {
    let prefix = if dir.is_empty() {
        String::new()
    } else {
        format!("{dir}/")
    };
    let mut dirs = BTreeSet::new();
    let mut files = BTreeSet::new();
    for (path, is_dir) in entries {
        let Some(rest) = path.strip_prefix(&prefix) else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }
        match rest.split_once('/') {
            Some((head, _)) => {
                dirs.insert(head.to_string());
            }
            None if *is_dir => {
                dirs.insert(rest.to_string());
            }
            None => {
                files.insert(rest.to_string());
            }
        }
    }
    let mut out: Vec<(String, bool)> = dirs.iter().cloned().map(|name| (name, true)).collect();
    out.extend(
        files
            .into_iter()
            .filter(|name| !dirs.contains(name))
            .map(|name| (name, false)),
    );
    out
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

async fn ls(session: &ShellSession, fs: &ShellFs, arg: Option<&str>) -> AppResult<String> {
    let shown = arg.unwrap_or(".");
    let target = resolve_path(&session.cwd, shown)?;
    let entries = fs.list_all().await?;
    if !target.is_empty() && !implied_dirs(&entries).contains(&target) {
        if entries
            .iter()
            .any(|(path, is_dir)| path == &target && !is_dir)
        {
            return Ok(base_name(&target).to_string());
        }
        return Err(format!("ls: {shown}: no such file or directory"));
    }
    let lines: Vec<String> = children_of(&entries, &target)
        .into_iter()
        .map(|(name, is_dir)| {
            if is_dir {
                format!("\u{1b}[1;34m{name}/\u{1b}[0m")
            } else {
                name
            }
        })
        .collect();
    Ok(lines.join("\n"))
}

async fn cat(session: &ShellSession, fs: &ShellFs, argv: &[String]) -> AppResult<String> {
    let arg = argv.get(1).ok_or("usage: cat <file>")?;
    let path = resolve_path(&session.cwd, arg)?;
    if path.is_empty() {
        return Err(format!("cat: {arg}: is a directory"));
    }
    let entries = fs.list_all().await?;
    if implied_dirs(&entries).contains(&path) {
        return Err(format!("cat: {arg}: is a directory"));
    }
    match fs.read_file(&path).await? {
        Some(content) => Ok(content),
        None => Err(format!("cat: {arg}: no such file")),
    }
}

async fn cd(session: &mut ShellSession, fs: &ShellFs, argv: &[String]) -> AppResult<String> {
    let arg = argv.get(1).map(String::as_str).unwrap_or("/");
    let target = resolve_path(&session.cwd, arg)?;
    if !target.is_empty() {
        let entries = fs.list_all().await?;
        if !implied_dirs(&entries).contains(&target) {
            return Err(format!("cd: {arg}: no such directory"));
        }
    }
    session.cwd = target;
    Ok(String::new())
}

async fn mkdir(session: &ShellSession, fs: &ShellFs, argv: &[String]) -> AppResult<String> {
    let arg = argv.get(1).ok_or("usage: mkdir <dir>")?;
    let path = resolve_path(&session.cwd, arg)?;
    if path.is_empty() {
        return Err("mkdir: the workspace root already exists".to_string());
    }
    let entries = fs.list_all().await?;
    if entries.iter().any(|(existing, _)| existing == &path)
        || implied_dirs(&entries).contains(&path)
    {
        return Err(format!("mkdir: {arg}: already exists"));
    }
    fs.mkdir(&path).await?;
    Ok(String::new())
}

async fn touch(session: &ShellSession, fs: &ShellFs, argv: &[String]) -> AppResult<String> {
    let arg = argv.get(1).ok_or("usage: touch <file>")?;
    let path = resolve_path(&session.cwd, arg)?;
    if path.is_empty() {
        return Err(format!("touch: {arg}: is a directory"));
    }
    let entries = fs.list_all().await?;
    if implied_dirs(&entries).contains(&path) {
        return Err(format!("touch: {arg}: is a directory"));
    }
    if entries
        .iter()
        .any(|(existing, is_dir)| existing == &path && !is_dir)
    {
        return Ok(String::new()); // exists: like POSIX touch, leave content alone
    }
    fs.write_file(&path, "").await?;
    Ok(String::new())
}

async fn rm(session: &mut ShellSession, fs: &ShellFs, argv: &[String]) -> AppResult<String> {
    let mut recursive = false;
    let mut target: Option<&String> = None;
    for arg in &argv[1..] {
        if arg == "-r" {
            recursive = true;
        } else if arg.starts_with('-') {
            return Err(format!("rm: unknown option {arg} (usage: rm [-r] <path>)"));
        } else if target.is_none() {
            target = Some(arg);
        } else {
            return Err("usage: rm [-r] <path>".to_string());
        }
    }
    let arg = target.ok_or("usage: rm [-r] <path>")?;
    let path = resolve_path(&session.cwd, arg)?;
    if path.is_empty() {
        return Err("rm: refusing to remove the workspace root".to_string());
    }
    let entries = fs.list_all().await?;
    let is_file = entries
        .iter()
        .any(|(existing, is_dir)| existing == &path && !is_dir);
    let is_dir = implied_dirs(&entries).contains(&path);
    if !is_file && !is_dir {
        return Err(format!("rm: {arg}: no such file or directory"));
    }
    if is_dir && !recursive {
        return Err(format!("rm: {arg}: is a directory (use rm -r)"));
    }
    let prefix = format!("{path}/");
    for (existing, _) in &entries {
        if existing == &path || existing.starts_with(&prefix) {
            fs.delete(existing).await?;
        }
    }
    // If the cwd was removed, fall back to its nearest surviving ancestor.
    if is_dir && (session.cwd == path || session.cwd.starts_with(&prefix)) {
        session.cwd = match path.rsplit_once('/') {
            Some((parent, _)) => parent.to_string(),
            None => String::new(),
        };
    }
    Ok(String::new())
}

async fn mv(session: &mut ShellSession, fs: &ShellFs, argv: &[String]) -> AppResult<String> {
    let from_arg = argv.get(1).ok_or("usage: mv <from> <to>")?;
    let to_arg = argv.get(2).ok_or("usage: mv <from> <to>")?;
    let from = resolve_path(&session.cwd, from_arg)?;
    let mut to = resolve_path(&session.cwd, to_arg)?;
    if from.is_empty() {
        return Err("mv: cannot move the workspace root".to_string());
    }
    let entries = fs.list_all().await?;
    let dirs = implied_dirs(&entries);
    // `mv x existing-dir` moves x *into* the directory, POSIX style.
    if to.is_empty() || dirs.contains(&to) {
        let name = base_name(&from);
        to = if to.is_empty() {
            name.to_string()
        } else {
            format!("{to}/{name}")
        };
    }
    if to == from {
        return Ok(String::new());
    }
    let from_is_file = entries
        .iter()
        .any(|(existing, is_dir)| existing == &from && !is_dir);
    let from_is_dir = dirs.contains(&from);
    if !from_is_file && !from_is_dir {
        return Err(format!("mv: {from_arg}: no such file or directory"));
    }
    if entries.iter().any(|(existing, _)| existing == &to) {
        return Err(format!("mv: {to_arg}: already exists"));
    }
    if from_is_dir {
        let from_prefix = format!("{from}/");
        if to.starts_with(&from_prefix) {
            return Err(format!("mv: cannot move {from_arg} into itself"));
        }
        for (existing, _) in &entries {
            if existing == &from || existing.starts_with(&from_prefix) {
                let dest = format!("{to}{}", &existing[from.len()..]);
                fs.rename(existing, &dest).await?;
            }
        }
        if session.cwd == from || session.cwd.starts_with(&from_prefix) {
            session.cwd = format!("{to}{}", &session.cwd[from.len()..]);
        }
    } else {
        fs.rename(&from, &to).await?;
    }
    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries() -> Vec<(String, bool)> {
        vec![
            ("src/lib/add.js".to_string(), false),
            ("src/main.js".to_string(), false),
            ("README.md".to_string(), false),
            ("empty".to_string(), true), // explicit mkdir entry
        ]
    }

    #[test]
    fn implied_dirs_cover_explicit_and_ancestor_directories() {
        let dirs = implied_dirs(&entries());
        assert!(dirs.contains("src"));
        assert!(dirs.contains("src/lib"));
        assert!(dirs.contains("empty"));
        assert!(!dirs.contains("README.md"));
        assert!(!dirs.contains("src/main.js"));
    }

    #[test]
    fn children_of_lists_direct_children_dirs_first() {
        let children = children_of(&entries(), "");
        assert_eq!(
            children,
            vec![
                ("empty".to_string(), true),
                ("src".to_string(), true),
                ("README.md".to_string(), false),
            ]
        );
        let children = children_of(&entries(), "src");
        assert_eq!(
            children,
            vec![("lib".to_string(), true), ("main.js".to_string(), false),]
        );
        assert!(children_of(&entries(), "empty").is_empty());
    }

    #[test]
    fn children_of_does_not_leak_prefix_sibling_names() {
        // Listing "src" must not show entries from "src-extra".
        let entries = vec![
            ("src/a.js".to_string(), false),
            ("src-extra/b.js".to_string(), false),
        ];
        let children = children_of(&entries, "src");
        assert_eq!(children, vec![("a.js".to_string(), false)]);
    }

    #[test]
    fn echo_and_pwd_and_help_are_pure() {
        let fs = ShellFs::new();
        let mut session = ShellSession {
            cwd: "src/lib".to_string(),
        };
        let argv = |parts: &[&str]| parts.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            pollster::block_on(run_builtin(
                &mut session,
                &fs,
                &argv(&["echo", "hi", "there"])
            ))
            .expect("echo"),
            "hi there"
        );
        assert_eq!(
            pollster::block_on(run_builtin(&mut session, &fs, &argv(&["pwd"]))).expect("pwd"),
            "/src/lib"
        );
        let help =
            pollster::block_on(run_builtin(&mut session, &fs, &argv(&["help"]))).expect("help");
        assert!(help.contains("ls [path]"));
        assert!(help.contains("rm [-r]"));
    }
}
