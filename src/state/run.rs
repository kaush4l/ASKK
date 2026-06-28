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

/// A run's stable identity, as a newtype over the `String` id every [`AgentRun`]
/// already carries. It exists so the fleet can address an engine instance by id
/// (interrupt/pause/resume/keyed lookup) with a type the compiler keeps distinct
/// from every other `String`. It serializes transparently as that string, so an
/// `AgentRun.id` stays round-trippable through the legacy wire format unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(transparent)]
pub struct RunId(pub String);

impl RunId {
    /// Borrow the id as a string slice (the inner `String`). A convenience the
    /// fleet units lean on; `AsRef<str>` already covers the generic case, so this
    /// is allowed dead until those callers land.
    #[allow(dead_code)]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for RunId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for RunId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl AsRef<str> for RunId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for RunId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
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
    /// The run ended without its strategy's verifier **gate** passing — it is *not* a
    /// success. Reached on a loop fall-off with an unpassed gate or an exhausted
    /// back-edge budget on the gate. Carries no fabricated final answer.
    Unverified,
    Error,
    Interrupted,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Complete => "complete",
            Self::Unverified => "unverified",
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
            Self::Complete | Self::Unverified | Self::Error | Self::Interrupted => true,
            Self::Running | Self::Paused => false,
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
    /// Captured terminal/process output (the tail of a live run's stdout). Rendered
    /// as monospace text; distinct from `Text` so the gallery can label it and the
    /// verify phase can recognize it as run evidence.
    LiveOutput,
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
            "liveoutput" | "live_output" => Self::LiveOutput,
            _ => Self::Text,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Html => "html",
            Self::Json => "json",
            Self::LiveOutput => "liveoutput",
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

/// Union-append `incoming` artifacts into `target`, keyed by [`RunArtifact::id`].
///
/// Unlike [`merge_agent_memories`](crate::state::merge_agent_memories), which
/// upserts (last-write-wins per `agent_id`), artifacts accumulate: each capture
/// is a distinct event the user should keep seeing, so an id already present is
/// skipped rather than overwritten and a new id is appended in arrival order.
/// The engine uses this to fold tool-side artifact appends — produced on a
/// tool's own snapshot clone — back into the authoritative in-flight run.
pub fn merge_artifacts(target: &mut Vec<RunArtifact>, incoming: Vec<RunArtifact>) {
    for artifact in incoming {
        if target.iter().any(|existing| existing.id == artifact.id) {
            continue;
        }
        target.push(artifact);
    }
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
    Unverified,
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
            Self::Unverified => "unverified",
            Self::Error => "error",
            Self::Interrupted => "interrupted",
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
            RunStatus::Unverified => Self::Unverified,
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
    /// The assistant's reply forming live, mid-generation — the parsed partial
    /// answer text from the streaming parser. `Some` while a model turn streams,
    /// cleared when the full response lands. The UI renders it as the in-progress
    /// bubble; it is transient and not part of the durable transcript.
    #[serde(default)]
    pub streaming: Option<String>,
    /// The agent's live workspace view: which files it has opened, which one it is
    /// focused on, and the explorer root. The single shared source of truth (Option
    /// A) for both the `## WORKSPACE` prompt block and the user's workspace IDE —
    /// a file the agent opens via `workspace_open` rides this into the prompt AND
    /// surfaces as a tab in the IDE. The open-set is path *references* (not file
    /// content): the content is pulled fresh from OPFS at render/render-time, so
    /// this stays small and never goes stale.
    #[serde(default)]
    pub workspace: WorkspaceView,
}

/// The agent's view of its workspace: the set of files it has open, the one it is
/// focused on, and the explorer root. A shared, run-scoped projection (it rides
/// [`RunScratchpad`] inside the [`AgentRun`]) that is the single source of truth for
/// both the prompt's `## WORKSPACE` block and the user's IDE tabs/explorer.
///
/// It stores only path *references* (relative, `/`-separated, matching
/// [`crate::storage::opfs_vfs::OpfsVfs`]), never file content: the content is
/// projected by reference — read fresh from OPFS when the block is rendered — so an
/// edit the agent makes between turns is always reflected and the run state stays
/// compact.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct WorkspaceView {
    /// The open files, as workspace-relative paths, in the order they were opened.
    #[serde(default)]
    pub open_files: Vec<String>,
    /// The file the agent is currently focused on — the tab the IDE shows. `None`
    /// when nothing is open. Always one of `open_files` when set.
    #[serde(default)]
    pub active_file: Option<String>,
    /// The explorer root the tree renders from. Empty = the workspace root.
    #[serde(default)]
    pub root: String,
}

impl WorkspaceView {
    /// `true` when no files are open and the root is the default — the state that
    /// omits the `## WORKSPACE` block entirely (prompt byte-parity for non-coder runs).
    pub fn is_empty(&self) -> bool {
        self.open_files.is_empty() && self.root.is_empty()
    }

    /// Open `path` (idempotent) and focus it. Returns `true` when the open-set or
    /// active file actually changed, so the caller can skip emitting a no-op delta.
    pub fn open(&mut self, path: &str) -> bool {
        let already_open = self.open_files.iter().any(|p| p == path);
        let was_active = self.active_file.as_deref() == Some(path);
        if !already_open {
            self.open_files.push(path.to_string());
        }
        self.active_file = Some(path.to_string());
        !already_open || !was_active
    }

