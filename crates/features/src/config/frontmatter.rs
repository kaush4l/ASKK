//! Hand-rolled frontmatter parser: a `---` fenced `key: value` block followed
//! by a markdown body. No deps; errors carry line numbers. Trailing
//! `# comments` after values are stripped (docs/MODELS.md writes them).

use crate::config::ConfigError;

/// One `key: value` line from the fenced block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub key: String,
    pub value: String,
    /// 1-based line number in the source file.
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Frontmatter {
    /// In file order; duplicate keys are rejected at parse.
    pub entries: Vec<Entry>,
    /// Everything after the closing fence.
    pub body: String,
}

impl Frontmatter {
    pub fn value(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|e| e.key == key)
            .map(|e| e.value.as_str())
    }
}

/// Comma-separated list value → trimmed, non-empty items.
pub fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// Strip a trailing comment: a `#` at value start or preceded by whitespace.
/// A `#` glued to text (`ver#3`) is kept as data.
fn strip_comment(value: &str) -> &str {
    match value.find('#') {
        Some(i) if i == 0 || value[..i].ends_with(char::is_whitespace) => &value[..i],
        _ => value,
    }
}

pub fn parse(path_label: &str, text: &str) -> Result<Frontmatter, ConfigError> {
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    while i < lines.len() && lines[i].trim().is_empty() {
        i += 1;
    }
    if i >= lines.len() || lines[i].trim() != "---" {
        return Err(ConfigError::one(format!(
            "{path_label}:{}: missing opening `---` frontmatter fence",
            i + 1
        )));
    }
    i += 1;

    let mut entries: Vec<Entry> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    let mut closed = false;
    while i < lines.len() {
        let n = i + 1;
        let trimmed = lines[i].trim();
        i += 1;
        if trimmed == "---" {
            closed = true;
            break;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            problems.push(format!(
                "{path_label}:{n}: expected `key: value`, got '{trimmed}'"
            ));
            continue;
        };
        let key = key.trim();
        let value = strip_comment(value).trim();
        if key.is_empty() {
            problems.push(format!("{path_label}:{n}: empty key"));
            continue;
        }
        if let Some(first) = entries.iter().find(|e| e.key == key) {
            problems.push(format!(
                "{path_label}:{n}: duplicate key '{key}' (first at line {})",
                first.line
            ));
            continue;
        }
        entries.push(Entry {
            key: key.into(),
            value: value.into(),
            line: n,
        });
    }
    if !closed {
        problems.push(format!(
            "{path_label}: unclosed frontmatter fence (no closing `---`)"
        ));
    }
    if !problems.is_empty() {
        return Err(ConfigError::new(problems));
    }
    Ok(Frontmatter {
        entries,
        body: lines[i..].join("\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_parses_keys_comments_and_body() {
        let text = "---\nid: coder   # a comment\n\nname: Coder\n---\nbody line\nsecond";
        let fm = parse("a.md", text).unwrap();
        assert_eq!(fm.value("id"), Some("coder"));
        assert_eq!(fm.value("name"), Some("Coder"));
        assert_eq!(fm.entries[0].line, 2);
        assert_eq!(fm.body, "body line\nsecond");
    }

    #[test]
    fn missing_fence_is_an_error() {
        let err = parse("a.md", "id: coder\n").unwrap_err();
        assert!(err.problems[0].contains("missing opening"));
        assert!(err.problems[0].contains("a.md:1"));
    }

    #[test]
    fn malformed_line_reports_its_line_number() {
        let err = parse("a.md", "---\nid coder\n---\n").unwrap_err();
        assert_eq!(err.problems.len(), 1);
        assert!(err.problems[0].contains("a.md:2"));
        assert!(err.problems[0].contains("key: value"));
    }

    #[test]
    fn duplicate_keys_are_an_error() {
        let err = parse("a.md", "---\nid: a\nid: b\n---\n").unwrap_err();
        assert!(err.problems[0].contains("duplicate key 'id'"));
        assert!(err.problems[0].contains("first at line 2"));
    }

    #[test]
    fn unclosed_fence_is_an_error() {
        let err = parse("a.md", "---\nid: a\n").unwrap_err();
        assert!(err.problems[0].contains("unclosed"));
    }

    #[test]
    fn all_problems_reported_in_one_error() {
        let err = parse("a.md", "---\nbroken\nid: a\nid: b\n").unwrap_err();
        assert_eq!(err.problems.len(), 3); // malformed + duplicate + unclosed
    }

    #[test]
    fn inline_hash_without_space_is_data() {
        let fm = parse("a.md", "---\ntag: v1#3\n---\n").unwrap();
        assert_eq!(fm.value("tag"), Some("v1#3"));
    }

    #[test]
    fn split_list_trims_and_drops_empties() {
        assert_eq!(split_list("a, b ,c,,"), vec!["a", "b", "c"]);
        assert!(split_list("  ").is_empty());
    }
}
