//! The team pipeline: the pure control-flow state machine that sequences a team's
//! members. Members run in `order`; the last (or an explicitly chosen) member is
//! the gate — the verifier — and its verdict decides whether the team is done or
//! bounces back to the first member for another pass. Retries are capped so a team
//! that can never satisfy its gate terminates instead of looping forever.
//!
//! This module owns ONLY the decision logic (which member next, when to bounce,
//! when to give up). The async work of actually running a member lives in
//! [`super::driver`], which drives this machine. Keeping them apart makes every
//! branch of the coordination logic host-testable without a live model.

/// The gate member's judgement of the work so far.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Accept: the work meets the gate's standard; the team is done.
    Pass,
    /// Reject: the work falls short. `feedback` re-enters the pipeline as guidance
    /// for the bounce-back pass.
    Revise(String),
}

/// Classify a gate member's free-text answer into a [`Verdict`]. Lenient by design:
/// a member is treated as passing UNLESS it explicitly asks for a revision (says
/// "revise" or "reject"). This keeps non-verifier teams from stalling while still
/// honoring an explicit verifier rejection. The whole answer is carried as feedback
/// on a revise so the next pass sees exactly what to fix.
pub fn classify_verdict(answer: &str) -> Verdict {
    let lowered = answer.to_lowercase();
    if lowered.contains("revise") || lowered.contains("reject") {
        Verdict::Revise(answer.trim().to_string())
    } else {
        Verdict::Pass
    }
}

/// The outcome of advancing the pipeline after a member finished.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PipelineOutcome {
    /// A non-gate member finished; the next member should run.
    Continue,
    /// The gate rejected; the pipeline reset to the first member for another pass.
    Bounced,
    /// The gate accepted; the team is complete.
    Done,
    /// The gate rejected but the retry budget is exhausted; the team stops here.
    Exhausted,
}

/// The sequencer over a team's ordered member ids. It tracks which member runs
/// next, which member is the gate, and how many bounce-back passes remain.
#[derive(Clone, Debug)]
pub struct TeamPipeline {
    members: Vec<String>,
    gate_index: usize,
    max_retries: u32,
    cursor: usize,
    retries: u32,
    done: bool,
}

impl TeamPipeline {
    /// Build a pipeline over `members` (already in run order). The gate defaults to
    /// the last member — the verifier convention. `max_retries` bounds bounce-backs.
    pub fn new(members: Vec<String>, max_retries: u32) -> Self {
        let gate_index = members.len().saturating_sub(1);
        Self {
            members,
            gate_index,
            max_retries,
            cursor: 0,
            retries: 0,
            done: false,
        }
    }

    /// Override which member acts as the gate (clamped to a valid index).
    #[allow(dead_code)]
    pub fn with_gate(mut self, gate_index: usize) -> Self {
        if !self.members.is_empty() {
            self.gate_index = gate_index.min(self.members.len() - 1);
        }
        self
    }

    /// The id of the member that should run now, or `None` when the pipeline is
    /// complete (done, exhausted, or empty).
    pub fn next_member(&self) -> Option<&str> {
        if self.done {
            return None;
        }
        self.members.get(self.cursor).map(String::as_str)
    }

    /// Whether the member that would run now is the gate (verifier).
    pub fn current_is_gate(&self) -> bool {
        !self.members.is_empty() && self.cursor == self.gate_index
    }

    /// The number of bounce-back passes taken so far.
    pub fn retries(&self) -> u32 {
        self.retries
    }

    /// The ordered member ids (for spinning up instances / display).
    pub fn members(&self) -> &[String] {
        &self.members
    }

