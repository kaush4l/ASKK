use crate::state::{
    Agent, AgentEventKind, AgentRun, AppResult, AppSnapshot, RunBudgets, RunLane, RunScratchpad,
    RunStatus, WorkerRun, default_tool_names, event, now_iso,
};
use crate::worker::client::{run_goal_for_agent_in_worker_or_inline, run_goal_in_worker_or_inline};
use crate::workflow::{WorkflowGate, find_workflow};
use futures_util::future::join_all;
use std::cell::RefCell;
use std::rc::Rc;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChildTask {
    pub id: String,
    pub role: String,
    pub agent_id: Option<String>,
    pub sub_goal: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChildResult {
    pub role: String,
    pub sub_goal: String,
    pub status: String,
    pub answer: String,
}

#[derive(Clone, Debug)]
struct PlannedChildTask {
    task: ChildTask,
    agent: Agent,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WorkerPool {
    max_parallelism: usize,
}

impl WorkerPool {
    fn new(max_parallelism: u32) -> Self {
        Self {
            max_parallelism: (max_parallelism as usize).max(1),
        }
    }

    fn schedule_waves(&self, total_tasks: usize) -> Vec<Vec<usize>> {
        concurrency_waves(total_tasks, self.max_parallelism)
    }
}

pub async fn run_goal_with_orchestrator_or_worker<F>(
    snapshot: AppSnapshot,
    goal: String,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun) + 'static,
{
    let planned = plan_child_tasks(&snapshot, &goal);
    if planned.len() < 2 || snapshot.orchestrator.max_parallelism < 2 {
        return run_goal_in_worker_or_inline(snapshot, goal, observer).await;
    }

    run_orchestrated_goal(snapshot, goal, planned, observer).await
}

async fn run_orchestrated_goal<F>(
    mut snapshot: AppSnapshot,
    goal: String,
    planned: Vec<PlannedChildTask>,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun) + 'static,
{
    let run_id = Uuid::new_v4().to_string();
    let worker_pool = WorkerPool::new(snapshot.orchestrator.max_parallelism);
    let max_parallelism = worker_pool.max_parallelism;
    let mut workflow_gate = snapshot
        .orchestrator
        .workflow_id
        .as_deref()
        .and_then(|workflow_id| find_workflow(&snapshot.workflows, workflow_id))
        .cloned()
        .map(WorkflowGate::new);
    let workflow_state = workflow_gate
        .as_ref()
        .map(WorkflowGate::state)
        .unwrap_or_default();
    let worker_runs = planned
        .iter()
        .map(|planned| WorkerRun {
            id: planned.task.id.clone(),
            role: planned.agent.name.clone(),
            agent_id: Some(planned.agent.id.clone()),
            sub_goal: planned.task.sub_goal.clone(),
            status: "pending".to_string(),
            budget: RunBudgets::default(),
            scratchpad: Default::default(),
            evidence: Vec::new(),
            result: String::new(),
        })
        .collect::<Vec<_>>();

    let parent_run = AgentRun {
        id: run_id.clone(),
        goal: goal.clone(),
        status: RunStatus::Running,
        lane: RunLane::Batch,
        scratchpad: RunScratchpad {
            goal: goal.clone(),
            lane: RunLane::Batch,
            current_plan: planned
                .iter()
                .map(|planned| planned.task.sub_goal.clone())
                .collect(),
            workers: worker_runs,
            budgets: RunBudgets {
                max_steps: snapshot.orchestrator.max_steps.max(1),
                ..RunBudgets::default()
            },
            workflow: workflow_state,
            ..RunScratchpad::default()
        },
        messages: Vec::new(),
        events: vec![
            event(
                &run_id,
                None,
                AgentEventKind::Started,
                "Orchestrator run started",
                format!("Goal: {goal}"),
            ),
            event(
                &run_id,
                None,
                AgentEventKind::Routing,
                "Routing: batch orchestration",
                format!(
                    "Decomposed into {} child agent task(s) with max parallelism {}.",
                    planned.len(),
                    max_parallelism
                ),
            ),
        ],
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: String::new(),
        created_at: now_iso(),
    };

    let parent_cell = Rc::new(RefCell::new(parent_run));
    let observer_cell = Rc::new(RefCell::new(observer));
    emit_parent(&parent_cell, &observer_cell);

    let mut child_results = Vec::new();
    for wave in worker_pool.schedule_waves(planned.len()) {
        if parent_has_terminal_failure(&parent_cell) {
            break;
        }
        apply_workflow_transition(
            &parent_cell,
            &observer_cell,
            &mut workflow_gate,
            "workers_running",
        )?;
        mark_wave_running(&parent_cell, &observer_cell, &planned, &wave);
        let child_futures = wave.into_iter().map(|idx| {
            let planned_child = planned[idx].clone();
            let child_snapshot = snapshot.clone();
            let parent_cell = Rc::clone(&parent_cell);
            let observer_cell = Rc::clone(&observer_cell);
            async move {
                let worker_id = format!("agent-worker-{}", idx + 1);
                let child_id = planned_child.task.id.clone();
                let role = planned_child.agent.name.clone();
                let sub_goal = planned_child.task.sub_goal.clone();
                let progress_child_id = child_id.clone();
                let progress_parent = Rc::clone(&parent_cell);
                let progress_observer = Rc::clone(&observer_cell);
                let result = run_goal_for_agent_in_worker_or_inline(
                    child_snapshot,
                    sub_goal.clone(),
                    planned_child.agent,
                    worker_id,
                    move |child_run| {
                        update_worker_from_child_run(
                            &progress_parent,
                            &progress_observer,
                            &progress_child_id,
                            &child_run,
                        );
                    },
                )
                .await;
                (child_id, role, sub_goal, result)
            }
        });

        let mut stop_after_wave = false;
        let wave_results = join_all(child_futures).await;
        for (child_id, role, sub_goal, result) in wave_results {
            match result {
                Ok(child_snapshot) => {
                    let child_run = child_snapshot.current_run.clone();
                    let status = child_run
                        .as_ref()
                        .map(|run| run.status.to_string())
                        .unwrap_or_else(|| "complete".to_string());
                    let answer = child_run
                        .as_ref()
                        .map(|run| run.final_answer.clone())
                        .unwrap_or_default();
                    if !parent_has_terminal_failure(&parent_cell) {
                        let next_step = if child_status_failed(&status) {
                            stop_after_wave = true;
                            "failed"
                        } else {
                            "workers_joined"
                        };
                        apply_workflow_transition(
                            &parent_cell,
                            &observer_cell,
                            &mut workflow_gate,
                            next_step,
                        )?;
                    }
                    finish_worker(
                        &parent_cell,
                        &observer_cell,
                        &child_id,
                        &status,
                        &answer,
                        child_run.as_ref(),
                    );
                    child_results.push(ChildResult {
                        role,
                        sub_goal,
                        status,
                        answer,
                    });
                }
                Err(err) => {
                    if !parent_has_terminal_failure(&parent_cell) {
                        apply_workflow_transition(
                            &parent_cell,
                            &observer_cell,
                            &mut workflow_gate,
                            "failed",
                        )?;
                    }
                    stop_after_wave = true;
                    finish_worker(&parent_cell, &observer_cell, &child_id, "error", &err, None);
                    child_results.push(ChildResult {
                        role,
                        sub_goal,
                        status: "error".to_string(),
                        answer: err,
                    });
                }
            }
        }
        if stop_after_wave {
            break;
        }
    }

    let parent_answer = aggregate_child_results(&goal, &child_results);
    let failed = child_results
        .iter()
        .any(|result| result.status == "error" || result.status == "interrupted");
    apply_workflow_transition(
        &parent_cell,
        &observer_cell,
        &mut workflow_gate,
        if failed { "failed" } else { "aggregated" },
    )?;
    let mut parent = parent_cell.borrow().clone();
    parent.status = if failed {
        RunStatus::Error
    } else {
        RunStatus::Complete
    };
    parent.final_answer = parent_answer;
    parent.events.push(event(
        &parent.id,
        None,
        AgentEventKind::FinalAnswer,
        "Orchestrator aggregated child results",
        parent.final_answer.clone(),
    ));
    snapshot.status = if failed {
        "Orchestrated run failed.".to_string()
    } else {
        "Orchestrated run complete.".to_string()
    };
    snapshot.current_run = Some(parent.clone());
    snapshot.runs.push(parent.clone());
    let runs_len = snapshot.runs.len();
    if runs_len > 25 {
        snapshot.runs.drain(0..runs_len - 25);
    }
    observer_cell.borrow_mut()(parent);

    Ok(snapshot)
}

fn apply_workflow_transition<F>(
    parent_cell: &Rc<RefCell<AgentRun>>,
    observer_cell: &Rc<RefCell<F>>,
    workflow_gate: &mut Option<WorkflowGate>,
    next_step: &str,
) -> AppResult<()>
where
    F: FnMut(AgentRun),
{
    let Some(gate) = workflow_gate else {
        return Ok(());
    };

    match gate.transition_to(next_step) {
        Ok(state) => {
            {
                let mut parent = parent_cell.borrow_mut();
                let parent_id = parent.id.clone();
                parent.scratchpad.workflow = state.clone();
                parent.events.push(event(
                    &parent_id,
                    None,
                    AgentEventKind::Workflow,
                    format!("Workflow advanced to `{}`", state.current_step),
                    format!(
                        "Workflow `{}` history: {}",
                        state.workflow_id,
                        state.history.join(" -> ")
                    ),
                ));
            }
            emit_parent(parent_cell, observer_cell);
            Ok(())
        }
        Err(feedback) => {
            {
                let mut parent = parent_cell.borrow_mut();
                let parent_id = parent.id.clone();
                parent.status = RunStatus::Error;
                parent.scratchpad.workflow = gate.state();
                parent.events.push(event(
                    &parent_id,
                    None,
                    AgentEventKind::Error,
                    "Workflow transition blocked",
                    feedback.clone(),
                ));
            }
            emit_parent(parent_cell, observer_cell);
            Err(feedback)
        }
    }
}

fn child_status_failed(status: &str) -> bool {
    matches!(status, "error" | "interrupted" | "cancelled")
}

fn parent_has_terminal_failure(parent_cell: &Rc<RefCell<AgentRun>>) -> bool {
    parent_cell.borrow().status.is_failure()
}

fn mark_wave_running<F>(
    parent_cell: &Rc<RefCell<AgentRun>>,
    observer_cell: &Rc<RefCell<F>>,
    planned: &[PlannedChildTask],
    wave: &[usize],
) where
    F: FnMut(AgentRun),
{
    {
        let mut parent = parent_cell.borrow_mut();
        let parent_id = parent.id.clone();
        for idx in wave {
            let child = &planned[*idx];
            if let Some(worker) = parent
                .scratchpad
                .workers
                .iter_mut()
                .find(|worker| worker.id == child.task.id)
            {
                worker.status = "running".to_string();
            }
            parent.events.push(event(
                &parent_id,
                child.task.agent_id.clone(),
                AgentEventKind::WorkerStarted,
                format!("Worker started: {}", child.agent.name),
                child.task.sub_goal.clone(),
            ));
        }
    }
    emit_parent(parent_cell, observer_cell);
}

fn update_worker_from_child_run<F>(
    parent_cell: &Rc<RefCell<AgentRun>>,
    observer_cell: &Rc<RefCell<F>>,
    child_id: &str,
    child_run: &AgentRun,
) where
    F: FnMut(AgentRun),
{
    {
        let mut parent = parent_cell.borrow_mut();
        if let Some(worker) = parent
            .scratchpad
            .workers
            .iter_mut()
            .find(|worker| worker.id == child_id)
        {
            worker.status = child_run.status.to_string();
            worker.result = child_run.final_answer.clone();
            worker.evidence = evidence_from_run(child_run);
        }
    }
    emit_parent(parent_cell, observer_cell);
}

fn finish_worker<F>(
    parent_cell: &Rc<RefCell<AgentRun>>,
    observer_cell: &Rc<RefCell<F>>,
    child_id: &str,
    status: &str,
    answer: &str,
    child_run: Option<&AgentRun>,
) where
    F: FnMut(AgentRun),
{
    {
        let mut parent = parent_cell.borrow_mut();
        let parent_id = parent.id.clone();
        let mut agent_id = None;
        let mut sub_goal = String::new();
        if let Some(worker) = parent
            .scratchpad
            .workers
            .iter_mut()
            .find(|worker| worker.id == child_id)
        {
            worker.status = status.to_string();
            worker.result = answer.to_string();
            if let Some(child_run) = child_run {
                worker.evidence = evidence_from_run(child_run);
            }
            agent_id = worker.agent_id.clone();
            sub_goal = worker.sub_goal.clone();
        }
        parent.events.push(event(
            &parent_id,
            agent_id,
            AgentEventKind::WorkerCompleted,
            format!("Worker completed: {status}"),
            sub_goal,
        ));
    }
    emit_parent(parent_cell, observer_cell);
}

fn emit_parent<F>(parent_cell: &Rc<RefCell<AgentRun>>, observer_cell: &Rc<RefCell<F>>)
where
    F: FnMut(AgentRun),
{
    let parent = parent_cell.borrow().clone();
    observer_cell.borrow_mut()(parent);
}

fn evidence_from_run(run: &AgentRun) -> Vec<String> {
    let mut evidence = run
        .tool_results
        .iter()
        .map(|result| result.content.clone())
        .collect::<Vec<_>>();
    if !run.final_answer.trim().is_empty() {
        evidence.push(run.final_answer.clone());
    }
    evidence
}

fn plan_child_tasks(snapshot: &AppSnapshot, goal: &str) -> Vec<PlannedChildTask> {
    let agents = available_agents(snapshot);
    decompose_goal(goal)
        .into_iter()
        .enumerate()
        .map(|(idx, mut task)| {
            let agent = agents[idx % agents.len()].clone();
            task.role = agent.name.clone();
            task.agent_id = Some(agent.id.clone());
            PlannedChildTask { task, agent }
        })
        .collect()
}

fn available_agents(snapshot: &AppSnapshot) -> Vec<Agent> {
    let enabled = snapshot
        .agents
        .iter()
        .filter(|agent| agent.enabled)
        .cloned()
        .collect::<Vec<_>>();
    if !enabled.is_empty() {
        return enabled;
    }
    if !snapshot.agents.is_empty() {
        return snapshot.agents.clone();
    }
    vec![Agent::new(
        "Assistant",
        "Handle one orchestrated child task with the compiled tools available to you.",
        default_tool_names(),
    )]
}

fn decompose_goal(goal: &str) -> Vec<ChildTask> {
    let line_items = goal.lines().filter_map(parse_line_item).collect::<Vec<_>>();
    let items = if line_items.len() >= 2 {
        line_items
    } else {
        compare_items(goal)
    };

    items
        .into_iter()
        .filter(|item| !item.trim().is_empty())
        .map(|item| ChildTask {
            id: Uuid::new_v4().to_string(),
            role: "Worker".to_string(),
            agent_id: None,
            sub_goal: item.trim().to_string(),
        })
        .collect()
}

fn parse_line_item(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if let Some(rest) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        return Some(rest.trim().to_string());
    }

    let (prefix, rest) = trimmed.split_once('.')?;
    if !prefix.is_empty() && prefix.chars().all(|ch| ch.is_ascii_digit()) {
        return Some(rest.trim().to_string());
    }
    None
}

fn compare_items(goal: &str) -> Vec<String> {
    let trimmed = goal.trim();
    let Some(after_compare) = trimmed
        .strip_prefix("Compare ")
        .or_else(|| trimmed.strip_prefix("compare "))
    else {
        return Vec::new();
    };
    let parts = after_compare
        .split(" and ")
        .map(|part| part.trim().trim_end_matches(['.', '?', '!']))
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if parts.len() >= 2 { parts } else { Vec::new() }
}

fn concurrency_waves(total: usize, max_parallelism: usize) -> Vec<Vec<usize>> {
    let width = max_parallelism.max(1);
    (0..total)
        .collect::<Vec<_>>()
        .chunks(width)
        .map(|chunk| chunk.to_vec())
        .collect()
}

fn aggregate_child_results(goal: &str, results: &[ChildResult]) -> String {
    let mut answer = format!("Orchestrator result for: {goal}\n\n");
    if results.is_empty() {
        answer.push_str("No child agent results were produced.");
        return answer;
    }

    for result in results {
        answer.push_str(&format!(
            "- {} — {} [{}]: {}\n",
            result.role,
            result.sub_goal,
            result.status,
            if result.answer.trim().is_empty() {
                "No answer produced."
            } else {
                result.answer.trim()
            }
        ));
    }
    answer.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decomposes_bullet_goal_into_child_subtasks() {
        let tasks = decompose_goal("Compare these:\n- Rust 2024 edition\n- Dioxus 0.7 workers");

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].sub_goal, "Rust 2024 edition");
        assert_eq!(tasks[1].sub_goal, "Dioxus 0.7 workers");
    }

    #[test]
    fn concurrency_waves_respect_max_parallelism() {
        let waves = concurrency_waves(5, 2);

        assert_eq!(waves, vec![vec![0, 1], vec![2, 3], vec![4]]);
    }

    #[test]
    fn worker_pool_schedules_waves_from_configured_parallelism() {
        let pool = WorkerPool::new(2);

        assert_eq!(
            pool.schedule_waves(5),
            vec![vec![0, 1], vec![2, 3], vec![4]]
        );
    }

    #[test]
    fn aggregates_child_results_into_parent_answer() {
        let results = vec![
            ChildResult {
                role: "Researcher".to_string(),
                sub_goal: "Rust".to_string(),
                status: "complete".to_string(),
                answer: "Rust result".to_string(),
            },
            ChildResult {
                role: "Synthesizer".to_string(),
                sub_goal: "Dioxus".to_string(),
                status: "complete".to_string(),
                answer: "Dioxus result".to_string(),
            },
        ];

        let answer = aggregate_child_results("Compare Rust and Dioxus", &results);

        assert!(answer.contains("Compare Rust and Dioxus"));
        assert!(answer.contains("Researcher — Rust"));
        assert!(answer.contains("Rust result"));
        assert!(answer.contains("Synthesizer — Dioxus"));
        assert!(answer.contains("Dioxus result"));
    }

    #[test]
    fn child_status_failed_only_for_terminal_failures() {
        assert!(child_status_failed("error"));
        assert!(child_status_failed("interrupted"));
        assert!(child_status_failed("cancelled"));
        assert!(!child_status_failed("running"));
        assert!(!child_status_failed("complete"));
    }
}
