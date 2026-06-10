//! The run/execution domain: a single [`AgentRun`] and everything inside it — the
//! [`RunLane`] it was routed to, its [`RunScratchpad`] (plan, observations,
//! workers, verification, budgets), the [`RunBudgets`] that bound it, the
//! [`JobRecord`] it checkpoints to, and the [`OrchestratorConfig`] that governs
//! multi-agent runs.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::event::AgentEvent;
use super::tool_types::{ToolCall, ToolResult};
use super::workflow::WorkflowRuntimeState;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum RunLane {
    DirectAnswer,
    SingleAction,
    #[default]
    BoundedTask,
    BackgroundJob,
    Batch,
}

impl RunLane {
    pub fn as_label(self) -> &'static str {
        match self {
            Self::DirectAnswer => "direct answer",
            Self::SingleAction => "single action",
            Self::BoundedTask => "bounded task",
            Self::BackgroundJob => "background job",
            Self::Batch => "batch",
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::DirectAnswer => "direct_answer",
            Self::SingleAction => "single_action",
            Self::BoundedTask => "bounded_task",
            Self::BackgroundJob => "background_job",
            Self::Batch => "batch",
        }
    }
}

/// The lifecycle status of an [`AgentRun`] and the [`JobRecord`] it checkpoints to.
/// Serialized as a lowercase string for IndexedDB back-compat with snapshots that
/// stored the status as plain text.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    #[default]
    Running,
    Paused,
    Complete,
    Error,
    Interrupted,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Complete => "complete",
            Self::Error => "error",
            Self::Interrupted => "interrupted",
        }
    }

    /// True for statuses that end a run's lifecycle — it has finished, failed, or was
    /// interrupted (i.e. it is no longer `Running`/`Paused`). The match is exhaustive
    /// (no wildcard) so a new variant forces a decision here instead of silently
    /// counting as non-terminal.
    pub fn is_terminal(self) -> bool {
        match self {
            Self::Complete | Self::Error | Self::Interrupted => true,
            Self::Running | Self::Paused => false,
        }
    }

    /// True for the terminal statuses that represent a failure rather than a clean
    /// completion. Exhaustive for the same reason as [`Self::is_terminal`].
    pub fn is_failure(self) -> bool {
        match self {
            Self::Error | Self::Interrupted => true,
            Self::Running | Self::Paused | Self::Complete => false,
        }
    }
}

impl std::fmt::Display for RunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationCheckType {
    EvidenceContains,
    ToolResultContains,
    ShellCommand,
    FileExists,
    ContentRegex,
    LlmCritic,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationCheck {
    pub check_type: VerificationCheckType,
    pub description: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct VerificationSpec {
    #[serde(default)]
    pub deterministic_checks: Vec<VerificationCheck>,
    #[serde(default)]
    pub tool_result_checks: Vec<VerificationCheck>,
    #[serde(default)]
    pub llm_critic_checks: Vec<VerificationCheck>,
}

/// The outcome of a run's verification gate. A closed three-state lifecycle;
/// serialized as a lowercase string for IndexedDB back-compat with snapshots that
/// stored it as plain text (mirrors [`RunStatus`]).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VerificationStatus {
    #[default]
    Pending,
    Passed,
    Failed,
}

impl VerificationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Passed => "passed",
            Self::Failed => "failed",
        }
    }
}

impl std::fmt::Display for VerificationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationState {
    #[serde(default)]
    pub spec: VerificationSpec,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub status: VerificationStatus,
    #[serde(default)]
    pub last_result: String,
    #[serde(default)]
    pub failures: Vec<String>,
    #[serde(default)]
    pub last_progress_signature: String,
    #[serde(default)]
    pub no_progress_turns: u32,
}