    /// Record that the current member finished. For a non-gate member the verdict
    /// is ignored and the cursor advances. For the gate member, `Pass` completes
    /// the team and `Revise` bounces to the first member (consuming one retry), or
    /// gives up when the retry budget is spent.
    pub fn advance(&mut self, verdict: Verdict) -> PipelineOutcome {
        if self.done || self.members.is_empty() {
            return PipelineOutcome::Done;
        }

        if self.current_is_gate() {
            match verdict {
                Verdict::Pass => {
                    self.done = true;
                    PipelineOutcome::Done
                }
                Verdict::Revise(_) => {
                    if self.retries >= self.max_retries {
                        self.done = true;
                        PipelineOutcome::Exhausted
                    } else {
                        self.retries += 1;
                        self.cursor = 0;
                        PipelineOutcome::Bounced
                    }
                }
            }
        } else {
            self.cursor += 1;
            PipelineOutcome::Continue
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn three_member() -> TeamPipeline {
        TeamPipeline::new(
            vec![
                "coder-planner".into(),
                "coder-coder".into(),
                "coder-verifier".into(),
            ],
            2,
        )
    }

    #[test]
    fn classify_is_lenient_but_honors_revise_and_reject() {
        assert_eq!(classify_verdict("PASS — tests green"), Verdict::Pass);
        assert_eq!(classify_verdict("looks good"), Verdict::Pass);
        assert_eq!(
            classify_verdict("REVISE: missing error handling in src/x.rs"),
            Verdict::Revise("REVISE: missing error handling in src/x.rs".into())
        );
        assert!(matches!(
            classify_verdict("I must reject this"),
            Verdict::Revise(_)
        ));
    }

    #[test]
    fn happy_path_runs_each_member_once_then_done() {
        let mut pipeline = three_member();
        assert_eq!(pipeline.next_member(), Some("coder-planner"));
        assert!(!pipeline.current_is_gate());
        assert_eq!(pipeline.advance(Verdict::Pass), PipelineOutcome::Continue);

        assert_eq!(pipeline.next_member(), Some("coder-coder"));
        assert!(!pipeline.current_is_gate());
        assert_eq!(pipeline.advance(Verdict::Pass), PipelineOutcome::Continue);

        assert_eq!(pipeline.next_member(), Some("coder-verifier"));
        assert!(pipeline.current_is_gate());
        assert_eq!(pipeline.advance(Verdict::Pass), PipelineOutcome::Done);

        assert_eq!(pipeline.next_member(), None);
    }

    #[test]
    fn revise_bounces_back_to_first_member() {
        let mut pipeline = three_member();
        pipeline.advance(Verdict::Pass); // planner
        pipeline.advance(Verdict::Pass); // coder
        assert!(pipeline.current_is_gate());
        let outcome = pipeline.advance(Verdict::Revise("fix it".into()));
        assert_eq!(outcome, PipelineOutcome::Bounced);
        assert_eq!(pipeline.retries(), 1);
        // Back to the start for another pass.
        assert_eq!(pipeline.next_member(), Some("coder-planner"));
    }

    #[test]
    fn retry_budget_exhaustion_stops_the_team() {
        let mut pipeline = TeamPipeline::new(vec!["a".into(), "b".into()], 1);
        // Pass 1: a (non-gate) -> b (gate) revise -> bounce (retry 1).
        pipeline.advance(Verdict::Pass);
        assert_eq!(
            pipeline.advance(Verdict::Revise("no".into())),
            PipelineOutcome::Bounced
        );
        // Pass 2: a -> b revise again, budget spent -> exhausted.
        pipeline.advance(Verdict::Pass);
        assert_eq!(
            pipeline.advance(Verdict::Revise("still no".into())),
            PipelineOutcome::Exhausted
        );
        assert_eq!(pipeline.next_member(), None);
    }

    #[test]
    fn single_member_team_gate_is_that_member() {
        let mut pipeline = TeamPipeline::new(vec!["solo".into()], 1);
        assert_eq!(pipeline.next_member(), Some("solo"));
        assert!(pipeline.current_is_gate());
        assert_eq!(pipeline.advance(Verdict::Pass), PipelineOutcome::Done);
    }

    #[test]
    fn empty_team_is_immediately_complete() {
        let mut pipeline = TeamPipeline::new(vec![], 1);
        assert_eq!(pipeline.next_member(), None);
        assert_eq!(pipeline.advance(Verdict::Pass), PipelineOutcome::Done);
    }

    #[test]
    fn explicit_gate_override_changes_the_verifier() {
        let pipeline =
            TeamPipeline::new(vec!["a".into(), "b".into(), "c".into()], 1).with_gate(1);
        assert!(!pipeline.current_is_gate()); // cursor 0 is not the gate
    }
}
