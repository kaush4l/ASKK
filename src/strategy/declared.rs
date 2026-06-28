//! `DeclaredStrategy` — a runtime [`Strategy`] built from `agent.md`-declared phases
//! rather than hardcoded in Rust. The flat-key `agent.md` schema (parsed in
//! [`crate::state::manifest`]) yields a [`DeclaredPhase`] list; this module turns that
//! list into owned [`Phase`]s plus the routing metadata (the gate index and the
//! per-gate bounce target) and runs it through the engine's existing phase driver.
//!
//! Routing mirrors the hardcoded `plan-act-review` / `skills-work-critique`
//! strategies: non-gate phases route [`Routing::Next`] (linear advance); the single
//! gate phase routes [`Routing::Done`] on a `pass` critique/answer and
//! [`Routing::Back`] to its `on_fail` target on a `revise` critique. With no gate
//! declared the strategy degrades to a linear `react`-like run (any terminal phase
//! completes), matching the gateless built-ins.

use serde::{Deserialize, Serialize};

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

/// Map an `agent.md` `response_kind:` scalar to a [`ResponseKind`]. Accepts the
/// snake_case names that mirror the enum's serde `rename_all = "snake_case"`. Unknown
/// values return `None` so the validator can warn (and the builder can fall back to
/// `react`) rather than trapping.
pub fn response_kind_from_str(value: &str) -> Option<ResponseKind> {
    match value.trim().to_ascii_lowercase().as_str() {
        "react" => Some(ResponseKind::ReAct),
        "plan" => Some(ResponseKind::Plan),
        "critique" => Some(ResponseKind::Critique),
        "skill_selection" => Some(ResponseKind::SkillSelection),
        "task_breakdown" => Some(ResponseKind::TaskBreakdown),
        "summary" => Some(ResponseKind::Summary),
        _ => None,
    }
}

/// One phase as authored in `agent.md`, before it is lowered to a runtime [`Phase`].
/// The fields are the parsed flat keys; the loader groups `phase.<n>.*` lines into one
/// of these per integer index.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeclaredPhase {
    /// `phase.<n>.name` — the phase's stable name (used for routing/diagnostics).
    pub name: String,
    /// `phase.<n>.header` — the phase framing prepended to the goal. Empty = none.
    pub header: String,
    /// `phase.<n>.response_kind` — the structured schema this phase parses to.
    /// `None` when omitted or unknown; the builder falls back to `react`.
    pub response_kind: Option<String>,
    /// `phase.<n>.tools` — the comma-separated tool subset. Empty = inherit the
    /// agent's full allowlist.
    pub tools: Vec<String>,
    /// `phase.<n>.loop` — `true` when the phase loops (`loop`), `false` for `one_shot`
    /// (the default).
    pub looped: bool,
    /// `phase.<n>.gate` — `true` marks the sole-exit gate phase.
    pub gate: bool,
    /// `phase.<n>.on_fail` — the phase name a failed gate bounces back to. `None` =
    /// no declared bounce (a failed gate then simply re-runs the gate via the
    /// driver's normal advance, matching the gateless default).
    pub on_fail: Option<String>,
}

/// A runtime [`Strategy`] assembled from declared phases. Held behind an `Rc` by the
/// engine (the single-threaded wasm idiom) so a per-agent declared strategy can be
/// heap-owned alongside the `&'static` built-ins.
#[derive(Clone, Debug)]
pub struct DeclaredStrategy {
    /// Leaked once at construction (one per declared strategy, i.e. one per agent —
    /// bounded) so the `&'static str` trait accessors are a cheap field read rather
    /// than a per-call leak. A declared strategy is run directly, never id-resolved,
    /// so this label is purely diagnostic.
    id: &'static str,
    description: &'static str,
    phases: Vec<Phase>,
    /// The index of the gate phase (the one with `gate: true`), if any.
    gate: Option<usize>,
    /// The phase index a failed gate bounces back to, derived from the gate's
    /// `on_fail` name. `None` when no gate or no `on_fail` declared.
    on_fail: Option<usize>,
}

impl DeclaredStrategy {
    /// Lower a declared-phase list into a runtime strategy. `id` is the owning agent's
    /// id (so diagnostics name the source); the description is synthesized.
    ///
    /// Phase lowering: `response_kind` falls back to `react` when omitted/unknown;
    /// `tools` empty ⇒ [`ToolPolicy::Inherit`], else [`ToolPolicy::Subset`]; `looped`
    /// ⇒ [`LoopMode::Loop`] (global budget), else [`LoopMode::OneShot`]. The gate index
    /// is the first phase with `gate: true`; its `on_fail` name is resolved to a phase
    /// index here so `route` is a pure lookup.
    pub fn from_declared(id: impl Into<String>, declared: &[DeclaredPhase]) -> Self {
        let id = id.into();
        let phases: Vec<Phase> = declared
            .iter()
            .map(|d| Phase {
                name: d.name.clone(),
                response_kind: d
                    .response_kind
                    .as_deref()
                    .and_then(response_kind_from_str)
                    .unwrap_or(ResponseKind::ReAct),
                prompt_frame: d.header.clone(),
                tool_policy: if d.tools.is_empty() {
                    ToolPolicy::Inherit
                } else {
                    ToolPolicy::Subset(d.tools.clone())
                },
                loop_mode: if d.looped {
                    LoopMode::Loop { max_turns: 0 }
                } else {
                    LoopMode::OneShot
                },
                list_skill_library: false,
            })
            .collect();

        let gate = declared.iter().position(|d| d.gate);
        let on_fail = gate
            .and_then(|g| declared[g].on_fail.as_deref())
            .and_then(|target| declared.iter().position(|d| d.name == target));

        let description: &'static str = Box::leak(
            format!(
                "Declared strategy for agent `{id}` ({} phases).",
                phases.len()
            )
            .into_boxed_str(),
        );
        let id: &'static str = Box::leak(id.into_boxed_str());

