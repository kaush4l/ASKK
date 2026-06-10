//! Id-keyed strategy lookup, mirroring the tool and inference registries: built-ins
//! registered at construction, one line per strategy, no engine edits to extend.

use super::{PlanActReviewStrategy, ReactStrategy, SkillsWorkCritiqueStrategy, Strategy};

pub const DEFAULT_STRATEGY_ID: &str = "react";

static REACT: ReactStrategy = ReactStrategy;
static PLAN_ACT_REVIEW: PlanActReviewStrategy = PlanActReviewStrategy;
static SKILLS_WORK_CRITIQUE: SkillsWorkCritiqueStrategy = SkillsWorkCritiqueStrategy;

/// Infallible default used when an id (even "react") fails to resolve.
pub fn fallback_strategy() -> &'static dyn Strategy {
    &REACT
}

pub struct StrategyRegistry {
    strategies: Vec<&'static dyn Strategy>,
}

impl Default for StrategyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl StrategyRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            strategies: Vec::new(),
        };
        register_builtin_strategies(&mut registry);
        registry
    }

    pub fn register(&mut self, strategy: &'static dyn Strategy) {
        self.strategies
            .retain(|existing| existing.id() != strategy.id());
        self.strategies.push(strategy);
    }

    pub fn get(&self, id: &str) -> Option<&'static dyn Strategy> {
        self.strategies
            .iter()
            .copied()
            .find(|strategy| strategy.id() == id.trim())
    }

    /// (id, description) pairs for UI pickers.
    pub fn catalog(&self) -> Vec<(&'static str, &'static str)> {
        self.strategies
            .iter()
            .map(|strategy| (strategy.id(), strategy.description()))
            .collect()
    }
}

fn register_builtin_strategies(registry: &mut StrategyRegistry) {
    registry.register(&REACT);
    registry.register(&PLAN_ACT_REVIEW);
    registry.register(&SKILLS_WORK_CRITIQUE);
}

/// One resolution order everywhere: explicit param → agent config → default.
pub fn resolve_strategy_id(param: Option<&str>, agent_config: Option<&str>) -> String {
    let pick = |value: Option<&str>| {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    pick(param)
        .or_else(|| pick(agent_config))
        .unwrap_or_else(|| DEFAULT_STRATEGY_ID.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_resolves_react_and_rejects_unknown() {
        let registry = StrategyRegistry::new();
        assert!(registry.get("react").is_some());
        assert!(registry.get(" react ").is_some());
        assert!(registry.get("nope").is_none());
    }

    #[test]
    fn registering_a_new_strategy_needs_no_engine_edits() {
        // Seam test: a fresh strategy is registered and resolvable through the same
        // registry API the engine uses — no match arms anywhere to extend.
        struct Custom;
        static CUSTOM_PHASES: [crate::strategy::Phase; 1] = [crate::strategy::Phase {
            name: "only",
            response_kind: crate::responses::ResponseKind::ReAct,
            prompt_frame: "",
            tool_policy: crate::strategy::ToolPolicy::Inherit,
            loop_mode: crate::strategy::LoopMode::OneShot,
            list_skill_library: false,
        }];
        impl crate::strategy::Strategy for Custom {
            fn id(&self) -> &'static str {
                "custom"
            }
            fn description(&self) -> &'static str {
                "test-only"
            }
            fn phases(&self) -> &'static [crate::strategy::Phase] {
                &CUSTOM_PHASES
            }
            fn route(
                &self,
                _from: usize,
                _outcome: &crate::strategy::PhaseOutcome,
            ) -> crate::strategy::Routing {
                crate::strategy::Routing::Done
            }
        }
        static CUSTOM: Custom = Custom;
        let mut registry = StrategyRegistry::new();
        registry.register(&CUSTOM);
        assert!(registry.get("custom").is_some());
    }

    #[test]
    fn catalog_always_contains_react() {
        let catalog = StrategyRegistry::new().catalog();
        assert!(
            catalog.iter().any(|(id, _)| *id == "react"),
            "catalog must contain 'react'; UI picker depends on it"
        );
    }

    #[test]
    fn resolution_order_param_beats_agent_beats_default() {
        assert_eq!(resolve_strategy_id(Some("a"), Some("b")), "a");
        assert_eq!(resolve_strategy_id(None, Some("b")), "b");
        assert_eq!(resolve_strategy_id(Some("  "), None), "react");
        assert_eq!(resolve_strategy_id(None, None), "react");
    }
}
