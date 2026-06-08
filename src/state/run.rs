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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerificationState {
    #[serde(default)]
    pub spec: VerificationSpec,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub status: String,
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
            status: "pending".to_string(),
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunArtifact {
    pub id: String,
    pub name: String,
    pub artifact_type: String,
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkerRun {
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub sub_goal: String,
    pub status: String,
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
    pub status: String,
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
    pub status: String,
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

pub fn default_orchestrator_workflow_id() -> Option<String> {
    Some("parallel_batch".to_string())
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
