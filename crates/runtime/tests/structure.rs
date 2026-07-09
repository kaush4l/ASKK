//! Layer-7 structure tests (docs/TESTING.md, ADR-012/013): file-size cap,
//! one-way import rules, MAP.md paths exist (docs may not outrun code), and
//! every agents/ markdown file still parses. Pure std file walking.

use std::fs;
use std::path::{Path, PathBuf};

use askk_runtime::config::{load_soul, AgentConfig, SkillConfig};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// All files under `root` (recursive) whose extension matches.
fn files_with_ext(root: &Path, ext: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == ext) {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// Every `crates/**/src/**/*.rs` file in the workspace.
fn src_rs_files(root: &Path) -> Vec<PathBuf> {
    let crates = root.join("crates");
    fs::read_dir(&crates)
        .expect("crates/ exists")
        .flat_map(|entry| files_with_ext(&entry.expect("crate dir").path().join("src"), "rs"))
        .collect()
}

fn rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

#[test]
fn file_size_cap_520_lines() {
    let root = workspace_root();
    let files = src_rs_files(&root);
    assert!(!files.is_empty(), "no source files found — walker broken?");
    let offenders: Vec<String> = files
        .iter()
        .filter_map(|path| {
            let lines = fs::read_to_string(path)
                .expect("readable source")
                .lines()
                .count();
            (lines > 520).then(|| format!("{} ({lines} lines)", rel(&root, path)))
        })
        .collect();
    assert!(
        offenders.is_empty(),
        "files over the ~500-line cap (ADR-012):\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn import_direction_is_one_way() {
    // (dir, forbidden substrings) — ADR-009/013 wire rules. A missing dir
    // (e.g. crates/web/src/ui before the web wave merges) skips gracefully.
    let rules: &[(&str, &[&str])] = &[
        (
            "crates/core/src",
            &[
                "askk_inference",
                "askk_runtime",
                "askk_web",
                "dioxus",
                "web_sys",
            ],
        ),
        (
            "crates/inference/src",
            &["askk_runtime", "askk_web", "dioxus"],
        ),
        ("crates/runtime/src", &["dioxus", "web_sys", "askk_web"]),
        ("crates/web/src/ui", &["askk_runtime", "askk_inference"]),
    ];
    let root = workspace_root();
    let mut violations = Vec::new();
    for (dir, forbidden) in rules {
        let dir_path = root.join(dir);
        if !dir_path.is_dir() {
            continue; // not built yet — planned surface
        }
        for path in files_with_ext(&dir_path, "rs") {
            let text = fs::read_to_string(&path).expect("readable source");
            for needle in *forbidden {
                if text.contains(needle) {
                    violations.push(format!("{}: contains '{needle}'", rel(&root, &path)));
                }
            }
        }
    }
    assert!(
        violations.is_empty(),
        "import-direction violations (core ← inference ← runtime ← web):\n  {}",
        violations.join("\n  ")
    );
}

/// Backticked `crates/...` tokens in a MAP.md table row, with planned (⏳)
/// entries dropped and `{a,b}` alternation expanded.
fn row_paths(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let segments: Vec<&str> = line.split('`').collect();
    for (i, segment) in segments.iter().enumerate() {
        // Odd indices are inside backticks; the preceding text carries ⏳.
        if i % 2 == 0 || !segment.starts_with("crates/") || segment.contains('<') {
            continue;
        }
        if segments[i - 1].trim_end().ends_with('⏳') {
            continue; // planned, allowed to not exist yet
        }
        let path = segment.trim_end_matches('/');
        match (path.find('{'), path.find('}')) {
            (Some(open), Some(close)) if open < close => {
                for alt in path[open + 1..close].split(',') {
                    out.push(format!("{}{}{}", &path[..open], alt, &path[close + 1..]));
                }
            }
            _ => out.push(path.to_string()),
        }
    }
    out
}

#[test]
fn map_md_paths_exist() {
    let root = workspace_root();
    let map = fs::read_to_string(root.join("MAP.md")).expect("MAP.md at workspace root");
    let missing: Vec<String> = map
        .lines()
        .filter(|line| line.trim_start().starts_with('|'))
        .flat_map(row_paths)
        .filter(|path| !root.join(path).exists())
        .collect();
    assert!(
        missing.is_empty(),
        "MAP.md lists paths that do not exist (docs may not outrun code, ADR-013):\n  {}",
        missing.join("\n  ")
    );
}

#[test]
fn every_agents_markdown_parses() {
    let root = workspace_root();
    let agents = root.join("crates/web/assets/agents");
    assert!(agents.is_dir(), "agents/ missing at {}", agents.display());
    let mut seen = 0usize;
    for path in files_with_ext(&agents, "md") {
        let label = rel(&root, &path);
        let text = fs::read_to_string(&path).expect("readable file");
        let rel_path = path.strip_prefix(&agents).expect("under agents/");
        if rel_path == Path::new("soul.md") {
            assert!(!load_soul(&text).is_empty(), "{label}: soul.md is empty");
        } else if rel_path.starts_with("skills") {
            SkillConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}"));
        } else {
            AgentConfig::from_markdown(&label, &text).unwrap_or_else(|e| panic!("{e}"));
        }
        seen += 1;
    }
    assert!(seen > 0, "no markdown found under agents/ — walker broken?");
}