        Self {
            id,
            description,
            phases,
            gate,
            on_fail,
        }
    }
}

impl Strategy for DeclaredStrategy {
    fn id(&self) -> &'static str {
        self.id
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn phases(&self) -> &[Phase] {
        &self.phases
    }

    fn gate_phase(&self) -> Option<usize> {
        self.gate
    }

    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing {
        // The gate phase is the sole exit: a `pass` critique (or any non-revise
        // terminal) completes; a `revise` bounces to the declared `on_fail` target
        // (or simply advances when none is declared). Mirrors `plan_act_review::route`.
        if self.gate == Some(from) {
            if let ParsedResponse::Critique(critique) = &outcome.response
                && critique.verdict == crate::responses::CritiqueVerdict::Revise
            {
                return match self.on_fail {
                    Some(target) => Routing::Back(target),
                    None => Routing::Next,
                };
            }
            return Routing::Done;
        }
        // Non-gate phases advance linearly. The driver downgrades a terminal `Next`
        // (loop fall-off) on a gated strategy to `Unverified`, so a non-gate phase can
        // never self-grant success.
        if from + 1 < self.phases.len() {
            Routing::Next
        } else {
            Routing::Done
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        // Distill the feedback from a gate's revise critique so the bounced-to phase
        // sees it, mirroring the built-ins' feedback artifact.
        if let ParsedResponse::Critique(critique) = &outcome.response
            && !critique.feedback.trim().is_empty()
        {
            return Some(("feedback".to_string(), critique.feedback.clone()));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::{CritiqueResponse, CritiqueVerdict};

    fn outcome(phase: &str, response: ParsedResponse) -> PhaseOutcome {
        PhaseOutcome {
            phase: phase.to_string(),
            response,
            turns_used: 1,
        }
    }

    fn sample() -> Vec<DeclaredPhase> {
        vec![
            DeclaredPhase {
                name: "plan".into(),
                header: "PLAN".into(),
                response_kind: Some("plan".into()),
                tools: vec!["file_read".into()],
                looped: false,
                gate: false,
                on_fail: None,
            },
            DeclaredPhase {
                name: "execute".into(),
                header: String::new(),
                response_kind: Some("react".into()),
                tools: vec![],
                looped: true,
                gate: false,
                on_fail: None,
            },
            DeclaredPhase {
                name: "verify".into(),
                header: String::new(),
                response_kind: Some("critique".into()),
                tools: vec!["run_command".into()],
                looped: false,
                gate: true,
                on_fail: Some("plan".into()),
            },
        ]
    }

    #[test]
    fn lowers_phases_and_resolves_gate_and_on_fail() {
        let strategy = DeclaredStrategy::from_declared("coder", &sample());
        assert_eq!(strategy.phases().len(), 3);
        assert_eq!(strategy.gate_phase(), Some(2));
        // plan: subset of one tool, one-shot, Plan kind.
        let plan = &strategy.phases()[0];
        assert_eq!(plan.name, "plan");
        assert_eq!(plan.response_kind, ResponseKind::Plan);
        assert_eq!(
            plan.tool_policy,
            ToolPolicy::Subset(vec!["file_read".into()])
        );
        assert_eq!(plan.loop_mode, LoopMode::OneShot);
        // execute: no tools ⇒ inherit, looped.
        let execute = &strategy.phases()[1];
        assert_eq!(execute.tool_policy, ToolPolicy::Inherit);
        assert_eq!(execute.loop_mode, LoopMode::Loop { max_turns: 0 });
    }

    #[test]
    fn gate_pass_routes_done_fail_routes_back_to_on_fail() {
        let strategy = DeclaredStrategy::from_declared("coder", &sample());
        let pass = outcome(
            "verify",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Pass,
                feedback: String::new(),
            }),
        );
        assert_eq!(strategy.route(2, &pass), Routing::Done);

        let fail = outcome(
            "verify",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Revise,
                feedback: "tests fail".into(),
            }),
        );
        // on_fail names "plan" → index 0.
        assert_eq!(strategy.route(2, &fail), Routing::Back(0));
        assert_eq!(
            strategy.artifact(&fail),
            Some(("feedback".to_string(), "tests fail".to_string()))
        );
    }

    #[test]
    fn non_gate_phases_route_next_until_the_end() {
        let strategy = DeclaredStrategy::from_declared("coder", &sample());
        let any = outcome("plan", ResponseKind::ReAct.parse(""));
        assert_eq!(strategy.route(0, &any), Routing::Next);
        assert_eq!(strategy.route(1, &any), Routing::Next);
    }

    #[test]
    fn gateless_declared_strategy_completes_on_the_last_phase() {
        let declared = vec![
            DeclaredPhase {
                name: "a".into(),
                header: String::new(),
                response_kind: None,
                tools: vec![],
                looped: false,
                gate: false,
                on_fail: None,
            },
            DeclaredPhase {
                name: "b".into(),
                header: String::new(),
                response_kind: None,
                tools: vec![],
                looped: true,
                gate: false,
                on_fail: None,
            },
        ];
        let strategy = DeclaredStrategy::from_declared("x", &declared);
        assert_eq!(strategy.gate_phase(), None);
        let any = outcome("a", ResponseKind::ReAct.parse(""));
        assert_eq!(strategy.route(0, &any), Routing::Next);
        assert_eq!(strategy.route(1, &any), Routing::Done);
        // unknown/None response_kind falls back to react.
        assert_eq!(strategy.phases()[0].response_kind, ResponseKind::ReAct);
    }
}
