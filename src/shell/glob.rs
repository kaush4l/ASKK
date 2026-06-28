//! Filename globbing for the virtual shell.
//!
//! [`glob_expand`] expands one argument token containing `*`, `?` or `[…]`
//! against the workspace listing, segment by segment, the way a POSIX shell
//! expands a path pattern. A token with no glob metacharacters is returned
//! unchanged; a pattern that matches nothing is returned literally (the shell
//! default with `nullglob` off), so e.g. `ls *.zip` in a directory with no
//! `.zip` files runs `ls *.zip` and lets `ls` report "no such file".
//!
//! Everything here is pure over a `(path, is_dir)` listing — no filesystem
//! access — so it stays host-testable. The single-segment matcher
//! [`segment_matches`] never lets `*`/`?` cross a `/`, matching POSIX.

use std::collections::BTreeSet;

/// Does `token` contain any glob metacharacter (`*`, `?`, or a `[`)?
pub fn has_glob(token: &str) -> bool {
    token.contains(['*', '?', '['])
}

/// Expand `token` against the listing, resolving relative to `cwd`.
///
/// Returns the matching workspace paths *as the user would type them* (i.e.
/// relative to `cwd`, with the same leading `/` if the token was absolute),
/// sorted. When nothing matches — or `token` has no metacharacters — the
/// single original token is returned.
///
/// `entries` is the flat `(path, is_dir)` workspace listing (root-relative,
/// `/`-separated). `cwd` is the root-relative working directory (`""` = root).
pub fn glob_expand(cwd: &str, entries: &[(String, bool)], token: &str) -> Vec<String> {
    if !has_glob(token) {
        return vec![token.to_string()];
    }

    let absolute = token.starts_with('/');
    let pattern_body = token.trim_start_matches('/');
    let pattern_segments: Vec<&str> = pattern_body.split('/').filter(|s| !s.is_empty()).collect();
    if pattern_segments.is_empty() {
        return vec![token.to_string()];
    }

    // Base directory the pattern is resolved against, as a root-relative key.
    let base = if absolute {
        String::new()
    } else {
        cwd.to_string()
    };

    // Every directory and file the listing implies, so glob can walk into and
    // match directories that exist only implicitly (as ancestors of a file).
    let known = NodeSet::from_entries(entries);

    // Each candidate carries the root-relative key matched so far and the
    // matched-tail segments (what we'll render relative to `cwd`).
    let mut matched: Vec<(String, Vec<String>)> = vec![(base.clone(), Vec::new())];
    for segment in &pattern_segments {
        let mut next: Vec<(String, Vec<String>)> = Vec::new();
        for (dir_key, tail) in &matched {
            if has_glob(segment) {
                for name in known.children(dir_key) {
                    if segment_matches(segment, &name) {
                        let mut new_tail = tail.clone();
                        new_tail.push(name.clone());
                        next.push((join_key(dir_key, &name), new_tail));
                    }
                }
            } else {
                // A literal segment: descend only if the path exists.
                let child = join_key(dir_key, segment);
                if known.contains(&child) {
                    let mut new_tail = tail.clone();
                    new_tail.push((*segment).to_string());
                    next.push((child, new_tail));
                }
            }
        }
        matched = next;
        if matched.is_empty() {
            break;
        }
    }

    if matched.is_empty() {
        return vec![token.to_string()];
    }

    let mut rendered: BTreeSet<String> = matched
        .into_iter()
        .map(|(_, tail)| {
            let joined = tail.join("/");
            if absolute {
                format!("/{joined}")
            } else {
                joined
            }
        })
        .collect();
    // Defensive: never emit an empty expansion result.
    rendered.remove("");
    if rendered.is_empty() {
        return vec![token.to_string()];
    }
    rendered.into_iter().collect()
}

/// Match one path segment `name` against a single-segment glob `pattern`.
///
/// `*` matches any (possibly empty) run of characters, `?` matches exactly one
/// character, `[…]` matches one character from a set (with `a-z` ranges and a
/// leading `!` or `^` to negate). None of them ever match a `/` — but a single
/// segment never contains one, so that holds by construction. A leading dot in
/// `name` is matched normally (the workspace has no "hidden file" convention
/// beyond the migration marker, which the listing already hides).
pub fn segment_matches(pattern: &str, name: &str) -> bool {
    glob_match(
        &pattern.chars().collect::<Vec<_>>(),
        &name.chars().collect::<Vec<_>>(),
    )
}

