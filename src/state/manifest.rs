//! Agents and skills, and the Markdown-manifest parsing that builds them. An agent
//! or skill is authored as a Markdown file with YAML-ish frontmatter (see
//! `docs/extensibility.md`); the parsers here turn that text into [`Agent`] /
//! [`Skill`] data and back. The bundled defaults are embedded from the repo's
//! `soul.md`, `agents/`, and `skills/` at build time.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::AppResult;
use super::snapshot::AppSnapshot;
use super::tool_types::default_tool_names;
use crate::responses::ResponseFormat;
use crate::strategy::{DeclaredPhase, StrategyRegistry, response_kind_from_str};

const DEFAULT_SOUL: &str = include_str!("../../soul.md");
// Bundled default agents AND skills are auto-discovered from the `agents/` and
// `skills/` directories by `build.rs` (the "utility [that] reads all files from the
// folder, don't hardcode"). The build script scans every `*.md` under each directory
// and codegens a `&[(&str, &str)]` slice — one (repo-relative path, file contents)
// pair per file, sorted by path — into `OUT_DIR`. Including them here replaces the old
// hand-maintained arrays, so dropping a new file into either folder registers it
// automatically with no source edit. The agent array previously omitted
// `assistant.md` and the skill array omitted `assistant/morning_briefing.md` — exactly
// the drift this kills. Authors order the set with a numeric filename prefix
// (`1_orchestrator.md`, `2_planner.md`, …); the prefix is stripped from the derived id.
include!(concat!(env!("OUT_DIR"), "/skills_generated.rs"));
include!(concat!(env!("OUT_DIR"), "/agents_generated.rs"));

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub enabled: bool,
    pub enabled_tools: Vec<String>,
    #[serde(default)]
    pub response_format: ResponseFormat,
    #[serde(default)]
    pub source_path: Option<String>,
    /// Optional model profile this agent runs with. Falls back to the workspace
    /// active model profile when unset.
    #[serde(default)]
    pub model_profile_id: Option<String>,
    /// Optional provider connection profile this agent runs with (its own LLM
    /// endpoint/key/model). Falls back to the workspace active provider profile, then
    /// the global provider, when unset. This is what lets a team mix & match LLMs —
    /// each agent can target a different provider and run in parallel.
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    /// Marks this agent as THE orchestrator — the single entry agent the user talks to,
    /// which decomposes the goal and delegates to the rest of the team. When any enabled
    /// agent sets this, `pick_agent` routes an un-targeted run to it. Set via the
    /// `orchestrator: true` frontmatter key.
    #[serde(default)]
    pub is_orchestrator: bool,
    #[serde(default)]
    pub workflow_id: Option<String>,
    /// Strategy this agent runs by default. `None` = the workspace default
    /// (`react`). Overridable per invocation via `LoopParams.strategy`.
    #[serde(default)]
    pub strategy_id: Option<String>,
    /// Phases this agent declares directly in its `agent.md` (the `phase.<n>.*`
    /// flat keys), parsed into an ordered [`DeclaredPhase`] list. `None` = a legacy
    /// single-strategy agent (driven by `strategy_id` or the default). An agent may
    /// set `phases` OR `strategy_id`, never both (rejected by `validate_agent_refs`).
    #[serde(default)]
    pub phases: Option<Vec<DeclaredPhase>>,
    /// The team this agent belongs to, derived from its containing subfolder under
    /// `agents/` (e.g. `agents/coder/1_planner.md` → `Some("coder")`). A flat file
    /// directly under `agents/` is standalone (`None`). A team is a folder of
    /// numbered member files the supervisor spins up together as a pipeline — the
    /// number of members is read from the folder, never hardcoded.
    #[serde(default)]
    pub team: Option<String>,
    /// This agent's position within its team, taken from the numeric filename prefix
    /// (`1_planner.md` → 1). Members run in ascending order; `0` when no prefix.
    #[serde(default)]
    pub order: u32,
}

impl Agent {
    pub fn new(
        name: impl Into<String>,
        role: impl Into<String>,
        enabled_tools: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            role: role.into(),
            enabled: true,
            enabled_tools,
            response_format: ResponseFormat::Toon,
            source_path: None,
            model_profile_id: None,
            provider_profile_id: None,
            is_orchestrator: false,
            workflow_id: None,
            strategy_id: None,
            phases: None,
            team: None,
            order: 0,
        }
    }

    /// A one-line, LLM-facing summary of this agent for the sub-agent roster
    /// (code object → LLM information). Agents carry their full instruction as the
    /// role/markdown body rather than a separate description field, so the summary
    /// is the first non-empty line of the role, stripped of markdown heading/bullet
    /// markers and bounded in length.
    pub fn short_description(&self) -> String {
        self.role
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|line| {
                let cleaned = line.trim_start_matches(['#', '-', '*', ' ']).trim();
                if cleaned.chars().count() > 200 {
                    let mut out = cleaned.chars().take(200).collect::<String>();
                    out.push('…');
                    out
                } else {
                    cleaned.to_string()
                }
            })
            .filter(|summary| !summary.is_empty())
            .unwrap_or_else(|| self.name.clone())
    }
}

/// A single load-time reference problem found in an [`Agent`]'s frontmatter: it
/// names a tool, strategy, workflow, or sub-agent that does not exist in the
/// loaded snapshot. Reported (not fatal) so a fleet degrades gracefully but
/// loudly — a bad reference never traps the whole Wasm app mid-fleet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefError {
    /// `tools:` named a tool that is not in the known tool set.
    Tool { agent: String, tool: String },
    /// `strategy:` named a strategy id the [`StrategyRegistry`] does not register.
    Strategy { agent: String, strategy: String },
    /// `workflow:` named a workflow id absent from the snapshot's workflows.
    Workflow { agent: String, workflow: String },
    /// A determinable sub-agent reference points at an agent absent from the roster.
    SubAgent { agent: String, sub_agent: String },
    /// A structural problem in the agent's declared `phase.<n>.*` block: a duplicate
    /// phase name, more than one `gate: true`, an `on_fail` naming a non-existent
    /// phase, an `on_fail` with no gate to bounce from, or both `phases` and
    /// `strategy_id` set at once. `detail` carries a human-readable description.
    Phases { agent: String, detail: String },
}

impl std::fmt::Display for RefError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RefError::Tool { agent, tool } => {
                write!(f, "agent '{agent}' references unknown tool '{tool}'")
            }
            RefError::Strategy { agent, strategy } => {
                write!(
                    f,
                    "agent '{agent}' references unknown strategy '{strategy}'"
                )
            }
            RefError::Workflow { agent, workflow } => {
                write!(
                    f,
                    "agent '{agent}' references unknown workflow '{workflow}'"
                )
            }
            RefError::SubAgent { agent, sub_agent } => {
                write!(
                    f,
                    "agent '{agent}' references unknown sub-agent '{sub_agent}'"
                )
            }
            RefError::Phases { agent, detail } => {
                write!(f, "agent '{agent}' has an invalid phase block: {detail}")
            }
        }
    }
}

/// Prefix of every peer-agent tool name (`agent_<slug>`). Mirrors
/// `crate::tools::agent_tools`'s own constant; an allowlist entry with this prefix
/// is a determinable sub-agent reference, not a plain tool. (Kept local so this
/// pure validator does not depend on that module's private const; the
/// `agent_tool_entries_are_validated_as_sub_agents` test pins the convention.)
const AGENT_TOOL_PREFIX: &str = "agent_";

