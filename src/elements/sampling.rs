//! # sampling
//! How creative each request is. Presets are prebuilt (`default` sends nothing, so the model's
//! own default applies; `precise`, `balanced`, `creative`), and config can add or override them.
//! Config picks a preset for the engine (`use`) and per phase (`phases`); the `sampling` tool lets
//! the engine switch preset for its goal (kept in state until changed).
//!
//! ```json
//! {"kind": "sampling", "name": "sampling", "config": {
//!   "use": "balanced",
//!   "phases": {"plan": "precise", "refocus": "precise", "explore": "creative"},
//!   "presets": {"code": {"temperature": 0.1}}
//! }}
//! ```
use crate::core::{read, tool, Component, Event, Sampling, Spec, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

const DOC: &str = "Sampling presets (default = model's own; precise, balanced, creative) per engine and per phase; `sampling {preset}` switches.";

/// Prebuilt presets. `default` is empty on purpose: nothing is sent.
pub fn builtin() -> BTreeMap<String, Sampling> {
    let p = |t: f32, top: Option<f32>| Sampling { temperature: Some(t), top_p: top };
    BTreeMap::from([
        ("default".into(), Sampling::default()),
        ("precise".into(), p(0.2, None)),
        ("balanced".into(), p(0.7, None)),
        ("creative".into(), p(1.0, Some(0.95))),
    ])
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Cfg {
    #[serde(default, rename = "use", skip_serializing_if = "String::is_empty")]
    preset: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    phases: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    presets: BTreeMap<String, Sampling>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct St {
    /// Preset chosen by the engine with the `sampling` tool; wins over `use`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    chosen: String,
}

pub struct SamplingEl {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let el = SamplingEl { name: s.name, cfg: read(&s.config)?, st: read(&s.state)? };
    for p in el.cfg.phases.values().chain([&el.cfg.preset]).filter(|p| !p.is_empty()) {
        if !el.all().contains_key(p) {
            return Err(format!("unknown preset '{p}'"));
        }
    }
    Ok(Box::new(el))
}

impl SamplingEl {
    fn all(&self) -> BTreeMap<String, Sampling> {
        let mut m = builtin();
        m.extend(self.cfg.presets.clone());
        m
    }
    /// Preset name for a phase: the phase's own, else the chosen one, else `use`, else default.
    fn pick(&self, phase: Option<&str>) -> String {
        phase
            .and_then(|p| self.cfg.phases.get(p))
            .or((!self.st.chosen.is_empty()).then_some(&self.st.chosen))
            .or((!self.cfg.preset.is_empty()).then_some(&self.cfg.preset))
            .cloned()
            .unwrap_or_else(|| "default".into())
    }
    fn describe(name: &str, s: &Sampling) -> String {
        let mut parts = vec![];
        if let Some(t) = s.temperature { parts.push(format!("temperature {t}")); }
        if let Some(p) = s.top_p { parts.push(format!("top_p {p}")); }
        if parts.is_empty() { format!("{name}: model default") } else { format!("{name}: {}", parts.join(", ")) }
    }
}

impl Component for SamplingEl {
    fn kind(&self) -> &'static str { "sampling" }
    fn unique(&self) -> bool { true }
    fn category(&self) -> &'static str { "model" }
    fn icon(&self) -> &'static str { "sliders" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Other }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { serde_json::to_value(&self.cfg).unwrap_or_default() }
    fn state(&self) -> Value {
        if self.st.chosen.is_empty() { Value::Null } else { serde_json::to_value(&self.st).unwrap_or_default() }
    }
    fn view(&self) -> crate::core::node::Node {
        let now = self.pick(None);
        let mut lines = vec![format!("now: {now}")];
        lines.extend(self.cfg.phases.iter().map(|(p, n)| format!("phase {p} → {n}")));
        lines.extend(self.all().iter().map(|(n, s)| Self::describe(n, s)));
        super::tile(&self.name, "sampling", lines)
    }
    fn indicator(&self) -> Option<String> {
        Some(self.pick(None))
    }
    fn on(&mut self, ev: &Event) {
        if let Event::Called { tool, args, result } = ev {
            if tool == "sampling" && !result.starts_with("error") {
                if let Some(p) = args["preset"].as_str() {
                    self.st.chosen = p.into();
                }
            }
        }
    }
    fn prompt(&self) -> Option<String> {
        let names: Vec<String> = self.all().iter().map(|(n, s)| Self::describe(n, s)).collect();
        Some(format!("Sampling now: {}. Switch with the `sampling` tool when the work changes (precise for exact edits and facts, creative for ideas). Presets: {}.", self.pick(None), names.join("; ")))
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        let names: Vec<String> = self.all().into_keys().collect();
        vec![tool("sampling", "switch the sampling preset for the next requests", json!({"preset": names.join(" | ")}), move |a| {
            match a["preset"].as_str() {
                Some(p) if names.iter().any(|n| n == p) => Ok(json!(format!("sampling: {p}"))),
                Some(p) => Err(format!("unknown preset '{p}'")),
                None => Err("preset missing".into()),
            }
        })]
    }
    fn sampling(&self, phase: Option<&str>) -> Option<Sampling> {
        Some(self.all().get(&self.pick(phase)).cloned().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(config: Value) -> Box<dyn Component> {
        new(Spec { kind: "sampling".into(), name: "sampling".into(), config, state: Value::Null }).unwrap()
    }

    #[test]
    fn default_sends_nothing_so_the_model_decides() {
        assert_eq!(el(Value::Null).sampling(None), Some(Sampling::default()));
        assert_eq!(serde_json::to_value(Sampling::default()).unwrap(), json!({}));
    }

    #[test]
    fn phases_override_the_engine_preset_and_custom_presets_work() {
        let e = el(json!({"use": "balanced", "phases": {"plan": "precise", "draft": "mine"}, "presets": {"mine": {"temperature": 0.4}}}));
        assert_eq!(e.sampling(None).unwrap().temperature, Some(0.7));
        assert_eq!(e.sampling(Some("plan")).unwrap().temperature, Some(0.2));
        assert_eq!(e.sampling(Some("draft")).unwrap().temperature, Some(0.4));
        assert_eq!(e.sampling(Some("other")).unwrap().temperature, Some(0.7));
        assert!(new(Spec { kind: "sampling".into(), name: "s".into(), config: json!({"use": "nope"}), state: Value::Null }).is_err());
    }

    #[tokio::test]
    async fn the_engine_switches_preset_with_the_tool() {
        let mut e = el(json!({"phases": {"plan": "precise"}}));
        let t = e.tools();
        assert!(t[0].invoke(json!({"preset": "nope"}), crate::core::Toolbox(Default::default(), None)).await.is_err());
        e.on(&Event::Called { tool: "sampling".into(), args: json!({"preset": "creative"}), result: "sampling: creative".into() });
        assert_eq!(e.sampling(None).unwrap().top_p, Some(0.95));
        assert_eq!(e.sampling(Some("plan")).unwrap().temperature, Some(0.2), "a phase's own preset still wins");
        assert_eq!(e.state(), json!({"chosen": "creative"}));
    }
}
