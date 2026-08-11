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
    pub fn instructions(&self) -> String {
        if self.tools.is_empty() {
            return "No tools are installed; answer from what you know.".into();
        }
        let lines: Vec<String> = self.tools.iter().map(Tool::usage).collect();
        format!(
            "AVAILABLE TOOLS\n\n{}\n\nCall them exactly as written above. Calls that do not \
             depend on each other go on one line, separated by commas, and run at the same \
             time. A call that needs an earlier call's result goes on its own line — lines \
             run in order, top to bottom. Results come back labelled with the tool name, in \
             the order you wrote the calls.",
            lines.join("\n")
        )
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