/// The full set of tool names an agent's `tools:` allowlist may name without being
/// flagged as a bad reference: the [`default_tool_names`] allowlist (the built-in
/// compiled tools, which seed a fresh agent) plus the registered tools that live
/// *outside* that default set but are nonetheless real and referenced by bundled
/// agents — the `call_agent` delegation tool (orchestrator) and the assistant's
/// integration tools (`gmail_search`, `gcal_events`, `manage_schedule`,
/// `telegram_send`). These mirror the non-default entries in
/// `crate::tools::register_builtin_tools`; kept as a local list (rather than reaching
/// into `crate::tools::ToolRegistry`) so this validator stays pure and host-testable
/// — it must run in the agent-load path without pulling in browser/bridge tool
/// handlers. If a new registered tool is referenced by a bundled agent, add it here.
fn known_tool_names() -> Vec<String> {
    let mut names = default_tool_names();
    for extra in [
        "call_agent",
        "delegate_team",
        "team_send",
        "team_progress",
        "team_list",
        "gmail_search",
        "gcal_events",
        "manage_schedule",
        "telegram_send",
    ] {
        if !names.iter().any(|name| name == extra) {
            names.push(extra.to_string());
        }
    }
    names
}

/// Validate an agent's frontmatter references against the rest of the loaded
/// snapshot, *at load time*, so a malformed `agents/*.md` is reported here rather
/// than trapping the whole Wasm app mid-fleet. Pure and host-testable; it reads,
/// never mutates.
///
/// Checks, collected (not short-circuited) so a single pass reports every problem:
/// - every plain `enabled_tools` entry against the known tool set
///   ([`known_tool_names`] — the [`default_tool_names`] allowlist plus the
///   registered-but-not-default delegation/integration tools the bundled agents
///   legitimately reference),
/// - every `agent_<slug>` peer-tool entry (a *determinable* sub-agent reference)
///   against the snapshot's enabled agent roster,
/// - `strategy_id` against the [`StrategyRegistry`] catalog,
/// - `workflow_id` against the snapshot's known workflows.
///
/// Sub-agent references are checked only where they are structurally determinable.
/// The one structured form today is the `agent_<slug>` peer tool an allowlist may
/// name (see `crate::tools::agent_tools`): it resolves to a specific agent by slug,
/// so a name that resolves to no enabled agent is a [`RefError::SubAgent`]. Peers
/// named only in free-text prose (e.g. the orchestrator's body) are *not* checked —
/// guessing ids out of prose produces noisy false positives, which is worse than
/// not reporting.
///
/// Returns `Ok(())` when every reference resolves, or `Err(errors)` carrying one
/// [`RefError`] per problem found.
pub fn validate_agent_refs(agent: &Agent, snapshot: &AppSnapshot) -> Result<(), Vec<RefError>> {
    let mut errors = Vec::new();
    let label = if agent.name.trim().is_empty() {
        agent.id.clone()
    } else {
        agent.name.clone()
    };

    let known_tools = known_tool_names();
    for tool in &agent.enabled_tools {
        if let Some(slug) = tool.strip_prefix(AGENT_TOOL_PREFIX) {
            // An `agent_<slug>` peer tool is a determinable sub-agent reference: it
            // must resolve to an enabled agent in the roster (the same resolution the
            // runtime uses to route the delegation).
            if crate::tools::agent_tools::resolve(snapshot, tool).is_none() {
                errors.push(RefError::SubAgent {
                    agent: label.clone(),
                    sub_agent: slug.to_string(),
                });
            }
            continue;
        }
        if !known_tools.iter().any(|known| known == tool) {
            errors.push(RefError::Tool {
                agent: label.clone(),
                tool: tool.clone(),
            });
        }
    }

    if let Some(strategy) = agent
        .strategy_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let registry = StrategyRegistry::new();
        let known = registry.catalog().iter().any(|(id, _)| *id == strategy);
        if !known {
            errors.push(RefError::Strategy {
                agent: label.clone(),
                strategy: strategy.to_string(),
            });
        }
    }

    if let Some(workflow) = agent
        .workflow_id
        .as_deref()
        .map(str::trim)
        .filter(|w| !w.is_empty())
    {
        let known = snapshot
            .workflows
            .iter()
            .any(|definition| definition.id == workflow);
        if !known {
            errors.push(RefError::Workflow {
                agent: label.clone(),
                workflow: workflow.to_string(),
            });
        }
    }

    // Declared-phase structural validation. Collected (not short-circuited), like the
    // rest of this validator, so one pass reports every phase problem.
    if let Some(phases) = agent.phases.as_deref().filter(|p| !p.is_empty()) {
        let phase_error = |detail: String| RefError::Phases {
            agent: label.clone(),
            detail,
        };

        // An agent declares phases XOR a single strategy — never both.
        if agent
            .strategy_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|s| !s.is_empty())
        {
            errors.push(phase_error(
                "both `phases` and `strategy_id` are set; choose one".to_string(),
            ));
        }

        // Phase names must be unique (routing and `on_fail` resolve by name).
        let mut seen: Vec<&str> = Vec::new();
        for phase in phases {
            let name = phase.name.trim();
            if seen.contains(&name) {
                errors.push(phase_error(format!("duplicate phase name '{name}'")));
            } else {
                seen.push(name);
            }
        }

        // At most one gate phase.
        let gate_count = phases.iter().filter(|p| p.gate).count();
        if gate_count > 1 {
            errors.push(phase_error(format!(
                "{gate_count} phases set `gate: true`; at most one is allowed"
            )));
        }
        let has_gate = gate_count >= 1;

        // Every `on_fail` target must name an existing phase; an `on_fail` requires a
        // gate to bounce from.
        for phase in phases {
            if let Some(target) = phase.on_fail.as_deref().filter(|t| !t.trim().is_empty()) {
                if !phases.iter().any(|p| p.name.trim() == target.trim()) {
                    errors.push(phase_error(format!(
                        "phase '{}' bounces to unknown phase '{target}' via on_fail",
                        phase.name.trim()
                    )));
                }
                if !has_gate {
                    errors.push(phase_error(format!(
                        "phase '{}' sets on_fail but no phase is the gate",
                        phase.name.trim()
                    )));
                }
            }
        }

        // Unknown tool names / response kinds are warned, not failed: a declared phase
        // with a typo'd tool degrades (the tool is dropped by the policy filter) rather
        // than trapping the load. We surface them via the same collect-all channel only
        // as soft signals — represented here as `Phases` details prefixed "warning:".
        let known_tools = known_tool_names();
        for phase in phases {
            for tool in &phase.tools {
                let tool = tool.trim();
                if tool.is_empty() {
                    continue;
                }
                let known = tool.strip_prefix(AGENT_TOOL_PREFIX).is_some()
                    || known_tools.iter().any(|known| known == tool);
                if !known {
                    errors.push(phase_error(format!(
                        "warning: phase '{}' names unknown tool '{tool}'",
                        phase.name.trim()
                    )));
                }
            }
            if let Some(kind) = phase
                .response_kind
                .as_deref()
                .filter(|k| !k.trim().is_empty())
                && response_kind_from_str(kind).is_none()
            {
                errors.push(phase_error(format!(
                    "warning: phase '{}' names unknown response_kind '{kind}'",
                    phase.name.trim()
                )));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub content: String,
    pub enabled: bool,
    #[serde(default)]
    pub source_path: Option<String>,
}

pub fn default_soul_prompt() -> String {
    DEFAULT_SOUL.trim().to_string()
}

pub fn default_agents() -> Vec<Agent> {
    let agents = GENERATED_AGENT_FILES
        .iter()
        .filter_map(|(path, content)| agent_from_markdown(path, content).ok())
        .collect::<Vec<_>>();

    if agents.is_empty() {
        return vec![Agent::new("Agent", "", default_tool_names())];
    }
    agents
}

pub fn default_skills() -> Vec<Skill> {
    GENERATED_SKILL_FILES
        .iter()
        .filter_map(|(path, content)| skill_from_markdown(path, content).ok())
        .collect()
}

/// A team: the ordered set of member agents discovered in one `agents/<team>/`
/// subfolder. The membership and its size come entirely from the files on disk —
/// dropping a member `.md` into the folder adds it, with no code change. The
/// supervisor consumes this to spin up one runtime instance (object + queue +
/// status) per `member_ids` entry, in order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeamSpec {
    /// The team id (the subfolder name, slugified).
    pub id: String,
    /// The lead/entry member: the `orchestrator: true` member if any, else the
    /// lowest-ordered member. `None` only for an empty team (never produced here).
    pub lead_id: Option<String>,
    /// Member agent ids, ascending by `Agent::order` (the numeric filename prefix).
    pub member_ids: Vec<String>,
}