impl Default for VerificationState {
    fn default() -> Self {
        Self {
            spec: VerificationSpec::default(),
            attempts: 0,
            status: VerificationStatus::Pending,
            last_result: String::new(),
            failures: Vec::new(),
            last_progress_signature: String::new(),
            no_progress_turns: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunBudgets {
    #[serde(default = "default_run_step_budget")]
    pub max_steps: u32,
    #[serde(default = "default_verification_retry_budget")]
    pub max_verification_retries: u32,
    #[serde(default = "default_no_progress_turn_limit")]
    pub max_no_progress_turns: u32,
    #[serde(default)]
    pub steps_used: u32,
    #[serde(default)]
    pub token_budget: u32,
    #[serde(default)]
    pub tokens_used: u32,
    #[serde(default)]
    pub cost_budget_cents: u32,
    #[serde(default)]
    pub cost_used_cents: u32,
}

impl Default for RunBudgets {
    fn default() -> Self {
        Self {
            max_steps: default_run_step_budget(),
            max_verification_retries: default_verification_retry_budget(),
            max_no_progress_turns: default_no_progress_turn_limit(),
            steps_used: 0,
            token_budget: 0,
            tokens_used: 0,
            cost_budget_cents: 0,
            cost_used_cents: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ScratchpadObservation {
    pub id: String,
    pub source: String,
    pub content: String,
    pub created_at: String,
}

/// The render kind of a [`RunArtifact`]. A closed, app-owned set; serialized as a
/// lowercase string for IndexedDB back-compat. Unknown or legacy tags deserialize to
/// `Text` — the same fallback the renderer has always used — so older snapshots, which
/// could carry any free-text `artifact_type`, still load.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Image,
    Html,
    Json,
    #[default]
    Text,
}

impl ArtifactKind {
    /// Parse a (possibly messy or legacy) type tag, folding anything unrecognized to
    /// `Text` — preserving the renderer's long-standing `_ => text` fallback.
    pub fn from_tag(tag: &str) -> Self {
        match tag.trim().to_ascii_lowercase().as_str() {
            "image" => Self::Image,
            "html" => Self::Html,
            "json" => Self::Json,
            _ => Self::Text,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Html => "html",
            Self::Json => "json",
            Self::Text => "text",
        }
    }
}

/// Deserialize `RunArtifact.artifact_type` from its on-disk string via
/// [`ArtifactKind::from_tag`], so an unknown legacy tag folds to `Text` instead of
/// failing the whole snapshot load.
fn deserialize_artifact_kind<'de, D>(deserializer: D) -> Result<ArtifactKind, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let tag = String::deserialize(deserializer)?;
    Ok(ArtifactKind::from_tag(&tag))
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunArtifact {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "deserialize_artifact_kind")]
    pub artifact_type: ArtifactKind,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MetaToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
    #[serde(default)]
    pub result: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct WorkerScratchpad {
    #[serde(default)]
    pub current_plan: Vec<String>,
    #[serde(default)]
    pub observations: Vec<ScratchpadObservation>,
    #[serde(default)]
    pub artifacts: Vec<RunArtifact>,
}

/// The parent orchestrator's view of a child worker's lifecycle. Mirrors
/// [`RunStatus`] plus a `Pending` state for a worker that has been planned but not yet
/// dispatched. Serialized as a lowercase string for IndexedDB back-compat — these are
/// exactly the values the orchestrator persisted as plain text before this enum
/// existed (a distinct concept from the transport-layer `WorkerStatus`).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum WorkerRunStatus {
    #[default]
    Pending,
    Running,
    Paused,
    Complete,
    Error,
    Interrupted,
}

impl WorkerRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Complete => "complete",
            Self::Error => "error",
            Self::Interrupted => "interrupted",
        }
    }

    /// True for the terminal statuses that represent a failed worker (mirrors
    /// [`RunStatus::is_failure`]). Exhaustive so a new variant forces a decision.
    pub fn is_terminal_failure(self) -> bool {
        match self {
            Self::Error | Self::Interrupted => true,
            Self::Pending | Self::Running | Self::Paused | Self::Complete => false,
        }
    }
}

