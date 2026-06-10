//! `file_edit` — exact-string replacement editing for the project's in-browser
//! virtual filesystem. Complements `file_write` (whole-file overwrite): the agent
//! edits a file the way a person does in the Workspace editor — change one spot,
//! keep the rest — without re-sending the whole document.
//!
//! The replacement core is a pure function ([`apply_replacement`]) so the
//! ambiguity rules are host-testable without IndexedDB.
//!
//! Known limitation: tool calls within one model turn run concurrently
//! (`engine::tool_dispatch`), so two same-turn edits to the SAME file are a
//! read-modify-write race where the later write wins silently. Serializing
//! VFS mutations is tracked as follow-up work.

use crate::state::{AppSnapshot, ToolSpec};
use crate::storage::vfs::ProjectVfs;
use serde_json::{Value, json};

use super::common::string_arg;
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "file_edit".to_string(),
        description: "Edit a file in the project's virtual filesystem by exact string \
            replacement. Provide path, old_string (must match the file content exactly, \
            including whitespace), and new_string (may be \"\" to delete old_string). \
            By default old_string must match exactly once; pass replace_all=true to \
            replace every occurrence. Fails if the file does not exist (use file_write \
            to create files) or if old_string is not found or is ambiguous."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "old_string": { "type": "string", "description": "Exact text to replace." },
                "new_string": { "type": "string", "description": "Replacement text." },
                "replace_all": { "type": "boolean", "description": "Replace every occurrence (default false)." }
            },
            "required": ["path", "old_string", "new_string"]
        }),
    }
}

/// Apply an exact-string replacement, enforcing the same rules an interactive
/// editor would: the needle must exist, and without `replace_all` it must be
/// unique so the edit cannot land somewhere unintended. Returns the new content
/// and how many replacements were made.
fn apply_replacement(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<(String, usize), String> {
    if old_string.is_empty() {
        return Err("old_string must not be empty.".to_string());
    }
    if old_string == new_string {
        return Err("old_string and new_string are identical — nothing to change.".to_string());
    }
    let occurrences = content.matches(old_string).count();
    if occurrences == 0 {
        return Err(
            "old_string was not found in the file. It must match the current content exactly, \
             including whitespace and indentation."
                .to_string(),
        );
    }
    if occurrences > 1 && !replace_all {
        return Err(format!(
            "old_string matches {occurrences} times. Provide a longer, unique old_string, \
             or pass replace_all=true to replace every occurrence."
        ));
    }
    if replace_all {
        Ok((content.replace(old_string, new_string), occurrences))
    } else {
        Ok((content.replacen(old_string, new_string, 1), 1))
    }
}

/// Extract a replacement-text argument VERBATIM: present and string-typed, but
/// never trimmed and allowed to be empty — whitespace is significant in exact
/// string replacement, and an empty `new_string` means deletion. (`string_arg`
/// trims and rejects empty values, which would break both.)
fn exact_string_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Missing required string argument `{key}`"))
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let old_string = exact_string_arg(args, "old_string")?;
        let new_string = exact_string_arg(args, "new_string")?;
        let replace_all = args
            .get("replace_all")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let vfs = ProjectVfs::new();
        let content = vfs
            .read_file(&path)
            .await
            .map_err(|err| format!("VFS read error: {err}"))?
            .ok_or_else(|| format!("No file at `{path}`. Use file_write to create a new file."))?;

        let (edited, replacements) =
            apply_replacement(&content, &old_string, &new_string, replace_all)?;
        vfs.write_file(&path, &edited)
            .await
            .map_err(|err| format!("VFS write error: {err}"))?;
        Ok(format!(
            "Edited {path}: {replacements} replacement(s) applied."
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_a_unique_match_once() {
        let (out, n) = apply_replacement("let a = 1;\nlet b = 2;", "b = 2", "b = 3", false)
            .expect("unique replacement");
        assert_eq!(out, "let a = 1;\nlet b = 3;");
        assert_eq!(n, 1);
    }

    #[test]
    fn rejects_missing_old_string() {
        let err = apply_replacement("hello", "absent", "x", false).expect_err("missing");
        assert!(err.contains("not found"), "unexpected: {err}");
    }

    #[test]
    fn rejects_ambiguous_match_without_replace_all() {
        let err = apply_replacement("x x x", "x", "y", false).expect_err("ambiguous");
        assert!(err.contains("matches 3 times"), "unexpected: {err}");
    }

    #[test]
    fn replace_all_replaces_every_occurrence() {
        let (out, n) = apply_replacement("x x x", "x", "y", true).expect("replace all");
        assert_eq!(out, "y y y");
        assert_eq!(n, 3);
    }

    #[test]
    fn rejects_empty_and_identity_edits() {
        assert!(apply_replacement("abc", "", "x", false).is_err());
        assert!(apply_replacement("abc", "abc", "abc", false).is_err());
    }

    #[test]
    fn first_occurrence_only_without_replace_all_when_unique() {
        // replacen(…, 1) semantics: only the single (unique) match changes even if
        // new_string itself contains old_string.
        let (out, n) = apply_replacement("alpha", "alpha", "alpha beta", false).expect("edit");
        assert_eq!(out, "alpha beta");
        assert_eq!(n, 1);
    }

    #[test]
    fn exact_args_preserve_whitespace_and_allow_empty_new_string() {
        // Whitespace is significant for exact replacement: arguments must reach
        // apply_replacement verbatim, and "" is a valid new_string (deletion).
        let args = serde_json::json!({ "old_string": "    indented\n", "new_string": "" });
        assert_eq!(
            exact_string_arg(&args, "old_string").expect("old"),
            "    indented\n"
        );
        assert_eq!(exact_string_arg(&args, "new_string").expect("new"), "");
        assert!(exact_string_arg(&args, "absent").is_err());
    }

    #[test]
    fn empty_new_string_deletes_the_match() {
        let (out, n) = apply_replacement("keep DELETE keep", " DELETE", "", false).expect("delete");
        assert_eq!(out, "keep keep");
        assert_eq!(n, 1);
    }

    #[test]
    fn indentation_only_edits_survive() {
        let (out, n) = apply_replacement(
            "fn x() {\n    body\n}",
            "\n    body",
            "\n        body",
            false,
        )
        .expect("indent edit");
        assert_eq!(out, "fn x() {\n        body\n}");
        assert_eq!(n, 1);
    }
}