    /// Close `path`. Refocuses the active file onto the next open tab (the neighbor,
    /// then the last) or `None` when the set empties — mirroring the IDE's close
    /// behavior. Returns `true` when anything changed.
    pub fn close(&mut self, path: &str) -> bool {
        let Some(index) = self.open_files.iter().position(|p| p == path) else {
            return false;
        };
        self.open_files.remove(index);
        if self.active_file.as_deref() == Some(path) {
            self.active_file = self
                .open_files
                .get(index.min(self.open_files.len().saturating_sub(1)))
                .cloned();
        }
        true
    }

    /// Fold one parallel tool call's resulting view onto `self`, the accumulator
    /// across a dispatch batch. `call_view` is the open-set a single
    /// `workspace_open`/`workspace_close` produced from the shared `baseline`; this
    /// adds the paths it opened and removes the ones it closed (both diffed against
    /// `baseline`), so sibling calls in one assistant turn all survive instead of the
    /// last one's whole-view replacing the rest. Focus follows the call that set one
    /// (healing a dangling focus when its file was closed) — the same union-merge
    /// discipline [`merge_artifacts`] gives the artifact lift.
    pub fn fold_parallel_change(&mut self, baseline: &WorkspaceView, call_view: &WorkspaceView) {
        // Opens: paths in the call's view the baseline lacked (and self lacks too).
        for path in &call_view.open_files {
            let new_open = !baseline.open_files.iter().any(|p| p == path);
            if new_open && !self.open_files.iter().any(|p| p == path) {
                self.open_files.push(path.clone());
            }
        }
        // Closes: paths the baseline had that this call dropped.
        for path in &baseline.open_files {
            if !call_view.open_files.iter().any(|p| p == path) {
                self.open_files.retain(|p| p != path);
            }
        }
        // Focus follows this call. If it points outside the merged open-set (its file
        // was closed), heal onto the last remaining tab, mirroring `close`.
        self.active_file = call_view.active_file.clone();
        if let Some(active) = self.active_file.clone()
            && !self.open_files.iter().any(|p| p == &active)
        {
            self.active_file = self.open_files.last().cloned();
        }
        self.root = call_view.root.clone();
    }
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
    /// Retained for serde back-compat and future dispatch capping; since the bespoke
    /// orchestrator's removal nothing reads it — parallel tool fan-out is uncapped join_all.
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

    // Two `workspace_open` calls in one assistant turn dispatch in parallel, each
    // diffing the same (empty) baseline. Folding their views must keep BOTH opens —
    // the bug a whole-view last-writer-wins replace would reintroduce.
    #[test]
    fn parallel_opens_in_one_batch_both_survive_the_fold() {
        let baseline = WorkspaceView::default();
        let mut merged = baseline.clone();

        let mut call_a = baseline.clone();
        call_a.open("a.rs");
        let mut call_b = baseline.clone();
        call_b.open("b.rs");

        merged.fold_parallel_change(&baseline, &call_a);
        merged.fold_parallel_change(&baseline, &call_b);

        assert_eq!(
            merged.open_files,
            vec!["a.rs".to_string(), "b.rs".to_string()]
        );
        assert_eq!(merged.active_file.as_deref(), Some("b.rs"));
    }

    // A parallel close composes with the rest of the batch and heals focus when the
    // closed file was the active one.
    #[test]
    fn parallel_close_removes_only_its_target_and_heals_focus() {
        let mut baseline = WorkspaceView::default();
        for p in ["a.rs", "b.rs", "c.rs"] {
            baseline.open(p); // baseline = [a,b,c], active c
        }
        let mut merged = baseline.clone();

        // One call opens d.rs; a sibling closes the active c.rs.
        let mut opener = baseline.clone();
        opener.open("d.rs");
        let mut closer = baseline.clone();
        closer.close("c.rs"); // active heals to b.rs inside the clone

        merged.fold_parallel_change(&baseline, &opener);
        merged.fold_parallel_change(&baseline, &closer);

        assert_eq!(
            merged.open_files,
            vec!["a.rs".to_string(), "b.rs".to_string(), "d.rs".to_string()],
            "the opener's d.rs survives and only the closer's c.rs is removed"
        );
        // Focus is the closer's healed active (b.rs), still open in the merged set.
        assert_eq!(merged.active_file.as_deref(), Some("b.rs"));
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

    fn artifact(id: &str) -> RunArtifact {
        RunArtifact {
            id: id.to_string(),
            name: format!("artifact {id}"),
            artifact_type: ArtifactKind::Image,
            content: format!("data:{id}"),
        }
    }

    #[test]
    fn merge_artifacts_unions_by_id_and_keeps_order() {
        let mut target = vec![artifact("a")];
        // Two distinct new artifacts append in arrival order; an id already
        // present is skipped (accumulate, never overwrite).
        merge_artifacts(&mut target, vec![artifact("b"), artifact("c")]);
        merge_artifacts(&mut target, vec![artifact("b")]); // duplicate id: no-op
        let ids: Vec<&str> = target.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
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
    fn run_status_terminal_predicate() {
        assert!(RunStatus::Complete.is_terminal());
        assert!(RunStatus::Error.is_terminal());
        assert!(RunStatus::Interrupted.is_terminal());
        assert!(!RunStatus::Running.is_terminal());
        assert!(!RunStatus::Paused.is_terminal());
    }
}