/// Group the loaded agents into teams by their `team` field. Only agents that
/// declare a team (live in an `agents/<team>/` subfolder) participate; flat,
/// standalone agents are ignored. Teams are returned in stable (sorted) id order,
/// each with its members sorted by `order`. Nothing about the count is hardcoded —
/// it is purely a projection of what `agent_from_markdown` parsed from the folder.
pub fn teams(agents: &[Agent]) -> Vec<TeamSpec> {
    use std::collections::BTreeMap;

    let mut groups: BTreeMap<String, Vec<&Agent>> = BTreeMap::new();
    for agent in agents {
        if let Some(team) = &agent.team {
            groups.entry(team.clone()).or_default().push(agent);
        }
    }

    groups
        .into_iter()
        .map(|(id, mut members)| {
            members.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
            let lead_id = members
                .iter()
                .find(|agent| agent.is_orchestrator)
                .or_else(|| members.first())
                .map(|agent| agent.id.clone());
            let member_ids = members.iter().map(|agent| agent.id.clone()).collect();
            TeamSpec {
                id,
                lead_id,
                member_ids,
            }
        })
        .collect()
}

pub fn agent_from_markdown(path: &str, content: &str) -> AppResult<Agent> {
    let (meta, body) = split_markdown_frontmatter(content);
    // A team is the subfolder under `agents/` the file lives in; team members get a
    // `{team}-{role}` id so two teams (or a team and a flat file) can both have a
    // `planner`/`coder` without colliding in the flat roster.
    let team = team_from_path(path);
    let order = order_from_path(path);
    let role_slug = slug_from_path(path);
    let id = meta_value(&meta, "id")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value))
        .unwrap_or_else(|| match &team {
            Some(team) => slugify(&format!("{team}-{role_slug}")),
            None => role_slug.clone(),
        });
    let name = meta_value(&meta, "name")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_from_slug(&role_slug));
    let enabled = meta_value(&meta, "enabled")
        .map(|value| parse_bool(&value))
        .unwrap_or(true);
    let enabled_tools = meta_value(&meta, "tools")
        .map(|value| parse_tools(&value))
        .unwrap_or_else(default_tool_names);
    let response_format = meta_value(&meta, "response_format")
        .or_else(|| meta_value(&meta, "format"))
        .map(|value| ResponseFormat::from_form_value(&value))
        .unwrap_or_default();
    let workflow_id = meta_value(&meta, "workflow")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value));
    let strategy_id = meta_value(&meta, "strategy")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    // Per-agent LLM: an agent can name its own model profile and provider connection in
    // frontmatter (a saved profile id or name). Unset ⇒ falls back to the workspace
    // active profile at run init. This is the file-driven half of "mix & match LLMs".
    let model_profile_id = meta_value(&meta, "model_profile")
        .or_else(|| meta_value(&meta, "model"))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let provider_profile_id = meta_value(&meta, "provider_profile")
        .or_else(|| meta_value(&meta, "provider"))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let is_orchestrator = meta_value(&meta, "orchestrator")
        .map(|value| parse_bool(&value))
        .unwrap_or(false);
    let phases = parse_declared_phases(&meta);
    let role = body.trim().to_string();

    if role.is_empty() {
        return Err(format!("Agent file {path} does not contain a prompt body."));
    }

    Ok(Agent {
        id,
        name,
        role,
        enabled,
        enabled_tools,
        response_format,
        source_path: Some(path.to_string()),
        model_profile_id,
        provider_profile_id,
        is_orchestrator,
        workflow_id,
        strategy_id,
        phases,
        team,
        order,
    })
}

/// Parse the flat `phase.<n>.<field>` frontmatter keys into an ordered
/// [`DeclaredPhase`] list. Lines are grouped by the integer index `<n>` and emitted in
/// ascending index order (so authors number phases 1,2,3…). Returns `None` when no
/// `phase.*` key is present (a legacy agent), or `Some(vec)` otherwise.
///
/// Recognised per-index fields:
/// - `name` — the phase name (defaults to `phase<n>` when omitted),
/// - `header` — the phase framing prepended to the goal,
/// - `response_kind` — one of the [`ResponseKind`] snake_case names,
/// - `tools` — comma-separated tool subset (empty ⇒ inherit),
/// - `loop` — `loop` ⇒ looped, anything else (incl. `one_shot`) ⇒ one-shot,
/// - `gate` — `true` marks the sole-exit gate,
/// - `on_fail` — the phase name a failed gate bounces to.
///
/// The frontmatter scanner lowercases keys, so matching is case-insensitive. Unknown
/// `response_kind`/tool values are kept verbatim here and reported (as warnings, not
/// failures) by `validate_agent_refs`.
fn parse_declared_phases(meta: &[(String, String)]) -> Option<Vec<DeclaredPhase>> {
    // Collect (index, field, value) for every `phase.<n>.<field>` line, preserving the
    // first occurrence of each (index, field) pair.
    let mut indices: Vec<usize> = Vec::new();
    let mut entries: Vec<(usize, String, String)> = Vec::new();
    for (key, value) in meta {
        let rest = match key.strip_prefix("phase.") {
            Some(rest) => rest,
            None => continue,
        };
        let (idx_str, field) = match rest.split_once('.') {
            Some(parts) => parts,
            None => continue,
        };
        let idx: usize = match idx_str.trim().parse() {
            Ok(idx) => idx,
            Err(_) => continue,
        };
        let field = field.trim().to_string();
        if entries.iter().any(|(i, f, _)| *i == idx && f == &field) {
            continue; // first value wins (mirrors meta_value semantics)
        }
        if !indices.contains(&idx) {
            indices.push(idx);
        }
        entries.push((idx, field, value.clone()));
    }

    if indices.is_empty() {
        return None;
    }
    indices.sort_unstable();

    let field_of = |idx: usize, field: &str| -> Option<String> {
        entries
            .iter()
            .find(|(i, f, _)| *i == idx && f == field)
            .map(|(_, _, v)| v.clone())
    };

    let phases = indices
        .into_iter()
        .map(|idx| {
            let name = field_of(idx, "name")
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| format!("phase{idx}"));
            let header = field_of(idx, "header").unwrap_or_default();
            let response_kind = field_of(idx, "response_kind")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            let tools = field_of(idx, "tools")
                .map(|v| {
                    v.split(',')
                        .map(str::trim)
                        .filter(|t| !t.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let looped = field_of(idx, "loop")
                .map(|v| v.trim().eq_ignore_ascii_case("loop"))
                .unwrap_or(false);
            let gate = field_of(idx, "gate")
                .map(|v| parse_bool(&v))
                .unwrap_or(false);
            let on_fail = field_of(idx, "on_fail")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            DeclaredPhase {
                name,
                header,
                response_kind,
                tools,
                looped,
                gate,
                on_fail,
            }
        })
        .collect();

    Some(phases)
}

pub fn agent_to_markdown(agent: &Agent) -> String {
    let tools = if same_tools(&agent.enabled_tools, &default_tool_names()) {
        "all".to_string()
    } else {
        agent.enabled_tools.join(", ")
    };
    let strategy_line = match agent.strategy_id.as_deref() {
        Some(s) if !s.is_empty() => format!("strategy: {s}\n"),
        _ => String::new(),
    };
    let phases_block = match agent.phases.as_deref() {
        Some(phases) if !phases.is_empty() => declared_phases_to_markdown(phases),
        _ => String::new(),
    };
    format!(
        "---\nid: {id}\nname: {name}\nenabled: {enabled}\ntools: {tools}\nresponse_format: {response_format}\n{strategy_line}{phases_block}---\n\n{role}\n",
        id = slugify(&agent.id),
        name = agent.name.trim(),
        enabled = agent.enabled,
        tools = tools,
        response_format = agent.response_format.as_form_value(),
        strategy_line = strategy_line,
        phases_block = phases_block,
        role = agent.role.trim(),
    )
}

/// Serialize a declared-phase list back to the flat `phase.<n>.*` frontmatter form
/// (1-based index), the inverse of [`parse_declared_phases`]. Only the fields that
/// carry information are emitted, so a round-trip is stable: `header`/`tools`/`on_fail`
/// are written only when non-empty, `loop`/`gate` only when set.
fn declared_phases_to_markdown(phases: &[DeclaredPhase]) -> String {
    let mut out = String::new();
    for (i, phase) in phases.iter().enumerate() {
        let n = i + 1;
        out.push_str(&format!("phase.{n}.name: {}\n", phase.name));
        if !phase.header.trim().is_empty() {
            out.push_str(&format!("phase.{n}.header: {}\n", phase.header));
        }
        if let Some(kind) = phase.response_kind.as_deref().filter(|k| !k.is_empty()) {
            out.push_str(&format!("phase.{n}.response_kind: {kind}\n"));
        }
        if !phase.tools.is_empty() {
            out.push_str(&format!("phase.{n}.tools: {}\n", phase.tools.join(", ")));
        }
        if phase.looped {
            out.push_str(&format!("phase.{n}.loop: loop\n"));
        }
        if phase.gate {
            out.push_str(&format!("phase.{n}.gate: true\n"));
        }
        if let Some(target) = phase.on_fail.as_deref().filter(|t| !t.is_empty()) {
            out.push_str(&format!("phase.{n}.on_fail: {target}\n"));
        }
    }
    out
}

pub fn agent_markdown_path(agent: &Agent) -> String {
    agent
        .source_path
        .as_deref()
        .filter(|path| path.starts_with("agents/") && path.ends_with(".md"))
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("agents/{}.md", slugify(&agent.name)))
}

pub fn skill_from_markdown(path: &str, content: &str) -> AppResult<Skill> {
    let (meta, body) = split_markdown_frontmatter(content);
    let id = meta_value(&meta, "id")
        .filter(|value| !value.trim().is_empty())
        .map(|value| slugify(&value))
        .unwrap_or_else(|| slug_from_path(path));
    let name = meta_value(&meta, "name")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_from_slug(&id));
    let enabled = meta_value(&meta, "enabled")
        .map(|value| parse_bool(&value))
        .unwrap_or(true);
    let body = body.trim().to_string();

    if body.is_empty() {
        return Err(format!("Skill file {path} does not contain a body."));
    }

    Ok(Skill {
        id,
        name,
        content: body,
        enabled,
        source_path: Some(path.to_string()),
    })
}

