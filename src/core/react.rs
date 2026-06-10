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
