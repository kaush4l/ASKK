//! A sub-agent as an ordinary tool: which tools an agent gets, and how the
//! goal is read out of the call the model wrote. Both rules are the Python's
//! (`core/utils.py::load_agent`, `core/tools.py::Tool.from_engine`), and both
//! were found there BY TEST rather than by reading — so both are pinned here.

use kernel::{EventKind, ToolId};

use crate::calls::Call;
use crate::effect::Effect;
use crate::spec::AgentSpec;
use crate::toolbox::Toolbox;
use crate::tools::{builtin_tools, Tool};


/// What one agent may call, from its own `agent.md` and its peers.
///
/// The Python rule, exactly: an EMPTY `tools:` list means "everything this
/// agent could have locally" — every built-in — while a non-empty list is a
/// filter naming built-ins and sub-agents in one breath, because the model is
/// never told which is which. Sub-agents are ONLY attached when named: the
/// summarizer is nobody's tool by default (it is what compacts a history), and
/// nothing is attached that an agent did not ask for.
pub fn toolbox_for(spec: &AgentSpec, peers: &[AgentSpec]) -> Toolbox {
    let builtins = builtin_tools().tools;
    if spec.tools.is_empty() {
        return Toolbox::of(builtins);
    }
    let mut tools: Vec<Tool> = Vec::new();
    for name in &spec.tools {
        if let Some(t) = builtins.iter().find(|t| &t.name == name) {
            tools.push(t.clone());
        } else if let Some(p) = peers.iter().find(|p| &p.name == name && p.name != spec.name) {
            tools.push(Tool::from_engine(&p.name, &p.description));
        }
    }
    Toolbox::of(tools)
}

/// The goal a sub-agent was given, out of the JSON the model wrote.
///
/// `query` first; failing that, whatever single string the caller DID write —
/// a model that says `{"task": ...}` meant the same thing, and dropping it
/// would start the sub-agent on nothing. Nothing usable is an ERROR, never an
/// empty run: a sub-agent cannot tell an empty goal from a hard one and will
/// answer either way, which is the bug the Python found by test.
pub fn goal_from(agent: &str, args_json: &str) -> Result<String, String> {
    let refusal = || {
        format!(
            "no goal given. Call it as {agent}({{\"query\": \
             \"<the whole task, in one string>\"}})"
        )
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(args_json) else {
        return Err(refusal());
    };
    let Some(object) = value.as_object() else {
        return Err(refusal());
    };
    let text = |v: Option<&serde_json::Value>| -> String {
        v.and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    let goal = match text(object.get("query")) {
        found if !found.is_empty() => found,
        _ => object
            .values()
            .map(|v| text(Some(v)))
            .find(|t| !t.is_empty())
            .unwrap_or_default(),
    };
    match goal.is_empty() {
        true => Err(refusal()),
        false => Ok(goal),
    }
}

/// Run the call, or refuse it in the words that let the model rewrite it. A
/// refusal is a recorded tool result, not a dropped call: a call whose
/// arguments could not be read must never be delivered as a call with none.
/// A sub-agent is checked TWICE: once as any tool, and again for a goal it can
/// actually work from — a sub-agent handed an empty goal answers it regardless,
/// which is the failure the whole refusal machinery exists to prevent.
pub(crate) fn invoke_or_refuse(tools: &Toolbox, call: Call, batch: u16) -> Effect {
    let refuse = |tool: String, args: String, error: String| Effect::Emit {
        kind: EventKind::ToolInvoked {
            tool: ToolId(tool),
            args,
            ok: false,
            output: error,
        },
    };
    let tool = match tools.check(&call) {
        Ok(tool) => tool,
        Err(refusal) => return refuse(refusal.tool, call.args_json, refusal.error),
    };
    if !tool.agent {
        return Effect::InvokeTool {
            tool: ToolId(tool.name.clone()),
            args_json: call.args_json,
        };
    }
    match goal_from(&tool.name, &call.args_json) {
        Ok(goal) => Effect::Delegate {
            agent: tool.name.clone(),
            goal,
            batch,
        },
        Err(problem) => refuse(tool.name.clone(), call.args_json, problem),
    }
}