fn split_markdown_frontmatter(content: &str) -> (Vec<(String, String)>, String) {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return (Vec::new(), normalized);
    }

    let mut meta = Vec::new();
    let mut body = Vec::new();
    let mut in_meta = true;
    for line in lines {
        if in_meta && line.trim() == "---" {
            in_meta = false;
            continue;
        }
        if in_meta {
            if let Some((key, value)) = line.split_once(':') {
                meta.push((key.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
        } else {
            body.push(line);
        }
    }
    (meta, body.join("\n"))
}

fn meta_value(meta: &[(String, String)], key: &str) -> Option<String> {
    meta.iter()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.clone())
}

fn parse_bool(value: &str) -> bool {
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "false" | "0" | "no"
    )
}

/// Parse and normalize a `tools:` allowlist (comma-separated, lowercased, deduped).
/// Empty or `all` expands to the full built-in set. Crate-visible because the
/// snapshot normalizer re-runs it over loaded agents.
pub(crate) fn parse_tools(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        return default_tool_names();
    }

    let mut tools = Vec::new();
    for raw in trimmed.split(',') {
        let candidate = raw.trim();
        if candidate.is_empty() {
            continue;
        }
        if !candidate
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
        {
            continue;
        }
        let normalized = candidate.to_ascii_lowercase();
        if !tools.iter().any(|tool| tool == &normalized) {
            tools.push(normalized);
        }
    }

    if tools.is_empty() {
        default_tool_names()
    } else {
        tools
    }
}

fn same_tools(left: &[String], right: &[String]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort();
    right.sort();
    left == right
}

fn slug_from_path(path: &str) -> String {
    let file = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .trim_end_matches(".MD");
    // Strip a leading numeric ordering prefix ("1_orchestrator" -> "orchestrator") so
    // the dynamic folder-ordering convention never leaks into the derived id/name.
    slugify(strip_numeric_prefix(file))
}

/// The team a member file belongs to: its immediate parent folder under `agents/`,
/// slugified. `agents/coder/1_planner.md` -> `Some("coder")`; a flat file directly
/// under `agents/` (e.g. `agents/1_orchestrator.md`) -> `None`. Paths that don't sit
/// under an `agents/` segment (or sit directly in it) are standalone.
fn team_from_path(path: &str) -> Option<String> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    // Need at least `agents/<team>/<file>.md` (3 segments) for a team to exist.
    let agents_idx = segments.iter().position(|s| *s == "agents")?;
    let parent_idx = segments.len().checked_sub(2)?;
    if parent_idx <= agents_idx {
        // Parent is `agents/` itself — a flat, standalone agent.
        return None;
    }
    let team = slugify(segments[parent_idx]);
    (!team.is_empty()).then_some(team)
}

/// The numeric ordering prefix on a member filename (`1_planner.md` -> 1,
/// `12-foo.md` -> 12). `0` when the filename has no leading-digit prefix.
fn order_from_path(path: &str) -> u32 {
    let file = path.rsplit('/').next().unwrap_or(path);
    let digits: String = file.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().unwrap_or(0)
}

/// Drop a leading `<digits><separator>` prefix used purely for folder ordering, e.g.
/// `1_orchestrator` -> `orchestrator`, `12-foo` -> `foo`. Leaves names that merely
/// start with a digit but have no separator intact (`2fa` stays `2fa`).
fn strip_numeric_prefix(name: &str) -> &str {
    let trimmed = name.trim_start_matches(|c: char| c.is_ascii_digit());
    if trimmed.len() != name.len()
        && let Some(rest) = trimmed.strip_prefix(['_', '-', ' '])
    {
        return rest;
    }
    name
}

