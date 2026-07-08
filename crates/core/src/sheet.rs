//! The sheet: the typed working surface for one agent invocation.
//! `render` is a pure ordered projection; `absorb` is the only write path.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::contract::{Action, ParsedResponse};
use crate::element::Element;
use crate::request::{ContractWire, InferenceRequest, Message, Role, SectionKind};
use crate::signal::{Signal, SignalKind};
use crate::state::StateSnapshot;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Sheet {
    /// Ordered; order = render order.
    pub elements: Vec<Element>,
}

impl Sheet {
    /// Pure projection into the provider-agnostic request. Section order
    /// follows element order, except contract/format instructions which
    /// always render LAST.
    pub fn render(&self) -> InferenceRequest {
        let mode = self
            .elements
            .iter()
            .rev()
            .find_map(|e| match e {
                Element::OutputMode(m) => Some(*m),
                _ => None,
            })
            .unwrap_or_default();
        let mut req = InferenceRequest::default();
        let mut contract_instructions = None;
        for element in &self.elements {
            match element {
                Element::ToolManifest(specs) => req.tools = specs.clone(),
                Element::Contract(contract) => {
                    let instructions = contract.instructions(mode);
                    req.contract = ContractWire {
                        name: contract.name.clone(),
                        version: contract.version,
                        schema: contract.schema(),
                        instructions: instructions.clone(),
                        mode,
                    };
                    contract_instructions = Some(instructions);
                }
                Element::History(messages) => req.history.extend(messages.iter().cloned()),
                Element::Multimodal(parts) => req.parts.extend(parts.iter().cloned()),
                Element::InferenceConfig(config) => req.config = config.clone(),
                Element::OutputMode(_) => {}
                other => {
                    if let Some(section) = other.section() {
                        req.sections.push(section);
                    }
                }
            }
        }
        if let Some(instructions) = contract_instructions {
            req.sections.push((SectionKind::Contract, instructions));
        }
        req
    }

