//! The set of tools ONE agent may call, and the check every call passes
//! through. Split from `tools.rs` to hold the 200-line rule (I12): that file
//! describes a tool, this one describes a toolkit.

use serde::{Deserialize, Serialize};

use kernel::ToolId;

use crate::calls::Call;
use crate::phase::ToolScope;
use crate::tools::{Tool, ToolResult};

/// The set of tools one agent may call.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Toolbox {
    pub tools: Vec<Tool>,
}

impl Toolbox {
    pub fn of(tools: Vec<Tool>) -> Toolbox {
        Toolbox { tools }
    }

    pub fn get(&self, name: &str) -> Option<&Tool> {
        self.tools.iter().find(|t| t.name == name)
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// The phase's grant applied (ADR-010): `None` yields an EMPTY toolbox, so
    /// a phase that may not act cannot even name a tool in its Document; `All`
    /// grants whatever THIS agent's `agent.md` gave it, which is where the
    /// per-agent decision belongs (Python: `tools:` is the agent's toolkit).
    pub fn scoped(&self, scope: &ToolScope) -> Toolbox {
        match scope {
            ToolScope::None => Toolbox::default(),
            ToolScope::All => self.clone(),
            ToolScope::Only(ids) => Toolbox::of(
                self.tools
                    .iter()
                    .filter(|t| ids.contains(&ToolId(t.name.clone())))
                    .cloned()
                    .collect(),
            ),
        }
    }

    /// The toolbox rendered for the model — one line per tool, then the layout
    /// rule. This text reaches a model only as a Document section (I13).
    /// One `name(args): description` line per tool, in toolbox order — what
    /// the affordances component carries. The component holds these rather
    /// than the tools themselves: a tool is behaviour, a component is a value,
    /// and this line was the only thing the prompt ever wanted from one.
    pub fn usages(&self) -> Vec<String> {
        self.tools.iter().map(Tool::usage).collect()
    }

    /// The affordances block, as the model will read it.
    ///
    /// This used to build the block itself, and was the second place in the
    /// codebase that knew what a tool looks like written down. It now asks the
    /// component that owns that shape, so there is exactly one answer to the
    /// question and no way for the two to drift.
    pub fn instructions(&self) -> String {
        crate::components::Affordances::new(self.usages()).text()
    }

    /// Check one call before it can run. `Err` is the refusal to hand back to
    /// the model verbatim; nothing else may run.
    pub fn check(&self, call: &Call) -> Result<&Tool, ToolResult> {
        let Some(tool) = self.get(&call.tool) else {
            let names: Vec<&str> = self.tools.iter().map(|t| t.name.as_str()).collect();
            let available = match names.is_empty() {
                true => "none".to_string(),
                false => names.join(", "),
            };
            return Err(ToolResult::failed(
                &call.tool,
                format!("Tool not found. Available: {available}"),
            ));
        };
        if let Some(refusal) = swallowed(call, tool) {
            return Err(refusal);
        }
        match &call.args_error {
            None => Ok(tool),
            Some(problem) => Err(ToolResult::failed(
                &call.tool,
                format!(
                    "Could not read the arguments: {problem}. Write them as JSON on one line, \
                     escaping any \" inside a string and using \\n for a line break — {}",
                    tool.usage()
                ),
            )),
        }
    }
}

/// THE CALL'S OWN TERMINATOR INSIDE AN ARGUMENT, REFUSED (R14-P0-2).
///
/// R13 detected this and let the call run, reasoning that refusing on a
/// heuristic would be worse than writing what the model asked for. R14 measured
/// what that costs: the product's OWN suggested prompt put 179 bytes of
/// un-parsed argument fragment on disk — one line, literal `\n`, a leading `"`
/// and a trailing `"})` — and the model's success claim went through beside a
/// row the page had already said it could not vouch for. The bytes are garbage
/// either way, so the only question is whether the model gets a chance to fix
/// them, and a refusal it can read and rewrite is strictly better than a
/// corrupt file plus a false success. So the conclusion is reversed and the
/// detection is not: `calls::swallowed_close` is the same predicate it always
/// was, never a wider one, because a false refusal on a legitimate write would
/// be worse than the bug.
///
/// `exec` is refused too, and deliberately: the same signature is on record for
/// it (`core::failed`: `$ "wc -l primes.txt"})`), and a shell handed a
/// swallowed terminator runs a command nobody wrote — quieter than a bad file
/// and no easier to correct after the fact. One predicate, every tool, one
/// place; a per-tool list here would only be a second thing to keep in step.
/// The opening of the refusal above. It is written for the MODEL and goes to it
/// unchanged; a person reading the same string in the trace gets one sentence
/// and this behind a disclosure (`core::vouch::folded`), which needs a way to
/// recognise it. One const, so the two cannot drift (R15-P1-5).
pub const NOTHING_RAN: &str = "Nothing ran: an argument ends with";

fn swallowed(call: &Call, tool: &Tool) -> Option<ToolResult> {
    if !crate::calls::swallowed_close(&call.args_json) {
        return None;
    }
    Some(ToolResult::failed(
        &call.tool,
        format!(
            "{NOTHING_RAN} \"}}), this call's own closing text. The value \
             was escaped one level too many, so it swallowed the end of the call and holds those \
             delimiters instead of what you meant. Write the call again with the value as one \
             JSON string — \\n for a line break, \\\" for a quote inside it, and no \"}}) inside \
             the value — {}",
            tool.usage()
        ),
    ))
}

