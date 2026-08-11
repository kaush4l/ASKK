//! The toolbox — what an agent may call, and how the model is told to call it.
//! The Python `core/tools.py` ported: descriptors and parsing only. Running a
//! tool is I/O, so it happens in `core` through an Effect; this file stays
//! pure and tests on the host (I3, I7).
//!
//! Two rules from the Python carry over exactly, because both were found by
//! test rather than by reading:
//!
//! 1. **Layout carries the schedule.** Calls written on one line are
//!    independent and belong to one batch; a newline between two calls means
//!    "after everything above". `parse_batches` is the reference.
//! 2. **Unreadable arguments are refused, never delivered empty.** A call
//!    whose JSON will not parse must not look like a call that had none — a
//!    sub-agent handed an empty goal answers it regardless. The refusal quotes
//!    the tool's own `usage()`, which is what lets the model rewrite the call.
//!
//! A tool's usage line is GENERATED from its name, description and argument
//! names, so a sub-agent, a script tool and a built-in are indistinguishable
//! to the model (I9).

use kernel::ToolId;

use crate::calls::Call;
use crate::phase::ToolScope;

/// One callable the model can name. No function pointer: a descriptor is data,
/// and the executor lives behind the seam in `core` (like `builtin_entry`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tool {
    pub name: String,
    pub description: String,
    /// The argument shape, generated — never hand-written prose.
    pub usage_args: String,
}

impl Tool {
    /// A tool from its name, description and argument NAMES. The usage line is
    /// built here so no two tools can describe themselves differently.
    pub fn new(name: &str, description: &str, args: &[&str]) -> Tool {
        let pairs: Vec<String> = args.iter().map(|a| format!("\"{a}\": \"<{a}>\"")).collect();
        Tool {
            name: name.into(),
            description: description.into(),
            usage_args: format!("{{{}}}", pairs.join(", ")),
        }
    }

    /// A sub-agent as a tool (Python `Tool.from_engine`): its own name and
    /// description are the tool's, and the whole task is one `query` string.
    /// Structural here — the thread behind it arrives with Workers (06).
    pub fn from_engine(name: &str, description: &str) -> Tool {
        Tool {
            name: name.into(),
            description: description.into(),
            usage_args: "{\"query\": \"<your detailed task description>\"}".into(),
        }
    }

    /// One line: exactly the call shape and what it does.
    pub fn usage(&self) -> String {
        format!("{}({}): {}", self.name, self.usage_args, self.description)
    }
}

/// The outcome of one call. Always a result, never an error return: that text
/// is what lets the model correct itself on the next pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolResult {
    pub tool: String,
    pub ok: bool,
    pub output: String,
    pub error: String,
}

impl ToolResult {
    pub fn failed(tool: &str, error: String) -> ToolResult {
        ToolResult {
            tool: tool.into(),
            ok: false,
            output: String::new(),
            error,
        }
    }

    /// Render for the transcript the model reads next (Python `to_string`).
    pub fn line(&self) -> String {
        format!(
            "{}: {}",
            self.tool,
            if self.ok { &self.output } else { &self.error }
        )
    }
}

/// The tools this build ships. DESCRIPTORS only — `core::tools` holds the one
/// executor table that matches them by name, exactly as `builtin_entry` does
/// for modules; a tool declared here with no executor there refuses like any
/// unknown tool rather than pretending to run.
pub fn builtin_tools() -> Toolbox {
    Toolbox::of(vec![
        Tool::new("now", "The current date and time in this browser.", &[]),
        Tool::new(
            "list_agents",
            "Every agent loaded in this browser: name and what it does.",
            &[],
        ),
        Tool::new(
            "read_agent",
            "One agent's definition: its model, its tools and its system prompt.",
            &["name"],
        ),
    ])
}

/// The set of tools one agent may call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
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
    /// a phase that may not act cannot even name a tool in its Document.
    pub fn scoped(&self, scope: &ToolScope) -> Toolbox {
        match scope {
            ToolScope::None => Toolbox::default(),
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