/// Recursive backtracking matcher over char slices.
fn glob_match(pattern: &[char], name: &[char]) -> bool {
    match pattern.first() {
        None => name.is_empty(),
        Some('*') => {
            // `*` matches zero-or-more chars: try every split point.
            // Skipping consecutive `*`s keeps this from going quadratic on `***`.
            let mut rest = &pattern[1..];
            while rest.first() == Some(&'*') {
                rest = &rest[1..];
            }
            if glob_match(rest, name) {
                return true;
            }
            for i in 0..name.len() {
                if glob_match(rest, &name[i + 1..]) {
                    return true;
                }
            }
            false
        }
        Some('?') => !name.is_empty() && glob_match(&pattern[1..], &name[1..]),
        Some('[') => match (name.first(), match_class(&pattern[1..])) {
            (Some(&ch), Some((matches, consumed))) if matches(ch) => {
                glob_match(&pattern[1 + consumed..], &name[1..])
            }
            // An unterminated `[` is treated as a literal `[`.
            (Some(&ch), None) => ch == '[' && glob_match(&pattern[1..], &name[1..]),
            _ => false,
        },
        Some(&ch) => !name.is_empty() && name[0] == ch && glob_match(&pattern[1..], &name[1..]),
    }
}

/// Parse a `[...]` character class starting just after the `[`. Returns a
/// predicate over a candidate char and how many pattern chars were consumed
/// (including the closing `]`). `None` if the class is unterminated.
#[allow(clippy::type_complexity)]
fn match_class(pattern: &[char]) -> Option<(Box<dyn Fn(char) -> bool>, usize)> {
    let mut idx = 0;
    let negate = matches!(pattern.first(), Some('!') | Some('^'));
    if negate {
        idx += 1;
    }
    let mut members: Vec<char> = Vec::new();
    let mut ranges: Vec<(char, char)> = Vec::new();
    // A `]` as the very first class character is a literal `]` (POSIX).
    if pattern.get(idx) == Some(&']') {
        members.push(']');
        idx += 1;
    }
    let mut closed = false;
    while idx < pattern.len() {
        let ch = pattern[idx];
        if ch == ']' {
            closed = true;
            idx += 1;
            break;
        }
        // A range `a-z`: middle `-` with a char on each side.
        if pattern.get(idx + 1) == Some(&'-') && pattern.get(idx + 2).is_some_and(|c| *c != ']') {
            ranges.push((ch, pattern[idx + 2]));
            idx += 3;
        } else {
            members.push(ch);
            idx += 1;
        }
    }
    if !closed {
        return None;
    }
    let predicate = move |c: char| {
        let hit = members.contains(&c) || ranges.iter().any(|(lo, hi)| *lo <= c && c <= *hi);
        hit != negate
    };
    Some((Box::new(predicate), idx))
}

/// The set of paths the listing implies — every stored entry plus every
/// ancestor directory of a stored path — so glob can descend into directories
/// that exist only implicitly. Pure over the listing.
struct NodeSet {
    /// Every known root-relative path (files and directories, implicit or not).
    nodes: BTreeSet<String>,
}

impl NodeSet {
    fn from_entries(entries: &[(String, bool)]) -> Self {
        let mut nodes = BTreeSet::new();
        for (path, _is_dir) in entries {
            nodes.insert(path.clone());
            // Insert each ancestor directory implied by the path.
            let mut acc = String::new();
            for part in path.split('/').filter(|p| !p.is_empty()) {
                if !acc.is_empty() {
                    acc.push('/');
                }
                acc.push_str(part);
                nodes.insert(acc.clone());
            }
        }
        Self { nodes }
    }

    fn contains(&self, key: &str) -> bool {
        key.is_empty() || self.nodes.contains(key)
    }

    /// Direct child names of the directory key `dir` (`""` = root).
    fn children(&self, dir: &str) -> Vec<String> {
        let prefix = if dir.is_empty() {
            String::new()
        } else {
            format!("{dir}/")
        };
        let mut seen = BTreeSet::new();
        for node in &self.nodes {
            let Some(rest) = node.strip_prefix(&prefix) else {
                continue;
            };
            if rest.is_empty() {
                continue;
            }
            let head = rest.split('/').next().unwrap_or(rest);
            seen.insert(head.to_string());
        }
        seen.into_iter().collect()
    }
}

