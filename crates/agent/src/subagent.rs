//! A sub-agent as an ordinary tool: which tools an agent gets, and how the
//! goal is read out of the call the model wrote. Both rules are the Python's
//! (`core/utils.py::load_agent`, `core/tools.py::Tool.from_engine`), and both
//! were found there BY TEST rather than by reading — so both are pinned here.

use kernel::{EventKind, ToolId};

use crate::calls::Call;
use crate::effect::Effect;
use crate::spec::AgentSpec;
use crate::toolbox::Toolbox;
use crate::tools::{builtin_tools, Tool, SPAWN_AGENT};

/// What one agent may call, from its own `agent.md` and its peers.
///
/// The Python rule, exactly: an EMPTY `tools:` list means "everything this
/// agent could have locally" — every built-in — while a non-empty list is a
/// filter naming built-ins and sub-agents in one breath, because the model is
/// never told which is which. Sub-agents are ONLY attached when named: the
/// summarizer is nobody's tool by default (it is what compacts a history), and
/// nothing is attached that an agent did not ask for.
pub fn toolbox_for(spec: &AgentSpec, peers: &[AgentSpec]) -> Toolbox {
    Toolbox::of(resolve(spec, peers).0)
}

/// THE NAMES IN `tools:` THAT RESOLVE TO NOTHING (R18-P1-7). `tools:
/// [nope_tool]` saved clean and the agent's card then reported `No tools` as a
/// fact, with no word about the line that had been dropped.
///
/// It is NOT a save-time refusal, and the reason is ordering: a name in
/// `tools:` may be a peer AGENT that is not written yet, so refusing here would
/// make "write the caller, then write the sub-agent" impossible while making
/// "write them in the other order" fine — a rule about typing order, enforced
/// as if it were about capability. And the direction matters: `spec.rs` refuses
/// a malformed `tools:` line because dropping it grants EVERY built-in, while
/// dropping one name grants less than the file asked for. So it is reported,
/// loudly, everywhere the toolbox is described — and the file still saves.
pub fn unresolved_tools(spec: &AgentSpec, peers: &[AgentSpec]) -> Vec<String> {
    resolve(spec, peers).1
}

/// The allowlist applied: what it resolved to, and what it did not.
///
/// `engine: base` IS THE EMPTY TOOLBOX (increment 19). The card has said
/// "answers in one reply, without calling tools" since R2-16 and nothing
/// enforced it: the summarizer's `tools: []` read as EVERY built-in, so the one
/// shipped `base` agent was the most capable one in the tree. `spec.rs` refuses
/// `base` with a non-empty list, so nothing is silently dropped here.
///
/// An EMPTY list keeps its meaning — "everything this agent could have locally"
/// — and the space's tools ARE local capability, so they come with it. That
/// stays safe because `spec.rs` refuses a malformed `tools:` line rather than
/// emptying it: an empty list is a choice somebody wrote, never a line that
/// failed to parse.
fn resolve(spec: &AgentSpec, peers: &[AgentSpec]) -> (Vec<Tool>, Vec<String>) {
    if spec.engine == crate::spec::ENGINE_BASE {
        return (Vec::new(), Vec::new());
    }
    // …AND WHAT THE FILE'S FACULTIES BRING WITH THEM (`faculty::tools_for`),
    // which is where naming a space stopped being a special case.
    let offered = [builtin_tools().tools, crate::faculty::tools_for(spec)].concat();
    match spec.tools.is_empty() {
        true => (offered, Vec::new()),
        false => allowlisted(spec, peers, &offered),
    }
}

/// A NON-EMPTY `tools:` list is the WHOLE allowlist, so `offered` is what makes
/// a tool available to name and not a set appended after the filter. Appended,
/// a read-only agent that can still see the filesystem would be
/// unrepresentable: `tools: [read_file, list_files]` would silently also grant
/// `exec` and `write_file`. The allowlist IS the mode (ALIGNMENT §1).
///
/// A name that is neither an offered tool nor a peer agent resolves to nothing
/// and is returned as such; see [`unresolved_tools`] for why it is reported
/// rather than refused.
fn allowlisted(
    spec: &AgentSpec,
    peers: &[AgentSpec],
    offered: &[Tool],
) -> (Vec<Tool>, Vec<String>) {
    let (mut tools, mut unresolved): (Vec<Tool>, Vec<String>) = (Vec::new(), Vec::new());
    for name in &spec.tools {
        if let Some(t) = offered.iter().find(|t| &t.name == name) {
            tools.push(t.clone());
        } else if let Some(p) = peers.iter().find(|p| &p.name == name && p.name != spec.name) {
            tools.push(Tool::from_engine(&p.name, &p.description));
        } else {
            unresolved.push(name.clone());
        }
    }
    (tools, unresolved)
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
    // A SKILL IS ANSWERED HERE, NOT RUN ANYWHERE (skills.rs): the result is a
    // pure function of compiled-in text, and it is emitted as the same
    // `ToolInvoked` fact every other call produces, so the trace shows the load.
    if let Some(effect) = crate::skills::effect(&tool.name, &call.args_json) {
        return effect;
    }
    // `spawn_agent` delegates too, so it cannot be told apart by `tool.agent`:
    // it is a BUILT-IN, and the agent it starts is whatever the model wrote.
    if !tool.agent && tool.name != SPAWN_AGENT {
        return Effect::InvokeTool {
            tool: ToolId(tool.name.clone()),
            args_json: call.args_json,
        };
    }
    match delegated(&tool, &call.args_json) {
        Ok((agent, goal)) => Effect::Delegate { agent, goal, batch },
        Err(problem) => refuse(tool.name.clone(), call.args_json, problem),
    }
}

/// THE AGENT AND THE GOAL OUT OF THE JSON THE MODEL WROTE, for both ways of
/// asking. A SUB-AGENT tool IS its callee and carries only a goal, which is
/// [`goal_from`]; `spawn_agent` names its callee in an argument, because the
/// agent it starts is whichever one the model chose. Either way an unreadable
/// call is REFUSED and never delivered with an empty goal — a sub-agent handed
/// one answers it regardless, which is what this exists to prevent.
fn delegated(tool: &Tool, args_json: &str) -> Result<(String, String), String> {
    if tool.name != SPAWN_AGENT {
        return goal_from(&tool.name, args_json).map(|goal| (tool.name.clone(), goal));
    }
    let value = serde_json::from_str::<serde_json::Value>(args_json).unwrap_or_default();
    let field = |k: &str| value.get(k).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    match (field("agent"), field("goal")) {
        (agent, goal) if !agent.is_empty() && !goal.is_empty() => Ok((agent, goal)),
        (agent, _) => Err(format!(
            "{}. Call it as {SPAWN_AGENT}({{\"agent\": \"<one that already exists>\", \
             \"goal\": \"<the whole task, in one string>\"}})",
            match agent.is_empty() {
                true => "no agent named — list_agents says which exist",
                false => "no goal given, and an agent handed an empty goal answers it anyway",
            }
        )),
    }
}

