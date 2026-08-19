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
///
/// Four groups: what only LOOKS, the two that act on the ROSTER of agents, the
/// one call that LEAVES the tab, and the skill tools, declared beside their own
/// rules the way the space's and the workspace's sets are (`crate::skills`).
pub fn builtin_tools() -> Toolbox {
    let here = [inside_this_browser(), the_roster(), vec![web_search()]].concat();
    Toolbox::of([here, crate::skills::tools()].concat())
}

/// The tools that never leave the tab and only LOOK: what time it is here, and
/// what the agents installed here are.
fn inside_this_browser() -> Vec<Tool> {
    vec![
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
    ]
}

/// THE TWO THAT ACT ON THE ROSTER: one writes an agent into this browser, the
/// other sets one of them working. Each hands CAPABILITY to something that is
/// not this turn, which is why their descriptions are the longest in the file.
///
/// `write_agent` is increment 11. A model authoring an agent that then runs
/// with real capabilities is a decision the user made explicitly; it is an
/// ORDINARY tool because a built-in agent and an authored one must be
/// indistinguishable to the system (I9).
///
/// Its 'space' sentence used to say naming one "also grants it a real shell".
/// That was true when `toolbox_for` appended the workspace set AFTER the
/// allowlist; it is now false for any non-empty list, and a tool description
/// that overstates a capability boundary is the worst place in the product to
/// be out of date — an authoring model reads it and writes the wrong file.
///
/// `spawn_agent` (increment 27) states the boundary the other half implies: it
/// starts an agent that ALREADY EXISTS, so it names `list_agents` for finding
/// one and `write_agent` for authoring one first — composed, the two are
/// "author a new role, then start it", with no second config format.
fn the_roster() -> Vec<Tool> {
    vec![
        Tool::new(
            "write_agent",
            "Create or replace an agent in this browser. It is installed WHEN THIS TURN ENDS \
             — not at once, so spawn_agent cannot reach it until your next turn — and it then \
             gets its own Worker and is listed beside the shipped agents. 'tools' is a \
             comma-separated list of tool and agent names ('' means every built-in, plus the \
             workspace set if a space is named). 'space' is the shared space it works in; \
             naming one makes the workspace tools AVAILABLE TO NAME — 'exec', 'write_file', \
             'read_file', 'list_files' and the process tools — and a non-empty 'tools' list \
             then grants exactly the ones it names and nothing else.",
            &["name", "description", "prompt", "tools", "space"],
        ),
        Tool::new(
            SPAWN_AGENT,
            "Hand a goal to an agent that is ALREADY INSTALLED in this browser: it works on \
             the goal in its own Worker, with its own tools and its own conversation, and \
             its answer comes back to you as this call's result. 'agent' must be the name \
             of an agent that already exists — list_agents says which do — and 'goal' is \
             the whole task in one string. It does NOT create an agent and it cannot give \
             one any capability it was not written with: write_agent is what authors a new \
             agent, and this is what then sets one working.",
            &["agent", "goal"],
        ),
    ]
}

/// The one built-in whose result is a whole turn of somebody ELSE's loop. A
/// constant because `subagent::delegated` branches on the name.
pub(crate) const SPAWN_AGENT: &str = "spawn_agent";

/// The first tool that leaves this browser for something other than the model
/// (increment 21). WHERE it goes is a setting and not a constant: CLAUDE.md §17
/// makes a network allowlist a user gate, so the capability ships and the
/// destination is chosen in Settings. With none chosen the call comes back
/// refused, in the words that say where to choose one — never an empty result,
/// which reads to a model like a web with nothing on it.
fn web_search() -> Tool {
    Tool::new(
        crate::search::WEB_SEARCH,
        "Search the web through the search endpoint configured in this browser's Settings. \
         Returns at most five results, each a title, a URL and one line. It cannot open a \
         page — it says what is there and where.",
        &["query"],
    )
}
