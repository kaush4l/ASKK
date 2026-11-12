//! # Files: a workspace's files as a tree a person opens folder by folder
//!
//! The service lists a workspace's files as paths (`elements/workspace.rs`); a UI shows them
//! as a tree: folders first, then files, each by name, and only what lies in open folders.
use std::collections::BTreeSet;

/// One line of the file tree: a folder or a file, at its depth.
#[derive(Clone, Debug, PartialEq)]
pub struct TreeRow {
    pub path: String,
    pub name: String,
    pub depth: usize,
    pub dir: bool,
}

/// The tree of relative file paths, flattened in display order: folders first, then files,
/// each by name.
pub fn tree_rows(files: &[String]) -> Vec<TreeRow> {
    #[derive(Default)]
    struct Dir {
        dirs: std::collections::BTreeMap<String, Dir>,
        files: BTreeSet<String>,
    }
    let mut root = Dir::default();
    for f in files {
        let parts: Vec<&str> = f.split('/').filter(|s| !s.is_empty()).collect();
        let Some((last, dirs)) = parts.split_last() else { continue };
        let mut d = &mut root;
        for p in dirs {
            d = d.dirs.entry(p.to_string()).or_default();
        }
        d.files.insert(last.to_string());
    }
    fn walk(d: &Dir, prefix: &str, depth: usize, out: &mut Vec<TreeRow>) {
        let join = |n: &str| if prefix.is_empty() { n.to_string() } else { format!("{prefix}/{n}") };
        for (name, sub) in &d.dirs {
            let path = join(name);
            out.push(TreeRow { path: path.clone(), name: name.clone(), depth, dir: true });
            walk(sub, &path, depth + 1, out);
        }
        for name in &d.files {
            out.push(TreeRow { path: join(name), name: name.clone(), depth, dir: false });
        }
    }
    let mut out = vec![];
    walk(&root, "", 0, &mut out);
    out
}

/// The rows to draw: those whose every ancestor folder is open.
pub fn visible<'a>(rows: &'a [TreeRow], is_open: impl Fn(&str) -> bool) -> Vec<&'a TreeRow> {
    rows.iter()
        .filter(|r| {
            let mut anc = r.path.as_str();
            while let Some((up, _)) = anc.rsplit_once('/') {
                if !is_open(up) {
                    return false;
                }
                anc = up;
            }
            true
        })
        .collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn tree_lists_folders_first_with_depth() {
        let rows = tree_rows(&s(&["README.md", "src/main.rs", "src/views/a.rs", "Cargo.toml"]));
        let got: Vec<(&str, usize, bool)> = rows.iter().map(|r| (r.path.as_str(), r.depth, r.dir)).collect();
        assert_eq!(got, vec![("src", 0, true), ("src/views", 1, true), ("src/views/a.rs", 2, false), ("src/main.rs", 1, false), ("Cargo.toml", 0, false), ("README.md", 0, false)]);
    }

    #[test]
    fn closed_folders_hide_their_contents() {
        let rows = tree_rows(&s(&["src/main.rs", "src/views/a.rs", "x.rs"]));
        let shown: Vec<&str> = visible(&rows, |d| d == "src").iter().map(|r| r.path.as_str()).collect();
        assert_eq!(shown, vec!["src", "src/views", "src/main.rs", "x.rs"]);
        let none: Vec<&str> = visible(&rows, |_| false).iter().map(|r| r.path.as_str()).collect();
        assert_eq!(none, vec!["src", "x.rs"]);
    }
}