    /// The write path: apply the parsed effect (history append, state
    /// deltas) and emit the signals describing exactly what changed — no
    /// hidden mutation. Signals are unstamped; the runtime's log writer
    /// assigns seq/run_id/ts.
    pub fn absorb(&mut self, effect: &ParsedResponse) -> Vec<Signal> {
        let mut signals = Vec::new();

        // History append: the assistant's turn, verbatim.
        let content = match &effect.action {
            Action::Answer(text) => text.clone(),
            Action::ToolCalls(calls) => serde_json::to_string(calls).unwrap_or_default(),
        };
        let message = Message::new(Role::Assistant, content.clone());
        if let Some(history) = self.elements.iter_mut().find_map(|e| match e {
            Element::History(h) => Some(h),
            _ => None,
        }) {
            history.push(message);
        } else {
            self.elements.push(Element::History(vec![message]));
        }
        signals.push(Signal::unstamped(SignalKind::HistoryAppended {
            role: Role::Assistant,
            text: content,
        }));

        // State deltas: a `state` object in the parsed fields writes slices.
        if let Some(Value::Object(delta)) = effect.fields.get("state") {
            let snapshot = self.elements.iter_mut().find_map(|e| match e {
                Element::StateSnapshot(s) => Some(s),
                _ => None,
            });
            let snapshot = match snapshot {
                Some(s) => s,
                None => {
                    self.elements
                        .push(Element::StateSnapshot(StateSnapshot::default()));
                    match self.elements.last_mut() {
                        Some(Element::StateSnapshot(s)) => s,
                        _ => unreachable!("just pushed a StateSnapshot"),
                    }
                }
            };
            for (key, value) in delta {
                snapshot.slices.insert(key.clone(), value.clone());
                signals.push(Signal::unstamped(SignalKind::StateWritten {
                    key: key.clone(),
                }));
            }
        }
        signals
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::ActionPolicy;
    use crate::contract::{OutputMode, ParsedFormat};
    use crate::contracts;
    use crate::element::{Directive, Identity, Skill};
    use crate::phase::PhaseFrame;
    use crate::request::{InferenceConfig, Part};
    use crate::state::{MemoryBlock, StateSnapshot};
    use crate::tool::{Effect, ToolSpec};
    use serde_json::{json, Map};

    fn full_sheet() -> Sheet {
        let mut snapshot = StateSnapshot::default();
        snapshot.slices.insert("todo".into(), json!("fix"));
        Sheet {
            elements: vec![
                Element::Identity(Identity {
                    name: "Coder".into(),
                    soul: "Be honest.".into(),
                    role: "Writes Rust.".into(),
                }),
                Element::Directive(Directive {
                    text: "fix the bug".into(),
                }),
                Element::Skills(vec![Skill {
                    name: "concise".into(),
                    body: "brief".into(),
                }]),
                Element::ToolManifest(vec![ToolSpec {
                    name: "read".into(),
                    description: "read a file".into(),
                    input_schema: json!({"type": "object"}),
                    effect: Effect::Pure,
                }]),
                Element::Contract(contracts::react()),
                Element::StateSnapshot(snapshot),
                Element::Memory(MemoryBlock {
                    agent_id: "coder".into(),
                    content: "m".into(),
                }),
                Element::History(vec![Message::new(Role::User, "earlier")]),
                Element::UserInput("do it now".into()),
                Element::Multimodal(vec![Part::Image {
                    media_type: "image/png".into(),
                    data_base64: "AA==".into(),
                }]),
                Element::InferenceConfig(InferenceConfig {
                    model: "gpt-x".into(),
                    ..Default::default()
                }),
                Element::ActionPolicy(ActionPolicy::default()),
                Element::OutputMode(OutputMode::Toon),
                Element::PhaseFrame(PhaseFrame {
                    name: "execute".into(),
                    header: "Go.".into(),
                    artifacts: vec![],
                }),
            ],
        }
    }

    #[test]
    fn render_projects_every_element() {
        let req = full_sheet().render();
        assert_eq!(req.tools.len(), 1);
        assert_eq!(req.history.len(), 1);
        assert_eq!(req.parts.len(), 1);
        assert_eq!(req.config.model, "gpt-x");
        assert_eq!(req.contract.name, "react");
        assert_eq!(req.contract.mode, OutputMode::Toon);
        let kinds: Vec<SectionKind> = req.sections.iter().map(|(k, _)| *k).collect();
        for kind in [
            SectionKind::Identity,
            SectionKind::Directive,
            SectionKind::Skills,
            SectionKind::State,
            SectionKind::Memory,
            SectionKind::UserInput,
            SectionKind::ActionPolicy,
            SectionKind::Phase,
            SectionKind::Contract,
        ] {
            assert!(kinds.contains(&kind), "missing section {kind:?}");
        }
    }

    #[test]
    fn contract_instructions_render_last() {
        let req = full_sheet().render();
        let (kind, text) = req.sections.last().unwrap();
        assert_eq!(*kind, SectionKind::Contract);
        assert!(text.contains("one line per field")); // TOON instructions
                                                      // ...even though the Contract element sits mid-sheet.
        let contract_positions: Vec<usize> = req
            .sections
            .iter()
            .enumerate()
            .filter(|(_, (k, _))| *k == SectionKind::Contract)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(contract_positions, vec![req.sections.len() - 1]);
    }

    #[test]
    fn render_is_pure() {
        let sheet = full_sheet();
        assert_eq!(sheet.render(), sheet.render());
    }

    #[test]
    fn output_mode_element_drives_contract_mode() {
        let mut sheet = full_sheet();
        sheet.elements.push(Element::OutputMode(OutputMode::Json)); // last wins
        let req = sheet.render();
        assert_eq!(req.contract.mode, OutputMode::Json);
        assert!(req.sections.last().unwrap().1.contains("JSON object"));
    }

    #[test]
    fn absorb_appends_history_and_emits_signals() {
        let mut sheet = full_sheet();
        let parsed = ParsedResponse {
            fields: Map::new(),
            action: Action::Answer("done".into()),
            format: ParsedFormat::Toon,
        };
        let signals = sheet.absorb(&parsed);
        assert_eq!(signals.len(), 1);
        assert!(matches!(
            &signals[0].kind,
            SignalKind::HistoryAppended { role: Role::Assistant, text } if text == "done"
        ));
        let req = sheet.render();
        assert_eq!(req.history.len(), 2);
        assert_eq!(req.history[1].content, "done");
    }

    #[test]
    fn absorb_writes_state_deltas_explicitly() {
        let mut sheet = full_sheet();
        let mut fields = Map::new();
        fields.insert("state".into(), json!({"progress": "half"}));
        let parsed = ParsedResponse {
            fields,
            action: Action::Answer("ok".into()),
            format: ParsedFormat::Json,
        };
        let signals = sheet.absorb(&parsed);
        assert!(signals
            .iter()
            .any(|s| matches!(&s.kind, SignalKind::StateWritten { key } if key == "progress")));
        let snapshot = sheet.elements.iter().find_map(|e| match e {
            Element::StateSnapshot(s) => Some(s),
            _ => None,
        });
        assert_eq!(snapshot.unwrap().slices["progress"], json!("half"));
    }

    #[test]
    fn absorb_creates_history_element_when_missing() {
        let mut sheet = Sheet::default();
        let parsed = ParsedResponse {
            fields: Map::new(),
            action: Action::Answer("first".into()),
            format: ParsedFormat::Toon,
        };
        sheet.absorb(&parsed);
        assert_eq!(sheet.render().history.len(), 1);
    }
}