/// Join a directory key and a child name into a root-relative key.
fn join_key(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries() -> Vec<(String, bool)> {
        vec![
            ("src/lib/add.js".to_string(), false),
            ("src/lib/sub.js".to_string(), false),
            ("src/main.js".to_string(), false),
            ("src/util.py".to_string(), false),
            ("README.md".to_string(), false),
            ("notes.txt".to_string(), false),
            ("empty".to_string(), true),
        ]
    }

    #[test]
    fn has_glob_detects_metacharacters() {
        assert!(has_glob("*.js"));
        assert!(has_glob("a?b"));
        assert!(has_glob("[abc]"));
        assert!(!has_glob("plain.txt"));
        assert!(!has_glob("src/lib"));
    }

    #[test]
    fn segment_matches_star_question_and_classes() {
        assert!(segment_matches("*.js", "main.js"));
        assert!(segment_matches("*.js", ".js")); // `*` matches empty
        assert!(!segment_matches("*.js", "main.py"));
        assert!(segment_matches("a?c", "abc"));
        assert!(!segment_matches("a?c", "ac"));
        assert!(segment_matches("file[0-9]", "file3"));
        assert!(!segment_matches("file[0-9]", "fileX"));
        assert!(segment_matches("[!0-9]ame", "name"));
        assert!(!segment_matches("[!0-9]ame", "1ame"));
    }

    #[test]
    fn star_matches_within_a_single_segment() {
        // The matcher is only ever handed one segment (no `/`), so `*` spans
        // arbitrary in-segment text but is never asked to cross a separator.
        assert!(segment_matches("*", "anything"));
        assert!(segment_matches("a*z", "abcz"));
        assert!(!segment_matches("a*z", "abcq"));
        assert!(segment_matches("a**z", "az")); // collapsed stars
    }

    #[test]
    fn expands_a_star_in_the_cwd() {
        let mut got = glob_expand("src", &entries(), "*.js");
        got.sort();
        assert_eq!(got, vec!["main.js".to_string()]);
    }

    #[test]
    fn expands_a_star_across_a_directory_segment() {
        let mut got = glob_expand("", &entries(), "src/*.js");
        got.sort();
        assert_eq!(got, vec!["src/main.js".to_string()]);

        let mut got = glob_expand("", &entries(), "src/lib/*.js");
        got.sort();
        assert_eq!(
            got,
            vec!["src/lib/add.js".to_string(), "src/lib/sub.js".to_string()]
        );
    }

    #[test]
    fn glob_in_a_directory_segment_expands_directories() {
        let mut got = glob_expand("", &entries(), "*/main.js");
        got.sort();
        assert_eq!(got, vec!["src/main.js".to_string()]);
    }

    #[test]
    fn no_match_returns_the_literal_token() {
        assert_eq!(
            glob_expand("", &entries(), "*.zip"),
            vec!["*.zip".to_string()]
        );
        assert_eq!(
            glob_expand("", &entries(), "nope/*.js"),
            vec!["nope/*.js".to_string()]
        );
    }

    #[test]
    fn non_glob_token_is_returned_unchanged() {
        assert_eq!(
            glob_expand("src", &entries(), "main.js"),
            vec!["main.js".to_string()]
        );
    }

    #[test]
    fn absolute_glob_resolves_from_root_and_keeps_the_slash() {
        let mut got = glob_expand("src/lib", &entries(), "/src/*.py");
        got.sort();
        assert_eq!(got, vec!["/src/util.py".to_string()]);
    }

    #[test]
    fn char_class_expands_through_the_full_path() {
        let entries = vec![
            ("log1.txt".to_string(), false),
            ("log2.txt".to_string(), false),
            ("logX.txt".to_string(), false),
        ];
        // `[0-9]` matches only the digit-suffixed names, sorted.
        let mut got = glob_expand("", &entries, "log[0-9].txt");
        got.sort();
        assert_eq!(got, vec!["log1.txt".to_string(), "log2.txt".to_string()]);
        // Negated class `[!0-9]` matches the non-digit one.
        assert_eq!(
            glob_expand("", &entries, "log[!0-9].txt"),
            vec!["logX.txt".to_string()]
        );
    }

    #[test]
    fn unterminated_class_is_treated_literally() {
        // `[abc` never closes — the `[` becomes a literal, so it can only match
        // a name that literally starts with `[`. Nothing does, so it's literal.
        assert_eq!(
            glob_expand("", &entries(), "[abc"),
            vec!["[abc".to_string()]
        );
    }
}