fn title_from_slug(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_agent_markdown_frontmatter_and_normalizes_tools() {
        let agent = agent_from_markdown(
            "agents/deep-research.md",
            "---\nid: deep-research\nname: Deep Research\nenabled: false\ntools: memory_search, web_search\nresponse_format: json\n---\n\nResearch deeply.",
        )
        .unwrap();

        assert_eq!(agent.id, "deep-research");
        assert_eq!(agent.name, "Deep Research");
        assert!(!agent.enabled);
        assert_eq!(
            agent.enabled_tools,
            vec!["memory_search".to_string(), "web_search".to_string()]
        );
        assert_eq!(agent.response_format, ResponseFormat::Json);
        assert_eq!(agent.role, "Research deeply.");
        assert_eq!(
            agent.source_path.as_deref(),
            Some("agents/deep-research.md")
        );

        let serialized = agent_to_markdown(&agent);
        assert!(serialized.contains("name: Deep Research"));
        assert!(serialized.contains("tools: memory_search, web_search"));
        assert!(serialized.contains("response_format: json"));
        assert!(serialized.contains("Research deeply."));
    }

    #[test]
    fn agent_markdown_defaults_to_toon_response_format() {
        let agent = agent_from_markdown(
            "agents/planner.md",
            "---\nid: planner\nname: Planner\nenabled: true\ntools: all\n---\n\nPlan.",
        )
        .unwrap();

        assert_eq!(agent.response_format, ResponseFormat::Toon);
    }

    #[test]
    fn parses_skill_markdown_frontmatter_and_body() {
        let skill = skill_from_markdown(
            "skills/research/SKILL.md",
            "---\nid: research\nname: Research\nenabled: true\n---\n\nUse evidence.",
        )
        .unwrap();

        assert_eq!(skill.id, "research");
        assert_eq!(skill.name, "Research");
        assert!(skill.enabled);
        assert_eq!(skill.content, "Use evidence.");
        assert_eq!(
            skill.source_path.as_deref(),
            Some("skills/research/SKILL.md")
        );
    }

    #[test]
    fn skills_auto_discovered_count_matches_disk() {
        // The build script (`build.rs`) is the source of truth for the default skill
        // set. This test re-walks the live `skills/` directory on disk and asserts the
        // discovered/registered count equals the number of `*.md` files actually
        // present — the guard that prevents the list from silently drifting again (the
        // exact failure that left `morning_briefing.md` unregistered before).
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let skills_dir = manifest_dir.join("skills");

        fn count_markdown(dir: &std::path::Path) -> usize {
            let mut count = 0;
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        count += count_markdown(&path);
                    } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                        count += 1;
                    }
                }
            }
            count
        }

        let on_disk = count_markdown(&skills_dir);
        assert!(on_disk > 0, "expected at least one skill on disk");

        // Every discovered file is embedded in the generated slice...
        assert_eq!(
            GENERATED_SKILL_FILES.len(),
            on_disk,
            "generated skill list ({}) drifted from *.md files on disk ({on_disk})",
            GENERATED_SKILL_FILES.len(),
        );
        // ...and every well-formed skill markdown parses into a registered skill.
        assert_eq!(
            default_skills().len(),
            on_disk,
            "registered skills ({}) drifted from *.md files on disk ({on_disk})",
            default_skills().len(),
        );
    }

    #[test]
    fn skills_auto_discovery_includes_morning_briefing() {
        // Regression sanity for the headline bug: `skills/assistant/morning_briefing.md`
        // lives on disk but was missing from the old hand-maintained array. Auto-
        // discovery must pick it up.
        let skills = default_skills();
        assert!(
            skills
                .iter()
                .any(|s| s.source_path.as_deref() == Some("skills/assistant/morning_briefing.md")),
            "auto-discovery should register skills/assistant/morning_briefing.md; got {:?}",
            skills
                .iter()
                .map(|s| s.source_path.clone())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn default_tool_list_contains_expected_browser_tools() {
        assert_eq!(
            default_tool_names(),
            vec![
                "run_js",
                "run_python",
                "web_search",
                "web_fetch",
                "run_command",
                "fs_read",
                "fs_write",
                "fs_list",
                "file_read",
                "file_write",
                "file_list",
                "file_edit",
                "workspace_open",
                "workspace_close",
                "read_run_output",
                "camera_capture",
                "screen_capture",
                "mic_record",
                "geolocate",
                "clipboard_read",
                "clipboard_write",
                "notify_user",
                "speak_text",
                "device_info",
                "transcribe_audio",
            ]
        );
        assert_eq!(parse_tools("all"), default_tool_names());
    }

    #[test]
    fn parses_agent_tool_allowlist_from_markdown() {
        assert_eq!(
            parse_tools("calculator, file_read, web_search"),
            vec!["calculator", "file_read", "web_search"]
        );
        assert_eq!(
            parse_tools(" calculator , calculator , file-read "),
            vec!["calculator"]
        );
    }

    #[test]
    fn agent_markdown_parses_strategy_key() {
        let agent = agent_from_markdown(
            "agents/orchestrator.md",
            "---\nid: orchestrator\nname: Orchestrator\nenabled: true\ntools: all\nstrategy: orchestrate\n---\n\nOrchestrate tasks.",
        )
        .unwrap();

        assert_eq!(agent.strategy_id, Some("orchestrate".to_string()));
    }

    #[test]
    fn agent_markdown_without_strategy_defaults_to_none() {
        let agent = agent_from_markdown(
            "agents/plain.md",
            "---\nid: plain\nname: Plain\nenabled: true\ntools: all\n---\n\nDo work.",
        )
        .unwrap();

        assert_eq!(agent.strategy_id, None);
    }

    #[test]
    fn agent_markdown_round_trips_strategy() {
        // Agent with a strategy_id survives a serialize → parse round-trip.
        let mut agent = Agent::new("Round Tripper", "Do the round trip.", default_tool_names());
        agent.strategy_id = Some("plan-act-review".to_string());

        let md = agent_to_markdown(&agent);
        assert!(md.contains("strategy: plan-act-review"));

        let path = format!("agents/{}.md", slugify(&agent.name));
        let parsed = agent_from_markdown(&path, &md).unwrap();
        assert_eq!(parsed.strategy_id, Some("plan-act-review".to_string()));

        // Agent with strategy_id == None round-trips to None, with no `strategy:` line.
        let mut agent_none = Agent::new("No Strategy", "Just work.", default_tool_names());
        agent_none.strategy_id = None;

        let md_none = agent_to_markdown(&agent_none);
        assert!(!md_none.contains("strategy:"));

        let path_none = format!("agents/{}.md", slugify(&agent_none.name));
        let parsed_none = agent_from_markdown(&path_none, &md_none).unwrap();
        assert_eq!(parsed_none.strategy_id, None);
    }

    // --- agent.md-declared phases (flat keys) → DeclaredPhase list. ---

    const DECLARED_AGENT_MD: &str = "---\nid: coder\nname: Coder\nenabled: true\ntools: all\n\
phase.1.name: plan\n\
phase.1.header: PLAN phase: gather context and produce a concrete plan.\n\
phase.1.response_kind: plan\n\
phase.1.tools: file_read, file_list\n\
phase.1.loop: one_shot\n\
phase.2.name: execute\n\
phase.2.response_kind: react\n\
phase.2.tools: file_read, file_write, file_edit, run_command\n\
phase.2.loop: loop\n\
phase.3.name: verify\n\
phase.3.response_kind: critique\n\
phase.3.tools: run_command\n\
phase.3.gate: true\n\
phase.3.on_fail: plan\n\
---\n\nDo coding work.";

    #[test]
    fn agent_markdown_parses_flat_declared_phases() {
        let agent = agent_from_markdown("agents/coder.md", DECLARED_AGENT_MD).unwrap();
        let phases = agent.phases.expect("phases should be Some");
        assert_eq!(phases.len(), 3);

        assert_eq!(
            phases[0],
            DeclaredPhase {
                name: "plan".into(),
                header: "PLAN phase: gather context and produce a concrete plan.".into(),
                response_kind: Some("plan".into()),
                tools: vec!["file_read".into(), "file_list".into()],
                looped: false,
                gate: false,
                on_fail: None,
            }
        );
        assert_eq!(
            phases[1],
            DeclaredPhase {
                name: "execute".into(),
                header: String::new(),
                response_kind: Some("react".into()),
                tools: vec![
                    "file_read".into(),
                    "file_write".into(),
                    "file_edit".into(),
                    "run_command".into(),
                ],
                looped: true,
                gate: false,
                on_fail: None,
            }
        );
        assert_eq!(
            phases[2],
            DeclaredPhase {
                name: "verify".into(),
                header: String::new(),
                response_kind: Some("critique".into()),
                tools: vec!["run_command".into()],
                looped: false,
                gate: true,
                on_fail: Some("plan".into()),
            }
        );
    }

    #[test]
    fn agent_without_phase_keys_has_none_phases() {
        let agent = agent_from_markdown(
            "agents/plain.md",
            "---\nid: plain\nname: Plain\ntools: all\n---\n\nWork.",
        )
        .unwrap();
        assert_eq!(agent.phases, None);
    }

    #[test]
    fn declared_phases_round_trip_through_markdown() {
        let agent = agent_from_markdown("agents/coder.md", DECLARED_AGENT_MD).unwrap();
        let md = agent_to_markdown(&agent);
        // The flat keys survive serialization.
        assert!(md.contains("phase.1.name: plan"));
        assert!(md.contains("phase.3.gate: true"));
        assert!(md.contains("phase.3.on_fail: plan"));
        assert!(md.contains("phase.2.loop: loop"));

        let reparsed = agent_from_markdown("agents/coder.md", &md).unwrap();
        assert_eq!(reparsed.phases, agent.phases);
    }

    #[test]
    fn declared_phases_build_a_runtime_strategy() {
        use crate::strategy::{DeclaredStrategy, Strategy};
        let agent = agent_from_markdown("agents/coder.md", DECLARED_AGENT_MD).unwrap();
        let declared = agent.phases.clone().unwrap();
        let strategy = DeclaredStrategy::from_declared(agent.id.clone(), &declared);
        assert_eq!(strategy.phases().len(), 3);
        assert_eq!(strategy.gate_phase(), Some(2));
    }

    // --- Declared-phase validation. ---

    fn declared_agent(id: &str, phases: Vec<DeclaredPhase>) -> Agent {
        let mut agent = Agent::new(id, "Do work.", default_tool_names());
        agent.id = id.to_string();
        agent.phases = Some(phases);
        agent
    }

    fn phase(name: &str, gate: bool, on_fail: Option<&str>) -> DeclaredPhase {
        DeclaredPhase {
            name: name.into(),
            header: String::new(),
            response_kind: None,
            tools: vec![],
            looped: false,
            gate,
            on_fail: on_fail.map(str::to_string),
        }
    }

    #[test]
    fn valid_declared_phases_pass_validation() {
        let snapshot = AppSnapshot::default();
        let agent = declared_agent(
            "coder",
            vec![
                phase("plan", false, None),
                phase("execute", false, None),
                phase("verify", true, Some("plan")),
            ],
        );
        assert_eq!(validate_agent_refs(&agent, &snapshot), Ok(()));
    }

    #[test]
    fn validation_rejects_bad_on_fail_target() {
        let snapshot = AppSnapshot::default();
        let agent = declared_agent(
            "coder",
            vec![
                phase("plan", false, None),
                phase("verify", true, Some("nope")),
            ],
        );
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert!(
            errors
                .iter()
                .any(|e| matches!(e, RefError::Phases { detail, .. } if detail.contains("nope"))),
            "got: {errors:?}"
        );
    }

    #[test]
    fn validation_rejects_two_gates() {
        let snapshot = AppSnapshot::default();
        let agent = declared_agent(
            "coder",
            vec![phase("a", true, None), phase("b", true, None)],
        );
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert!(
            errors.iter().any(
                |e| matches!(e, RefError::Phases { detail, .. } if detail.contains("at most one"))
            ),
            "got: {errors:?}"
        );
    }

    #[test]
    fn validation_rejects_duplicate_phase_name() {
        let snapshot = AppSnapshot::default();
        let agent = declared_agent(
            "coder",
            vec![phase("plan", false, None), phase("plan", true, None)],
        );
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert!(
            errors.iter().any(
                |e| matches!(e, RefError::Phases { detail, .. } if detail.contains("duplicate"))
            ),
            "got: {errors:?}"
        );
    }

    #[test]
    fn validation_rejects_both_phases_and_strategy_id() {
        let snapshot = AppSnapshot::default();
        let mut agent = declared_agent("coder", vec![phase("only", true, None)]);
        agent.strategy_id = Some("react".to_string());
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert!(
            errors.iter().any(|e| matches!(
                e,
                RefError::Phases { detail, .. } if detail.contains("both `phases` and `strategy_id`")
            )),
            "got: {errors:?}"
        );
    }

    #[test]
    fn validation_warns_on_unknown_tool_and_response_kind() {
        let snapshot = AppSnapshot::default();
        let mut p = phase("verify", true, None);
        p.tools = vec!["definitely_not_a_tool".into()];
        p.response_kind = Some("nonsense_kind".into());
        let agent = declared_agent("coder", vec![p]);
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert!(
            errors.iter().any(|e| matches!(
                e,
                RefError::Phases { detail, .. } if detail.contains("warning") && detail.contains("definitely_not_a_tool")
            )),
            "got: {errors:?}"
        );
        assert!(
            errors.iter().any(|e| matches!(
                e,
                RefError::Phases { detail, .. } if detail.contains("warning") && detail.contains("nonsense_kind")
            )),
            "got: {errors:?}"
        );
    }

    // --- Panic-hardening: malformed agent/skill markdown must error gracefully or
    // parse, never panic. Each case is a shape a hand-edited or corrupt `.md` can
    // take (empty, no frontmatter, no body, truncated `---`, weird unicode, huge
    // field). The parsers are iterator/`split_once`-based, so these are guard tests
    // that lock in the no-trap behavior. ---

    #[test]
    fn empty_agent_file_errors_without_panicking() {
        // No body at all → graceful "no prompt body" error, not a panic.
        let err = agent_from_markdown("agents/empty.md", "").unwrap_err();
        assert!(err.contains("does not contain a prompt body"), "got: {err}");
    }

    #[test]
    fn agent_file_with_no_frontmatter_uses_body_as_role() {
        // No leading `---`: the whole text is the body, path drives the id.
        let agent = agent_from_markdown("agents/plain-note.md", "Just a prompt body.").unwrap();
        assert_eq!(agent.id, "plain-note");
        assert_eq!(agent.role, "Just a prompt body.");
        // No frontmatter → defaults: enabled, full tool set, default format.
        assert!(agent.enabled);
        assert_eq!(agent.enabled_tools, default_tool_names());
    }

    #[test]
    fn agent_file_with_frontmatter_but_no_body_errors() {
        // Closed frontmatter, nothing after it → graceful error.
        let err = agent_from_markdown(
            "agents/headless.md",
            "---\nid: headless\nname: Headless\n---\n",
        )
        .unwrap_err();
        assert!(err.contains("does not contain a prompt body"), "got: {err}");
    }

    #[test]
    fn agent_file_with_unterminated_frontmatter_does_not_panic() {
        // Opening `---` but no closing fence: every line stays "in meta", so the body
        // is empty → graceful error rather than an index-out-of-bounds trap.
        let err = agent_from_markdown(
            "agents/truncated.md",
            "---\nid: trunc\nname: Trunc\nrole text",
        )
        .unwrap_err();
        assert!(err.contains("does not contain a prompt body"), "got: {err}");
    }

    #[test]
    fn agent_file_with_weird_unicode_parses_without_panicking() {
        // Multi-byte unicode in id/name/body must not break char-boundary handling.
        let agent = agent_from_markdown(
            "agents/emoji.md",
            "---\nid: 日本語\nname: 🦀 Crab Agent 🦀\n---\n\nДелай работу. 🚀",
        )
        .unwrap();
        // Non-ascii id slugifies to a fresh uuid (no ascii-alphanumeric survives), but
        // the call must not panic and must yield a usable agent.
        assert!(!agent.id.is_empty());
        assert_eq!(agent.name, "🦀 Crab Agent 🦀");
        assert_eq!(agent.role, "Делай работу. 🚀");
    }

    #[test]
    fn agent_file_with_huge_field_does_not_panic() {
        // A pathologically long name should be carried verbatim, no overflow/slice trap.
        let huge = "x".repeat(100_000);
        let content = format!("---\nid: big\nname: {huge}\n---\n\nBody.");
        let agent = agent_from_markdown("agents/big.md", &content).unwrap();
        assert_eq!(agent.name.len(), 100_000);
    }

    #[test]
    fn frontmatter_line_without_colon_is_skipped_not_a_panic() {
        // A bare line inside the frontmatter (no `key: value`) is ignored, not indexed.
        let agent = agent_from_markdown(
            "agents/loose.md",
            "---\nid: loose\nthis line has no colon\nname: Loose\n---\n\nWork.",
        )
        .unwrap();
        assert_eq!(agent.id, "loose");
        assert_eq!(agent.name, "Loose");
    }

    #[test]
    fn empty_skill_file_errors_without_panicking() {
        let err = skill_from_markdown("skills/x/SKILL.md", "").unwrap_err();
        assert!(err.contains("does not contain a body"), "got: {err}");
    }

    #[test]
    fn skill_file_with_frontmatter_but_no_body_errors() {
        let err =
            skill_from_markdown("skills/x/SKILL.md", "---\nid: x\nname: X\n---\n").unwrap_err();
        assert!(err.contains("does not contain a body"), "got: {err}");
    }

    #[test]
    fn parse_tools_on_garbage_yields_default_set_not_panic() {
        // Empty, all-punctuation, and unicode tokens all degrade to the default set
        // (every candidate is filtered out) rather than panicking.
        assert_eq!(parse_tools(""), default_tool_names());
        assert_eq!(parse_tools(" , , "), default_tool_names());
        assert_eq!(parse_tools("日本語, 🦀"), default_tool_names());
    }

    // --- Load-time reference validator. ---

    fn agent_with(id: &str, tools: Vec<String>) -> Agent {
        let mut agent = Agent::new(id, "Do work.", tools);
        agent.id = id.to_string();
        agent
    }

    #[test]
    fn team_member_derives_team_order_and_namespaced_id() {
        let agent =
            agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan the work.")
                .expect("parse team member");
        assert_eq!(agent.team.as_deref(), Some("coder"));
        assert_eq!(agent.order, 1);
        // Namespaced so it never collides with a flat `agents/2_planner.md`.
        assert_eq!(agent.id, "coder-planner");
        // Display name stays the bare role, not the namespaced id.
        assert_eq!(agent.name, "Planner");
    }

    #[test]
    fn flat_agent_has_no_team() {
        let agent =
            agent_from_markdown("agents/1_orchestrator.md", "---\n---\nCoordinate.")
                .expect("parse flat agent");
        assert_eq!(agent.team, None);
        assert_eq!(agent.id, "orchestrator");
    }

    #[test]
    fn teams_groups_members_in_order_and_picks_lead() {
        let agents = vec![
            agent_from_markdown("agents/coder/2_coder.md", "---\n---\nWrite code.").unwrap(),
            agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan.").unwrap(),
            agent_from_markdown(
                "agents/coder/3_verifier.md",
                "---\n---\nVerify the build.",
            )
            .unwrap(),
            // A flat agent is ignored by team grouping.
            agent_from_markdown("agents/1_orchestrator.md", "---\n---\nCoordinate.").unwrap(),
        ];

        let teams = teams(&agents);
        assert_eq!(teams.len(), 1);
        let coder = &teams[0];
        assert_eq!(coder.id, "coder");
        assert_eq!(
            coder.member_ids,
            vec!["coder-planner", "coder-coder", "coder-verifier"]
        );
        // No orchestrator flag set ⇒ lead is the lowest-ordered member.
        assert_eq!(coder.lead_id.as_deref(), Some("coder-planner"));
    }

    #[test]
    fn teams_lead_prefers_orchestrator_flagged_member() {
        let agents = vec![
            agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan.").unwrap(),
            agent_from_markdown(
                "agents/coder/2_coder.md",
                "---\norchestrator: true\n---\nWrite code.",
            )
            .unwrap(),
        ];

        let teams = teams(&agents);
        assert_eq!(teams[0].lead_id.as_deref(), Some("coder-coder"));
    }

    #[test]
    fn bundled_coder_team_is_discovered_from_disk() {
        // The `agents/coder/` folder ships three ordered members; teams() must see them
        // grouped, in order, with no count hardcoded anywhere.
        let agents = default_agents();
        let coder = teams(&agents)
            .into_iter()
            .find(|team| team.id == "coder")
            .expect("bundled coder team discovered from agents/coder/");
        assert_eq!(
            coder.member_ids,
            vec!["coder-planner", "coder-coder", "coder-verifier"]
        );
        assert_eq!(coder.lead_id.as_deref(), Some("coder-planner"));
    }

    #[test]
    fn valid_agent_passes_ref_validation() {
        let snapshot = AppSnapshot::default();
        // Every default-bundled agent must validate cleanly against the default snapshot.
        for agent in &snapshot.agents {
            assert_eq!(
                validate_agent_refs(agent, &snapshot),
                Ok(()),
                "default agent {} should validate",
                agent.id
            );
        }
    }

    #[test]
    fn bundled_assistant_with_integration_tools_validates() {
        // The assistant agent (not in DEFAULT_AGENT_FILES) names integration tools
        // outside `default_tool_names()` — gmail_search, gcal_events, telegram_send,
        // manage_schedule. These are real registered tools, so the agent must validate
        // clean (the `known_tool_names()` set covers them).
        let assistant = agent_from_markdown(
            "agents/4_assistant.md",
            include_str!("../../agents/4_assistant.md"),
        )
        .unwrap();
        let snapshot = AppSnapshot::default();
        assert_eq!(validate_agent_refs(&assistant, &snapshot), Ok(()));
    }

    #[test]
    fn orchestrator_call_agent_tool_is_known() {
        // Regression: the orchestrator's `call_agent` delegation tool is not in
        // `default_tool_names()` but is a real registered tool, so it must be in the
        // validator's known set (else a bundled agent false-positives).
        assert!(known_tool_names().iter().any(|t| t == "call_agent"));
        // And the default allowlist is a subset of the known set.
        for tool in default_tool_names() {
            assert!(
                known_tool_names().iter().any(|known| known == &tool),
                "default tool {tool} missing from known set"
            );
        }
    }

    #[test]
    fn known_tool_names_matches_registered_tools() {
        // Drift guard: the validator's known-tool set must stay a subset of the tools
        // actually registered in `crate::tools::ToolRegistry`. If a name here is not
        // registered, the validator would wave through a tool that does not exist; if a
        // bundled agent later references a newly registered tool, this test (plus the
        // agent-validation tests above) flags the omission. `demo_tool` is test-only and
        // never registered in the real table, so it cannot leak in here.
        let registry = crate::tools::ToolRegistry::new();
        for name in known_tool_names() {
            assert!(
                registry.descriptor(&name).is_some(),
                "known_tool_names lists '{name}' but it is not a registered tool"
            );
        }
    }

    #[test]
    fn unknown_tool_is_reported() {
        let snapshot = AppSnapshot::default();
        let agent = agent_with(
            "toolbad",
            vec!["web_search".to_string(), "no_such_tool".to_string()],
        );
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert_eq!(
            errors,
            vec![RefError::Tool {
                agent: agent.name.clone(),
                tool: "no_such_tool".to_string(),
            }]
        );
        assert!(
            errors[0]
                .to_string()
                .contains("unknown tool 'no_such_tool'")
        );
    }

    #[test]
    fn unknown_strategy_is_reported() {
        let snapshot = AppSnapshot::default();
        let mut agent = agent_with("stratbad", default_tool_names());
        agent.strategy_id = Some("no-such-strategy".to_string());
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert_eq!(
            errors,
            vec![RefError::Strategy {
                agent: agent.name.clone(),
                strategy: "no-such-strategy".to_string(),
            }]
        );
        // A real registered strategy validates fine.
        agent.strategy_id = Some("orchestrate".to_string());
        assert_eq!(validate_agent_refs(&agent, &snapshot), Ok(()));
    }

    #[test]
    fn unknown_workflow_is_reported() {
        let snapshot = AppSnapshot::default();
        let mut agent = agent_with("wfbad", default_tool_names());
        agent.workflow_id = Some("no-such-workflow".to_string());
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert_eq!(
            errors,
            vec![RefError::Workflow {
                agent: agent.name.clone(),
                workflow: "no-such-workflow".to_string(),
            }]
        );
        // The bundled default workflow id validates fine.
        agent.workflow_id = Some("orchestrate_phases".to_string());
        assert_eq!(validate_agent_refs(&agent, &snapshot), Ok(()));
    }

    #[test]
    fn multiple_problems_are_all_collected() {
        // Validation collects every problem in one pass, not just the first.
        let snapshot = AppSnapshot::default();
        let mut agent = agent_with("messy", vec!["bogus_tool".to_string()]);
        agent.strategy_id = Some("bogus-strategy".to_string());
        agent.workflow_id = Some("bogus-workflow".to_string());
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert_eq!(errors.len(), 3, "got: {errors:?}");
        assert!(errors.iter().any(|e| matches!(e, RefError::Tool { .. })));
        assert!(
            errors
                .iter()
                .any(|e| matches!(e, RefError::Strategy { .. }))
        );
        assert!(
            errors
                .iter()
                .any(|e| matches!(e, RefError::Workflow { .. }))
        );
    }

    #[test]
    fn blank_strategy_and_workflow_are_ignored() {
        // Empty/whitespace strategy or workflow ids are "unset", not invalid refs.
        let snapshot = AppSnapshot::default();
        let mut agent = agent_with("blanks", default_tool_names());
        agent.strategy_id = Some("   ".to_string());
        agent.workflow_id = Some(String::new());
        assert_eq!(validate_agent_refs(&agent, &snapshot), Ok(()));
    }

    #[test]
    fn resolvable_agent_peer_tool_passes_validation() {
        // An `agent_<slug>` peer tool that resolves to an enabled roster agent is a
        // valid (determinable) sub-agent reference — not flagged as an unknown tool.
        let mut snapshot = AppSnapshot::default();
        let peer = Agent::new("Researcher", "Research.", default_tool_names());
        snapshot.agents.push(peer); // enabled by default via Agent::new
        let agent = agent_with("boss", vec!["agent_researcher".to_string()]);
        assert_eq!(validate_agent_refs(&agent, &snapshot), Ok(()));
    }

    #[test]
    fn unresolvable_agent_peer_tool_is_reported_as_sub_agent() {
        // An `agent_<slug>` peer tool that resolves to no enabled agent is a sub-agent
        // reference problem, reported under its slug — never a plain unknown-tool error.
        let snapshot = AppSnapshot::default();
        let agent = agent_with("boss", vec!["agent_ghost".to_string()]);
        let errors = validate_agent_refs(&agent, &snapshot).unwrap_err();
        assert_eq!(
            errors,
            vec![RefError::SubAgent {
                agent: agent.name.clone(),
                sub_agent: "ghost".to_string(),
            }]
        );
        assert!(errors[0].to_string().contains("unknown sub-agent 'ghost'"));
    }

    #[test]
    fn agent_tool_entries_are_validated_as_sub_agents() {
        // Pins the convention: the local AGENT_TOOL_PREFIX must agree with
        // `crate::tools::agent_tools` — an `agent_<slug>` name is routed to the
        // sub-agent check (and resolves through the same machinery the runtime uses),
        // never to `known_tool_names`.
        let mut snapshot = AppSnapshot::default();
        let peer = Agent::new("Synthesizer", "Synthesize.", default_tool_names());
        snapshot.agents.push(peer);
        let tool = format!("{AGENT_TOOL_PREFIX}synthesizer");
        assert!(crate::tools::agent_tools::resolve(&snapshot, &tool).is_some());
        let agent = agent_with("boss", vec![tool]);
        assert_eq!(validate_agent_refs(&agent, &snapshot), Ok(()));
    }

    #[test]
    fn ref_error_display_covers_every_variant() {
        // Exercises Display for all four variants so the rendered text is locked in.
        let unknown_sub = RefError::SubAgent {
            agent: "boss".to_string(),
            sub_agent: "ghost".to_string(),
        };
        assert_eq!(
            unknown_sub.to_string(),
            "agent 'boss' references unknown sub-agent 'ghost'"
        );
        assert_eq!(
            RefError::Tool {
                agent: "a".to_string(),
                tool: "t".to_string(),
            }
            .to_string(),
            "agent 'a' references unknown tool 't'"
        );
        assert_eq!(
            RefError::Strategy {
                agent: "a".to_string(),
                strategy: "s".to_string(),
            }
            .to_string(),
            "agent 'a' references unknown strategy 's'"
        );
        assert_eq!(
            RefError::Workflow {
                agent: "a".to_string(),
                workflow: "w".to_string(),
            }
            .to_string(),
            "agent 'a' references unknown workflow 'w'"
        );
    }

    #[test]
    fn coder_agent_md_declares_a_three_phase_gated_strategy() {
        use crate::strategy::{DeclaredStrategy, Strategy};

        // Load the shipped coder agent (embedded via include_str!) and assert its
        // flat-key phases parse into the plan → execute → verify shape the
        // anti-shortcut coder relies on.
        let content = include_str!("../../agents/3_coder.md");
        let agent = agent_from_markdown("agents/3_coder.md", content).expect("coder.md must parse");

        let phases = agent
            .phases
            .as_deref()
            .expect("coder declares phases (not a legacy strategy_id agent)");
        assert_eq!(phases.len(), 3, "plan, execute, verify");
        assert_eq!(phases[0].name, "plan");
        assert_eq!(phases[1].name, "execute");
        assert_eq!(phases[2].name, "verify");

        // The verify phase is the sole exit gate and bounces failures back to plan.
        assert!(phases[2].gate, "verify is the gate");
        assert!(!phases[0].gate && !phases[1].gate);
        assert_eq!(phases[2].on_fail.as_deref(), Some("plan"));
        // Verify can read the live run output as evidence (Commit 3 surface).
        assert!(
            phases[2].tools.iter().any(|t| t == "read_run_output"),
            "verify phase must be able to read the captured run output"
        );

        // Declaring phases means no strategy_id (the XOR the validator enforces).
        assert!(agent.strategy_id.is_none());

        // Lowering to a runtime strategy resolves the gate index and the on_fail
        // target by name → index.
        let strategy = DeclaredStrategy::from_declared(agent.id.clone(), phases);
        assert_eq!(strategy.phases().len(), 3);
        assert_eq!(strategy.gate_phase(), Some(2));
        // verify uses the critique contract; execute loops; plan is one-shot.
        assert_eq!(
            strategy.phases()[2].response_kind,
            crate::responses::ResponseKind::Critique
        );
        assert_eq!(
            strategy.phases()[0].response_kind,
            crate::responses::ResponseKind::Plan
        );

        // The agent passes reference validation against a default snapshot (every
        // declared tool is registered; the gate/on_fail wiring is sound).
        let snapshot = AppSnapshot::default();
        assert_eq!(
            validate_agent_refs(&agent, &snapshot),
            Ok(()),
            "coder.md must validate cleanly — all phase tools registered, gate wiring sound"
        );
    }
}
