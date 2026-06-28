//! Id-keyed strategy lookup, mirroring the tool and inference registries: built-ins
//! registered at construction, one line per strategy, no engine edits to extend.

use super::{
    OrchestrateStrategy, PlanActReviewStrategy, ReactStrategy, SkillsWorkCritiqueStrategy, Strategy,
};
use crate::registry::Registry;

pub const DEFAULT_STRATEGY_ID: &str = "react";

static REACT: ReactStrategy = ReactStrategy;
static PLAN_ACT_REVIEW: PlanActReviewStrategy = PlanActReviewStrategy;
static SKILLS_WORK_CRITIQUE: SkillsWorkCritiqueStrategy = SkillsWorkCritiqueStrategy;
static ORCHESTRATE: OrchestrateStrategy = OrchestrateStrategy;

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

/// The shared registry vocabulary over the strategy catalog: keyed by `&str`
/// id, valued by the `'static` strategy object. The catalog is immutable in
/// practice once built (built-ins registered at construction), so it reports a
/// constant [`version`](Registry::version) — still monotonic, it simply never
/// moves. This is delegation, not a second store: every method routes to the
/// existing inherent API, so the public lookup surface is unchanged.
impl Registry<&'static str, &'static dyn Strategy> for StrategyRegistry {
    fn get(&self, key: &&'static str) -> Option<&'static dyn Strategy> {
        StrategyRegistry::get(self, key)
    }

    fn insert(&mut self, _key: &'static str, value: &'static dyn Strategy) {
        // The catalog keys on the strategy's own `id()`; the external key is
        // redundant with it, so insertion routes to `register`, which de-dups by
        // `id()` exactly as before.
        self.register(value);
    }

    fn keys(&self) -> Vec<&'static str> {
        self.strategies
            .iter()
            .map(|strategy| strategy.id())
            .collect()
    }

    fn len(&self) -> usize {
        self.strategies.len()
    }

    fn version(&self) -> u64 {
        // Built-ins are registered once at construction and never mutated on the
        // live path; the catalog is effectively static, so its change-counter is
        // a constant 0.
        0
    }
}

fn register_builtin_strategies(registry: &mut StrategyRegistry) {
    registry.register(&REACT);
    registry.register(&PLAN_ACT_REVIEW);
    registry.register(&SKILLS_WORK_CRITIQUE);
    registry.register(&ORCHESTRATE);
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
        impl crate::strategy::Strategy for Custom {
            fn id(&self) -> &'static str {
                "custom"
            }
            fn description(&self) -> &'static str {
                "test-only"
            }
            fn phases(&self) -> &[crate::strategy::Phase] {
                use std::sync::OnceLock;
                static PHASES: OnceLock<Vec<crate::strategy::Phase>> = OnceLock::new();
                PHASES.get_or_init(|| {
                    vec![crate::strategy::Phase {
                        name: "only".into(),
                        response_kind: crate::responses::ResponseKind::ReAct,
                        prompt_frame: "".into(),
                        tool_policy: crate::strategy::ToolPolicy::Inherit,
                        loop_mode: crate::strategy::LoopMode::OneShot,
                        list_skill_library: false,
                    }]
                })
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

    #[test]
    fn registry_trait_matches_inherent_lookups() {
        // The shared `Registry` vocabulary must resolve to exactly the same
        // strategy as the inherent `get` — the trait is delegation, not a
        // divergent path.
        let registry = StrategyRegistry::new();
        let via_trait = Registry::get(&registry, &"react");
        let via_inherent = StrategyRegistry::get(&registry, "react");
        assert!(via_trait.is_some());
        assert_eq!(
            via_trait.map(|strategy| strategy.id()),
            via_inherent.map(|strategy| strategy.id()),
        );
        // `keys()` enumerates the same ids the catalog reports.
        let keys = Registry::keys(&registry);
        assert!(keys.contains(&"react"));
        assert_eq!(keys.len(), registry.catalog().len());
        assert_eq!(Registry::len(&registry), registry.catalog().len());
        // The catalog is static, so its version never moves.
        assert_eq!(Registry::version(&registry), 0);
        assert!(!Registry::is_empty(&registry));
    }
}
