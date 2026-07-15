//! `phase.N.*` frontmatter → `askk_core::Phase`. Flat keys accumulate into a
//! per-number draft, then `build_phases` enforces contiguity, the
//! loop/max_turns rules, and the workflow-path step (ADR-042). Split from
//! `agent` to keep each file under the size cap; the parse rules live beside
//! the phase type they build.

use std::collections::BTreeMap;

use askk_core::{LoopMode, Phase, PhaseStep};

use crate::config::agent::{parse_bool, DEFAULT_LOOP_MAX_TURNS};
use crate::config::frontmatter::{self, Entry};

/// Accumulates `phase.N.*` keys until all lines are seen.
#[derive(Default)]
pub(crate) struct PhaseDraft {
    line: usize,
    name: Option<String>,
    contract: Option<String>,
    tools: Option<Vec<String>>,
    skills: Option<Vec<String>>,
    loop_mode: Option<LoopMode>,
    max_turns: Option<u32>,
    gate: Option<bool>,
    on_fail: Option<String>,
    header: Option<String>,
    fan_out: Option<String>,
    parts: Option<String>,
    /// `phase.N.tool` — makes this a scripted workflow-path step (ADR-042).
    step_tool: Option<String>,
    /// `phase.N.args` — JSON args for the scripted tool (`{goal}` templated).
    step_args: Option<serde_json::Value>,
}

pub(crate) fn phase_entry(
    entry: &Entry,
    at: &str,
    drafts: &mut BTreeMap<usize, PhaseDraft>,
    problems: &mut Vec<String>,
) {
    let rest = &entry.key["phase.".len()..];
    let Some((number, field)) = rest.split_once('.') else {
        problems.push(format!(
            "{at}: phase keys are `phase.<n>.<field>`, got '{}'",
            entry.key
        ));
        return;
    };
    let n = match number.parse::<usize>() {
        Ok(n) if n >= 1 => n,
        _ => {
            problems.push(format!(
                "{at}: phase number must be an integer >= 1, got '{number}'"
            ));
            return;
        }
    };
    let draft = drafts.entry(n).or_default();
    if draft.line == 0 {
        draft.line = entry.line;
    }
    let value = entry.value.clone();
    match field {
        "name" => draft.name = Some(value),
        "contract" => draft.contract = Some(value),
        "tools" => draft.tools = Some(frontmatter::split_list(&value)),
        "skills" => draft.skills = Some(frontmatter::split_list(&value)),
        "loop" => match value.as_str() {
            "one_shot" => draft.loop_mode = Some(LoopMode::OneShot),
            "loop" => {
                draft.loop_mode = Some(LoopMode::Loop {
                    max_turns: DEFAULT_LOOP_MAX_TURNS,
                })
            }
            other => problems.push(format!("{at}: `loop` must be one_shot|loop, got '{other}'")),
        },
        "max_turns" => match value.parse::<u32>() {
            Ok(n) if n >= 1 => draft.max_turns = Some(n),
            _ => problems.push(format!(
                "{at}: `max_turns` must be a positive integer, got '{value}'"
            )),
        },
        "gate" => match parse_bool(&value) {
            Some(b) => draft.gate = Some(b),
            None => problems.push(format!("{at}: `gate` must be true|false, got '{value}'")),
        },
        "on_fail" => draft.on_fail = Some(value),
        "header" => draft.header = Some(value),
        "fan_out" => draft.fan_out = Some(value),
        "parts" => draft.parts = Some(value),
        // Workflow-path step (ADR-042): the tool name is a bare string; the
        // args are inline JSON parsed here so a bad object fails loud with the
        // rest of the file's problems (ADR-007), not at run time.
        "tool" => draft.step_tool = Some(value),
        "args" => match serde_json::from_str::<serde_json::Value>(&value) {
            Ok(v) if v.is_object() => draft.step_args = Some(v),
            Ok(_) => problems.push(format!("{at}: `args` must be a JSON object, got '{value}'")),
            Err(e) => problems.push(format!("{at}: `args` is not valid JSON ({e}): '{value}'")),
        },
        other => problems.push(format!("{at}: unknown phase field '{other}'")),
    }
}

pub(crate) fn build_phases(
    path_label: &str,
    drafts: BTreeMap<usize, PhaseDraft>,
    problems: &mut Vec<String>,
) -> Vec<Phase> {
    let mut phases = Vec::new();
    for (position, (n, draft)) in drafts.into_iter().enumerate() {
        if n != position + 1 {
            problems.push(format!(
                "{path_label}: phase numbers must be contiguous from 1; missing phase.{}",
                position + 1
            ));
        }
        let name = draft.name.unwrap_or_else(|| {
            problems.push(format!(
                "{path_label}:{}: phase.{n} is missing `phase.{n}.name`",
                draft.line
            ));
            String::new()
        });
        // `max_turns` overrides the loop default (16); alone it implies
        // `loop: loop`; with an explicit one_shot it is a contradiction.
        let loop_mode = match (draft.loop_mode, draft.max_turns) {
            (Some(LoopMode::OneShot), Some(_)) => {
                problems.push(format!(
                    "{path_label}:{}: phase.{n} `max_turns` requires `loop: loop`",
                    draft.line
                ));
                LoopMode::OneShot
            }
            (_, Some(max_turns)) => LoopMode::Loop { max_turns },
            (mode, None) => mode.unwrap_or(LoopMode::OneShot),
        };
        // Workflow-path step (ADR-042): `phase.N.tool` (+ optional
        // `phase.N.args`) makes this a deterministic, no-LLM step. Absent =
        // the default `Llm` turn. `args` defaults to `{}` when only a tool is
        // named. A scripted step with `gate: true` is a contradiction (a gate
        // needs a model verdict) — flagged here, joining the file's error.
        let step = match draft.step_tool {
            Some(tool) => {
                if draft.gate == Some(true) {
                    problems.push(format!(
                        "{path_label}:{}: phase.{n} cannot be both a scripted `tool` step \
                         and a `gate` (a gate needs an LLM verdict)",
                        draft.line
                    ));
                }
                PhaseStep::Tool {
                    tool,
                    args: draft.step_args.unwrap_or_else(|| serde_json::json!({})),
                }
            }
            None => PhaseStep::Llm,
        };
        phases.push(Phase {
            name,
            step,
            contract: draft.contract.unwrap_or_else(|| "react".into()),
            tool_filter: draft.tools,
            skill_filter: draft.skills,
            loop_mode,
            gate: draft.gate.unwrap_or(false),
            on_fail: draft.on_fail,
            header: draft.header.unwrap_or_default(),
            fan_out: draft.fan_out,
            parts: draft.parts,
        });
    }
    phases
}
