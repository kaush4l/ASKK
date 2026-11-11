//! # tools
//! Selects which shared tools this engine may use. Config `use: [names]`. Element tools
//! (set_phase, scripts) and sub-engines need no selection. No prompt of its own: the engine
//! lists the final toolbox once.
use crate::core::{read, value, Component, Spec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Selects shared tools by name (`use`). An engine with no tools element has no shared tools.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default, rename = "use")]
    names: Vec<String>,
}

pub struct Tools {
    name: String,
    cfg: Cfg,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(Tools { name: s.name, cfg: read(&s.config)? }))
}

impl Component for Tools {
    fn kind(&self) -> &'static str { "tools" }
    fn category(&self) -> &'static str { "action" }
    fn icon(&self) -> &'static str { "wrench" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Tools }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { Value::Null }
    fn view(&self) -> crate::core::node::Node {
        let lines = if self.cfg.names.is_empty() { vec!["none".to_string()] } else { self.cfg.names.clone() };
        super::tile(&self.name, "tools", lines)
    }
    fn selects(&self, t: &str) -> bool {
        self.cfg.names.iter().any(|n| n == t)
    }
}
