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

use serde::{Deserialize, Serialize};

use crate::toolbox::Toolbox;

/// One callable the model can name. No function pointer: a descriptor is data,
/// and the executor lives behind the seam in `core` (like `builtin_entry`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    /// The argument shape, generated — never hand-written prose.
    pub usage_args: String,
    /// This tool IS another agent, so calling it means handing a goal to
    /// another Worker rather than running code here. The MODEL is never told
    /// which is which — everything is invoked identically, and the
    /// distinction would only be noise in the prompt (Python `core/tools.py`).
    #[serde(default)]
    pub agent: bool,
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
            agent: false,
        }
    }

    /// A sub-agent as a tool (Python `Tool.from_engine`): its own name and
    /// description are the tool's, and the whole task is one `query` string.
    /// The Worker behind it is wired in `core`; see `subagent::goal_from` for
    /// the argument reading this constructor promises.
    pub fn from_engine(name: &str, description: &str) -> Tool {
        Tool {
            name: name.into(),
            description: description.into(),
            usage_args: "{\"query\": \"<your detailed task description>\"}".into(),
            agent: true,
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
