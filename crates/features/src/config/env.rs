//! `env:` frontmatter presets — named tool bundles expanded into the agent's
//! `tools` list at LOAD time (before `validate`, so the expanded names are
//! reference-checked like hand-written ones). Nothing is stored on
//! `AgentConfig`; env only feeds the tools list. Presets:
//! - `vm`: shell, write_file, read_file, list_files, edit_file
//! - `web`: web_search, fetch_url, knowledge_search, knowledge_read,
//!   knowledge_write, knowledge_list, artifact_publish
//! - `core`: calc, now, js_eval
//! - `board`: board_add, board_list, board_move, board_check

fn preset(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "vm" => Some(&[
            "shell",
            "write_file",
            "read_file",
            "list_files",
            "edit_file",
        ]),
        "web" => Some(&[
            "web_search",
            "fetch_url",
            "knowledge_search",
            "knowledge_read",
            "knowledge_write",
            "knowledge_list",
            "artifact_publish",
        ]),
        "core" => Some(&["calc", "now", "js_eval"]),
        "board" => Some(&["board_add", "board_list", "board_move", "board_check"]),
        _ => None,
    }
}

/// Union of the named presets' tools (in declaration order) followed by the
/// explicit `tools:` extras, deduplicated. Unknown preset names land in
/// `problems` (ADR-007: one error listing all).
pub(crate) fn expand(
    env_names: &[String],
    explicit: Vec<String>,
    at: &str,
    problems: &mut Vec<String>,
) -> Vec<String> {
    fn push_unique(tools: &mut Vec<String>, tool: String) {
        if !tools.contains(&tool) {
            tools.push(tool);
        }
    }
    let mut tools: Vec<String> = Vec::new();
    for name in env_names {
        match preset(name) {
            Some(bundle) => {
                for tool in bundle {
                    push_unique(&mut tools, (*tool).to_string());
                }
            }
            None => problems.push(format!(
                "{at}: unknown env preset '{name}' (known: vm, web, core, board)"
            )),
        }
    }
    for tool in explicit {
        push_unique(&mut tools, tool);
    }
    tools
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strs(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn env_expands_presets_in_order() {
        let mut problems = Vec::new();
        let tools = expand(
            &strs(&["core", "board"]),
            Vec::new(),
            "a.md:2",
            &mut problems,
        );
        assert!(problems.is_empty());
        assert_eq!(
            tools,
            strs(&[
                "calc",
                "now",
                "js_eval",
                "board_add",
                "board_list",
                "board_move",
                "board_check"
            ])
        );
    }

    #[test]
    fn env_unions_with_explicit_tools_and_dedups() {
        let mut problems = Vec::new();
        // `shell` is already in `vm`; `fetch_url` is a genuine extra.
        let tools = expand(
            &strs(&["vm"]),
            strs(&["fetch_url", "shell"]),
            "a.md:2",
            &mut problems,
        );
        assert!(problems.is_empty());
        assert_eq!(
            tools,
            strs(&[
                "shell",
                "write_file",
                "read_file",
                "list_files",
                "edit_file",
                "fetch_url"
            ])
        );
    }

    #[test]
    fn unknown_preset_is_a_problem() {
        let mut problems = Vec::new();
        let tools = expand(
            &strs(&["vm", "matrix"]),
            Vec::new(),
            "a.md:2",
            &mut problems,
        );
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("a.md:2: unknown env preset 'matrix'"));
        assert_eq!(tools.len(), 5); // vm still expanded
    }

    #[test]
    fn expansion_matches_handwritten_equivalent() {
        let mut problems = Vec::new();
        let expanded = expand(&strs(&["web"]), Vec::new(), "a.md:2", &mut problems);
        let handwritten = strs(&[
            "web_search",
            "fetch_url",
            "knowledge_search",
            "knowledge_read",
            "knowledge_write",
            "knowledge_list",
            "artifact_publish",
        ]);
        assert!(problems.is_empty());
        assert_eq!(expanded, handwritten);
    }
}
