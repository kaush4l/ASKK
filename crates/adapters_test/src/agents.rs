//! The `AgentPort` fake — sub-agents that answer from a script, including the
//! two answers only a fake can stage on demand: an agent whose turn RAISED,
//! and a name that is not loaded at all. It also owns the one thing a fake
//! that answers INSTANTLY cannot show: two delegations open at once.

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use kernel::{AgentPort, BoxFuture, DelegateError};

use crate::ready;

/// Sub-agents that answer from a script, by name (the `AgentPort` fake). A
/// name with an `Err` answer is an agent whose turn RAISED — the case that
/// must reach the board as `Failed` carrying its own message; a name that is
/// not here at all is not loaded.
///
/// The `gate` is the same fake wearing its second hat, and it is ONE type on
/// purpose: a rendezvous still has to answer from the script, so splitting it
/// off would duplicate the answer table and the `AgentPort` impl to change one
/// line — when a delegation resolves. See `rendezvous`.
#[derive(Debug, Default)]
pub struct ScriptedAgents {
    answers: Vec<(String, Result<String, String>)>,
    /// The order goals actually arrived in — what a test asserts when it cares
    /// that one line of calls ran together and the next line ran after.
    pub seen: RefCell<Vec<String>>,
    /// Every ENTRY and every RESOLUTION, interleaved as they really happened.
    /// `seen` cannot show overlap: it records arrivals only, and arrivals in
    /// the same order are exactly what a serial `for … .await` produces.
    timeline: RefCell<Vec<String>>,
    entered: Cell<usize>,
    gate: Option<usize>,
}

impl ScriptedAgents {
    /// `(agent, Ok(answer) | Err(message))`, one entry per loaded agent.
    pub fn with(answers: Vec<(&str, Result<&str, &str>)>) -> ScriptedAgents {
        ScriptedAgents {
            answers: answers
                .into_iter()
                .map(|(n, a)| {
                    (
                        n.to_string(),
                        a.map(str::to_string).map_err(str::to_string),
                    )
                })
                .collect(),
            ..ScriptedAgents::default()
        }
    }

    /// No sub-agents at all — every delegation is to an unknown agent.
    pub fn none() -> ScriptedAgents {
        ScriptedAgents::default()
    }

    /// NO delegation resolves until `arrivals` of them have been ENTERED. That
    /// is the whole point: a caller that drives delegation 1 to completion
    /// before delegation 2 exists never reaches the second arrival, so its
    /// first `await` never returns and the test hangs instead of passing. The
    /// gate is cumulative — arrival number `arrivals` opens it for good — so
    /// this measures ONE line of calls, which is the unit the layout rule is
    /// about (`core::batch::run_effects`).
    pub fn rendezvous(mut self, arrivals: usize) -> ScriptedAgents {
        self.gate = Some(arrivals);
        self
    }

    /// Entries and resolutions in the order they happened, as `entered <name>`
    /// / `resolved <name>`. Overlap is a claim about THIS sequence.
    pub fn timeline(&self) -> Vec<String> {
        self.timeline.borrow().clone()
    }

    fn answer(&self, agent: &str) -> Result<String, DelegateError> {
        match self.answers.iter().find(|(n, _)| n == agent) {
            None => Err(DelegateError::Unknown {
                agent: agent.to_string(),
            }),
            Some((_, Ok(answer))) => Ok(answer.clone()),
            Some((_, Err(message))) => Err(DelegateError::Failed {
                agent: agent.to_string(),
                message: message.clone(),
            }),
        }
    }
}

impl AgentPort for ScriptedAgents {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        goal: &'a str,
    ) -> BoxFuture<'a, Result<String, DelegateError>> {
        self.seen.borrow_mut().push(format!("{agent}: {goal}"));
        self.timeline.borrow_mut().push(format!("entered {agent}"));
        self.entered.set(self.entered.get() + 1);
        let result = self.answer(agent);
        match self.gate {
            None => {
                self.timeline.borrow_mut().push(format!("resolved {agent}"));
                ready(result)
            }
            Some(arrivals) => Box::pin(Rendezvous {
                agents: self,
                agent: agent.to_string(),
                result,
                arrivals,
            }),
        }
    }
}

/// One delegation held open until enough peers have joined it. Pending is
/// re-polled by both drivers that matter here: `futures::join_all` polls each
/// of a handful of futures on every poll, and the tests' `block_on` spins on a
/// noop waker — so waking is a formality, not the mechanism.
struct Rendezvous<'a> {
    agents: &'a ScriptedAgents,
    agent: String,
    result: Result<String, DelegateError>,
    arrivals: usize,
}

impl Future for Rendezvous<'_> {
    type Output = Result<String, DelegateError>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.agents.entered.get() < self.arrivals {
            cx.waker().wake_by_ref();
            return Poll::Pending;
        }
        let me = self.get_mut();
        me.agents
            .timeline
            .borrow_mut()
            .push(format!("resolved {}", me.agent));
        // Cloned, not taken: a `Ready` future polled again is a caller bug, and
        // a clone answers it the same way instead of hanging silently.
        Poll::Ready(me.result.clone())
    }
}
