//! [`ReactEngine`] — the concrete engine. It overrides exactly one method,
//! [`Engine::invoke`]: the bounded ReAct while-loop
//! (observe → think → act → observe …). Everything else — rendering, history,
//! the model call, tool dispatch — is inherited from the [`Engine`] defaults.

use crate::responses::ReActAction;
use crate::state::AppSnapshot;

use super::engine::{AnswerVerdict, BaseEngine, Engine, EngineHooks, EngineOutcome, StopReason};

/// The ReAct loop over a [`BaseEngine`]: each turn renders the message-state
/// into one request, calls the model, and either accepts a final answer or
/// dispatches the emitted tool calls and feeds their observations back as
/// untrusted data. Bounded by `max_iterations`.
pub struct ReactEngine {
    /// The shared state record (the "superclass fields").
    pub base: BaseEngine,
    /// The hard turn budget for one `invoke` (always at least 1).
    pub max_iterations: u32,
}

impl ReactEngine {
    pub fn new(base: BaseEngine, max_iterations: u32) -> Self {
        Self {
            base,
            max_iterations: max_iterations.max(1),
        }
    }
}

impl Engine for ReactEngine {
    fn base(&self) -> &BaseEngine {
        &self.base
    }

    fn base_mut(&mut self) -> &mut BaseEngine {
        &mut self.base
    }

    /// The while loop. One turn: interrupt check → memory hook → render →
    /// call model → record reply → branch on the parsed action.
    async fn invoke<H: EngineHooks>(
        &mut self,
        goal: &str,
        snapshot: &mut AppSnapshot,
        hooks: &mut H,
    ) -> EngineOutcome {
        let mut turns: u32 = 0;
        let mut last_response = None;
        let mut answer = None;

        let stop = loop {
            if turns >= self.max_iterations {
                break StopReason::BudgetExhausted;
            }
            if hooks.interrupted() {
                break StopReason::Interrupted;
            }
            hooks.before_turn(&mut self.base.history).await;
            turns += 1;
            hooks.on_turn_start(turns, self.base.conversation.len(), self.base.history.len());

            // Final-step guard. On the last turn the budget allows, the loop
            // cannot run another observe→act round: a tool call here is the last
            // thing the model does, so the run ends `BudgetExhausted` with no
            // answer (the "Reached the step limit" dead end). Nudge the model to
            // synthesize its best answer now from what it has already gathered,
            // turning that dead stop into a real, if hedged, result. Only when a
            // prior turn ran (`turns > 1`), so there is gathered context to fold.
            if turns == self.max_iterations && turns > 1 {
                let nudge = final_step_nudge(turns, self.max_iterations);
                self.append_history(hooks, "user", nudge);
            }

            // Refresh the `## WORKSPACE` block from the live open-set BEFORE rendering,
            // so the prompt carries each open file's current content (projection-by-
            // reference). Empty unless the shell's hook builds it.
            self.base.workspace_context = hooks.workspace_block().await;
            let request = self.render(goal);
            let Some(output) = self.call_model(request, hooks).await else {
                break StopReason::ProviderPaused;
            };
            self.append_history(hooks, "assistant", output.raw_text.clone());
            hooks.on_model_response(turns, &output.raw_text, &output.parsed);
            last_response = Some(output.parsed.clone());

            match output.parsed.action {
                ReActAction::Answer => {
                    let text = output.parsed.final_text();
                    match hooks.on_answer(&text, false) {
                        AnswerVerdict::Accept => {
                            answer = Some(text);
                            break StopReason::Answered;
                        }
                        AnswerVerdict::Reject { feedback } => {
                            self.append_history(hooks, "user", feedback);
                        }
                        AnswerVerdict::Abort => break StopReason::Aborted,
                    }
                }
                ReActAction::Tool => {
                    let calls = Self::parse_tool_calls(&output.parsed.response);
                    if calls.is_empty() {
                        // The model chose a tool but produced no parseable
                        // call: treat its text as a candidate final answer
                        // rather than returning raw, unvalidated output.
                        let text = output.parsed.final_text();
                        match hooks.on_answer(&text, true) {
                            AnswerVerdict::Accept => {
                                answer = Some(text);
                                break StopReason::Answered;
                            }
                            AnswerVerdict::Reject { feedback } => {
                                self.append_history(hooks, "user", feedback);
                            }
                            AnswerVerdict::Abort => break StopReason::Aborted,
                        }
                    } else if !self.dispatch_tools(snapshot, calls, hooks).await {
                        break StopReason::Aborted;
                    }
                }
            }
        };

        EngineOutcome {
            last_response,
            answer,
            turns_used: turns,
            stop,
        }
    }
}

/// The user-role message injected on the final allowed turn (see
/// [`Engine::invoke`]'s final-step guard). It tells the model this is its last
/// turn, that further tool calls are futile, and to answer now from what it has
/// — converting a budget-exhausted dead end into a best-effort, hedged answer.
fn final_step_nudge(step: u32, max: u32) -> String {
    format!(
        "⚠️ Final step ({step} of {max}). You cannot call any more tools — a tool \
         call now is discarded and the run ends with no answer. Synthesize your \
         single best answer from everything gathered so far and return it now with \
         `action: answer`. State briefly what stayed uncertain rather than searching \
         again."
    )
}