impl std::fmt::Display for WorkerRunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Project a child run's [`RunStatus`] onto the worker-run lifecycle. A running child
/// can never be `Pending`, so the conversion is total over `RunStatus` and exhaustive.
impl From<RunStatus> for WorkerRunStatus {
    fn from(status: RunStatus) -> Self {
        match status {
            RunStatus::Running => Self::Running,
            RunStatus::Paused => Self::Paused,
            RunStatus::Complete => Self::Complete,
            RunStatus::Error => Self::Error,
            RunStatus::Interrupted => Self::Interrupted,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkerRun {
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub sub_goal: String,
    pub status: WorkerRunStatus,
    #[serde(default)]
    pub budget: RunBudgets,
    #[serde(default)]
    pub scratchpad: WorkerScratchpad,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub result: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct RunScratchpad {
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub lane: RunLane,
    #[serde(default)]
    pub current_plan: Vec<String>,
    #[serde(default)]
    pub meta_tool_calls: Vec<MetaToolCall>,
    #[serde(default)]
    pub recent_observations: Vec<ScratchpadObservation>,
    #[serde(default)]
    pub artifacts: Vec<RunArtifact>,
    #[serde(default)]
    pub workers: Vec<WorkerRun>,
    #[serde(default)]
    pub verification: VerificationState,
    #[serde(default)]
    pub workflow: WorkflowRuntimeState,
    #[serde(default)]
    pub budgets: RunBudgets,
    #[serde(default)]
    pub interrupted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JobRecord {
    pub id: String,
    pub goal: String,
    #[serde(default)]
    pub lane: RunLane,
    #[serde(default)]
    pub status: RunStatus,
    #[serde(default)]
    pub progress: String,
    #[serde(default)]
    pub checkpoint: Option<RunScratchpad>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_error: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrchestratorConfig {
    #[serde(default)]
    pub routing_provider_profile_id: Option<String>,
    #[serde(default)]
    pub worker_provider_profile_id: Option<String>,
    #[serde(default = "default_max_parallelism")]
    pub max_parallelism: u32,
    #[serde(default = "default_run_step_budget")]
    pub max_steps: u32,
    #[serde(default = "default_verification_retry_budget")]
    pub verification_retries: u32,
    #[serde(default = "default_no_progress_turn_limit")]
    pub no_progress_turns: u32,
    #[serde(default = "default_orchestrator_workflow_id")]
    pub workflow_id: Option<String>,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            routing_provider_profile_id: None,
            worker_provider_profile_id: None,
            max_parallelism: default_max_parallelism(),
            max_steps: default_run_step_budget(),
            verification_retries: default_verification_retry_budget(),
            no_progress_turns: default_no_progress_turn_limit(),
            workflow_id: default_orchestrator_workflow_id(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AgentRun {
    pub id: String,
    pub goal: String,
    #[serde(default)]
    pub status: RunStatus,
    #[serde(default)]
    pub lane: RunLane,
    #[serde(default)]
    pub scratchpad: RunScratchpad,
    pub messages: Vec<Message>,
    pub events: Vec<AgentEvent>,
    pub tool_calls: Vec<ToolCall>,
    pub tool_results: Vec<ToolResult>,
    pub final_answer: String,
    pub created_at: String,
}

/// The workspace-level orchestrator no longer drives a workflow gate of its own:
/// gating is now per-agent (`Agent.workflow_id` → `snapshot.workflows`), checked at
/// strategy phase boundaries in the engine. Default agents carry no `workflow_id`, so
/// a default single-agent run is never gated. The `OrchestratorConfig.workflow_id`
/// field is retained for serde back-compat with older snapshots only.
pub fn default_orchestrator_workflow_id() -> Option<String> {
    None
}

// These budget defaults seed both the serde defaults here and the orchestrator
// normalizer in `snapshot.rs`, so they are crate-visible.
pub(crate) fn default_max_parallelism() -> u32 {
    3
}

pub(crate) fn default_run_step_budget() -> u32 {
    // Research and coding goals iterate: search → read → synthesize → re-search,
    // or write → run → test → fix. Give the loop enough turns to actually verify
    // before it is forced to stop at the budget.
    24
}

pub(crate) fn default_verification_retry_budget() -> u32 {
    1
}

pub(crate) fn default_no_progress_turn_limit() -> u32 {
    2
}

#[cfg(test)]
mod tests {
    use super::*;

    // RunStatus is persisted to IndexedDB as a lowercase string. These exact strings
    // are the on-disk format of every snapshot written before the enum existed, so a
    // rename here would silently fail to load older runs. Guard the wire format.
    #[test]
    fn run_status_serializes_to_legacy_lowercase_strings() {
        for (status, wire) in [
            (RunStatus::Running, "\"running\""),
            (RunStatus::Paused, "\"paused\""),
            (RunStatus::Complete, "\"complete\""),
            (RunStatus::Error, "\"error\""),
            (RunStatus::Interrupted, "\"interrupted\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), wire);
            assert_eq!(
                serde_json::from_str::<RunStatus>(wire).unwrap(),
                status,
                "old snapshots storing {wire} must still load"
            );
        }
    }

    // WorkerRun.status is persisted to IndexedDB as a lowercase string. Guard the
    // wire format so a rename can't silently fail to load older orchestrated runs.
    #[test]
    fn worker_run_status_serializes_to_legacy_lowercase_strings() {
        for (status, wire) in [
            (WorkerRunStatus::Pending, "\"pending\""),
            (WorkerRunStatus::Running, "\"running\""),
            (WorkerRunStatus::Paused, "\"paused\""),
            (WorkerRunStatus::Complete, "\"complete\""),
            (WorkerRunStatus::Error, "\"error\""),
            (WorkerRunStatus::Interrupted, "\"interrupted\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), wire);
            assert_eq!(
                serde_json::from_str::<WorkerRunStatus>(wire).unwrap(),
                status,
                "old snapshots storing {wire} must still load"
            );
        }
        assert!(WorkerRunStatus::Error.is_terminal_failure());
        assert!(WorkerRunStatus::Interrupted.is_terminal_failure());
        assert!(!WorkerRunStatus::Complete.is_terminal_failure());
        assert!(!WorkerRunStatus::Running.is_terminal_failure());
        assert!(!WorkerRunStatus::Pending.is_terminal_failure());
    }

    // RunArtifact.artifact_type is persisted as a lowercase string and must keep
    // loading older snapshots, including ones carrying an unrecognized tag.
    #[test]
    fn artifact_kind_serializes_lowercase_and_folds_unknown_tags() {
        for (kind, wire) in [
            (ArtifactKind::Image, "\"image\""),
            (ArtifactKind::Html, "\"html\""),
            (ArtifactKind::Json, "\"json\""),
            (ArtifactKind::Text, "\"text\""),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), wire);
        }
        assert_eq!(ArtifactKind::from_tag("IMAGE"), ArtifactKind::Image);
        assert_eq!(ArtifactKind::from_tag("markdown"), ArtifactKind::Text);
        assert_eq!(ArtifactKind::from_tag(""), ArtifactKind::Text);
    }

    #[test]
    fn run_artifact_with_unknown_type_loads_as_text() {
        let known = r#"{"id":"a","name":"n","artifact_type":"image","content":"c"}"#;
        let artifact: RunArtifact = serde_json::from_str(known).unwrap();
        assert_eq!(artifact.artifact_type, ArtifactKind::Image);

        let legacy = r#"{"id":"a","name":"n","artifact_type":"weird-legacy","content":"c"}"#;
        let artifact: RunArtifact = serde_json::from_str(legacy).unwrap();
        assert_eq!(
            artifact.artifact_type,
            ArtifactKind::Text,
            "unknown legacy tags must fold to Text, not fail the load"
        );
    }

    // VerificationState.status is persisted to IndexedDB as a lowercase string. Guard
    // the wire format so a rename can't silently fail to load older runs.
    #[test]
    fn verification_status_serializes_to_legacy_lowercase_strings() {
        for (status, wire) in [
            (VerificationStatus::Pending, "\"pending\""),
            (VerificationStatus::Passed, "\"passed\""),
            (VerificationStatus::Failed, "\"failed\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), wire);
            assert_eq!(
                serde_json::from_str::<VerificationStatus>(wire).unwrap(),
                status,
                "old snapshots storing {wire} must still load"
            );
        }
    }

    // A VerificationState whose `status` key is absent defaults to Pending. This is
    // only reachable from a hand-edited snapshot — the app always serializes the field
    // — and is the intended, consistent default: it already matched the struct-level
    // Default, and it never fails the load. (Before the enum, a missing field defaulted
    // to the empty string.)
    #[test]
    fn verification_state_missing_status_defaults_to_pending() {
        let state: VerificationState = serde_json::from_str("{}").unwrap();
        assert_eq!(state.status, VerificationStatus::Pending);
    }

    #[test]
    fn run_status_terminal_and_failure_predicates() {
        assert!(RunStatus::Complete.is_terminal());
        assert!(RunStatus::Error.is_terminal());
        assert!(RunStatus::Interrupted.is_terminal());
        assert!(!RunStatus::Running.is_terminal());
        assert!(!RunStatus::Paused.is_terminal());

        assert!(RunStatus::Error.is_failure());
        assert!(RunStatus::Interrupted.is_failure());
        assert!(!RunStatus::Complete.is_failure());
        assert!(!RunStatus::Running.is_failure());
        assert!(!RunStatus::Paused.is_failure());
    }
}
