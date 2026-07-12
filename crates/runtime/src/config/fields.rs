//! `field.N.*` frontmatter → the agent's custom contract fields. Mirrors the
//! `phase.N.*` draft pattern in agent.rs; split out to hold the ADR-012 cap.

use std::collections::BTreeMap;

use askk_core::{FieldKind, FieldSpec};

use crate::config::frontmatter::Entry;

/// Accumulates `field.N.*` keys until all lines are seen.
#[derive(Default)]
pub(crate) struct FieldDraft {
    line: usize,
    name: Option<String>,
    kind: Option<FieldKind>,
    required: Option<bool>,
    desc: Option<String>,
}

pub(crate) fn field_entry(
    entry: &Entry,
    at: &str,
    drafts: &mut BTreeMap<usize, FieldDraft>,
    problems: &mut Vec<String>,
) {
    let rest = &entry.key["field.".len()..];
    let Some((number, key)) = rest.split_once('.') else {
        problems.push(format!(
            "{at}: field keys are `field.<n>.<key>`, got '{}'",
            entry.key
        ));
        return;
    };
    let n = match number.parse::<usize>() {
        Ok(n) if n >= 1 => n,
        _ => {
            problems.push(format!(
                "{at}: field number must be an integer >= 1, got '{number}'"
            ));
            return;
        }
    };
    let draft = drafts.entry(n).or_default();
    if draft.line == 0 {
        draft.line = entry.line;
    }
    let value = entry.value.clone();
    match key {
        "name" => draft.name = Some(value),
        "kind" => match parse_kind(&value) {
            Some(kind) => draft.kind = Some(kind),
            None => problems.push(format!(
                "{at}: `kind` must be text|list|enum: a|b|c, got '{value}'"
            )),
        },
        "required" => match value.as_str() {
            "true" => draft.required = Some(true),
            "false" => draft.required = Some(false),
            other => problems.push(format!(
                "{at}: `required` must be true|false, got '{other}'"
            )),
        },
        "desc" => draft.desc = Some(value),
        other => problems.push(format!("{at}: unknown field key '{other}'")),
    }
}

fn parse_kind(value: &str) -> Option<FieldKind> {
    match value {
        "text" => Some(FieldKind::Str),
        "list" => Some(FieldKind::List),
        _ => {
            let variants: Vec<String> = value
                .strip_prefix("enum:")?
                .split('|')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();
            (!variants.is_empty()).then_some(FieldKind::Enum(variants))
        }
    }
}

/// Contiguity + per-field defaults (kind: text, required: true, desc: "") —
/// the same rules `build_phases` applies to phase drafts.
pub(crate) fn build_fields(
    path_label: &str,
    drafts: BTreeMap<usize, FieldDraft>,
    problems: &mut Vec<String>,
) -> Vec<FieldSpec> {
    let mut fields = Vec::new();
    for (position, (n, draft)) in drafts.into_iter().enumerate() {
        if n != position + 1 {
            problems.push(format!(
                "{path_label}: field numbers must be contiguous from 1; missing field.{}",
                position + 1
            ));
        }
        let name = draft.name.unwrap_or_else(|| {
            problems.push(format!(
                "{path_label}:{}: field.{n} is missing `field.{n}.name`",
                draft.line
            ));
            String::new()
        });
        fields.push(FieldSpec {
            name,
            kind: draft.kind.unwrap_or(FieldKind::Str),
            required: draft.required.unwrap_or(true),
            description: draft.desc.unwrap_or_default(),
        });
    }
    fields
}

#[cfg(test)]
mod tests {
    use askk_core::FieldKind;

    use crate::config::AgentConfig;

    #[test]
    fn field_keys_build_the_custom_contract() {
        let text = "---\nid: mine\nfield.1.name: observation\nfield.1.kind: list\n\
                    field.1.required: false\nfield.2.name: action\n\
                    field.2.kind: enum: tool|answer\nfield.3.name: answer\n\
                    field.3.desc: final text\n---\n";
        let cfg = AgentConfig::from_markdown("a.md", text).unwrap();
        let contract = cfg.custom_contract.unwrap();
        assert_eq!(contract.name, "mine"); // named by the agent id
        assert_eq!(contract.version, 0);
        assert_eq!(contract.fields.len(), 3);
        assert_eq!(contract.fields[0].kind, FieldKind::List);
        assert!(!contract.fields[0].required);
        assert_eq!(
            contract.fields[1].kind,
            FieldKind::Enum(vec!["tool".into(), "answer".into()])
        );
        // Defaults: kind text, required true, desc "".
        assert_eq!(contract.fields[2].kind, FieldKind::Str);
        assert!(contract.fields[2].required);
        assert_eq!(contract.fields[2].description, "final text");
    }

    #[test]
    fn no_field_keys_means_no_custom_contract() {
        let cfg = AgentConfig::from_markdown("a.md", "---\nid: plain\n---\n").unwrap();
        assert!(cfg.custom_contract.is_none());
    }

    #[test]
    fn malformed_field_keys_are_errors() {
        let text = "---\nid: a\nfield.x.name: p\nfield.1.speed: fast\n\
                    field.1.kind: blob\nfield.1.required: yep\nfield.one: p\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("field number must be an integer"));
        assert!(joined.contains("unknown field key 'speed'"));
        assert!(joined.contains("`kind` must be text|list|enum"));
        assert!(joined.contains("`required` must be true|false"));
        assert!(joined.contains("field.<n>.<key>"));
    }

    #[test]
    fn field_gaps_and_missing_names_are_errors() {
        let text = "---\nid: a\nfield.1.name: x\nfield.3.kind: list\n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        let joined = err.problems.join("\n");
        assert!(joined.contains("missing field.2"));
        assert!(joined.contains("missing `field.3.name`"));
    }

    #[test]
    fn empty_enum_variants_are_an_error() {
        let text = "---\nid: a\nfield.1.name: x\nfield.1.kind: enum:  \n---\n";
        let err = AgentConfig::from_markdown("a.md", text).unwrap_err();
        assert!(err.problems[0].contains("`kind` must be text|list|enum"));
    }
}
