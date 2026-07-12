//! Element: one typed unit on a sheet. A closed enum (ADR-001) so render is
//! exhaustive and serialization is free. Text-bearing elements project into
//! named sections here; structural elements are mapped in `Sheet::render`.

use serde::{Deserialize, Serialize};

use crate::action::ActionPolicy;
use crate::contract::{Contract, OutputMode};
use crate::phase::PhaseFrame;
use crate::request::{InferenceConfig, Message, Part, SectionKind};
use crate::state::{MemoryBlock, StateSnapshot};
use crate::tool::ToolSpec;

/// Soul + name + role body.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Identity {
    pub name: String,
    pub soul: String,
    pub role: String,
}

/// The current task/goal framing.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Directive {
    pub text: String,
}

/// A named markdown fragment composed onto the sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Element {
    Identity(Identity),
    Directive(Directive),
    Skills(Vec<Skill>),
    /// What the model is SHOWN (⊆ the dispatch allowlist).
    ToolManifest(Vec<ToolSpec>),
    /// Response schema; its format instructions always render LAST.
    Contract(Contract),
    StateSnapshot(StateSnapshot),
    Memory(MemoryBlock),
    /// Conversation prefix + in-run turns.
    History(Vec<Message>),
    UserInput(String),
    /// Images/audio; providers map or drop.
    Multimodal(Vec<Part>),
    InferenceConfig(InferenceConfig),
    ActionPolicy(ActionPolicy),
    /// json | toon | text — negotiated per failure count.
    OutputMode(OutputMode),
    PhaseFrame(PhaseFrame),
    /// Live task state `(name, content)`, refreshed from its source before
    /// EVERY call — the model sees only the latest version of each artifact,
    /// never the mutation trail (ADR-033).
    Artifacts(Vec<(String, String)>),
}

impl Element {
    /// Text-section projection. Structural elements (tools, contract,
    /// history, multimodal, config, output mode) contribute to dedicated
    /// request fields in `Sheet::render` and return `None` here.
    pub fn section(&self) -> Option<(SectionKind, String)> {
        match self {
            Element::Identity(identity) => {
                let mut parts = Vec::new();
                if !identity.soul.is_empty() {
                    parts.push(identity.soul.clone());
                }
                let mut who = format!("You are {}.", identity.name);
                if !identity.role.is_empty() {
                    who.push(' ');
                    who.push_str(&identity.role);
                }
                parts.push(who);
                Some((SectionKind::Identity, parts.join("\n\n")))
            }
            Element::Directive(directive) => Some((SectionKind::Directive, directive.text.clone())),
            Element::Skills(skills) => {
                let body = skills
                    .iter()
                    .map(|s| format!("## {}\n{}", s.name, s.body))
                    .collect::<Vec<_>>()
                    .join("\n\n");
                Some((SectionKind::Skills, body))
            }
            Element::StateSnapshot(snapshot) => {
                let body = snapshot
                    .slices
                    .iter()
                    .map(|(key, value)| format!("{key}: {value}"))
                    .collect::<Vec<_>>()
                    .join("\n");
                Some((SectionKind::State, body))
            }
            Element::Memory(memory) => Some((SectionKind::Memory, memory.content.clone())),
            Element::UserInput(text) => Some((SectionKind::UserInput, text.clone())),
            Element::ActionPolicy(policy) => Some((SectionKind::ActionPolicy, policy.summary())),
            Element::PhaseFrame(frame) => {
                let mut body = format!("# Phase: {}\n{}", frame.name, frame.header);
                for (name, content) in &frame.artifacts {
                    body.push_str(&format!("\n\n## artifact: {name}\n{content}"));
                }
                Some((SectionKind::Phase, body))
            }
            Element::Artifacts(blocks) => {
                let text: Vec<String> = blocks
                    .iter()
                    .map(|(name, content)| {
                        format!(
                            "ARTIFACT {name} (live state — this is the LATEST \
                             version; earlier copies in history are stale):\n{content}"
                        )
                    })
                    .collect();
                Some((SectionKind::Artifact, text.join("\n\n")))
            }
            Element::ToolManifest(_)
            | Element::Contract(_)
            | Element::History(_)
            | Element::Multimodal(_)
            | Element::InferenceConfig(_)
            | Element::OutputMode(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identity_renders_soul_name_role() {
        let element = Element::Identity(Identity {
            name: "Coder".into(),
            soul: "Be honest.".into(),
            role: "You write Rust.".into(),
        });
        let (kind, text) = element.section().unwrap();
        assert_eq!(kind, SectionKind::Identity);
        assert_eq!(text, "Be honest.\n\nYou are Coder. You write Rust.");
    }

    #[test]
    fn identity_without_soul_has_no_leading_gap() {
        let element = Element::Identity(Identity {
            name: "A".into(),
            ..Default::default()
        });
        assert_eq!(element.section().unwrap().1, "You are A.");
    }

    #[test]
    fn every_text_element_renders_its_section() {
        let mut snapshot = StateSnapshot::default();
        snapshot.slices.insert("todo".into(), json!(["x"]));
        let cases: Vec<(Element, SectionKind, &str)> = vec![
            (
                Element::Directive(Directive {
                    text: "fix the bug".into(),
                }),
                SectionKind::Directive,
                "fix the bug",
            ),
            (
                Element::Skills(vec![Skill {
                    name: "concise".into(),
                    body: "be brief".into(),
                }]),
                SectionKind::Skills,
                "## concise\nbe brief",
            ),
            (
                Element::StateSnapshot(snapshot),
                SectionKind::State,
                "todo: [\"x\"]",
            ),
            (
                Element::Memory(MemoryBlock {
                    agent_id: "coder".into(),
                    content: "likes tabs".into(),
                }),
                SectionKind::Memory,
                "likes tabs",
            ),
            (
                Element::UserInput("hello".into()),
                SectionKind::UserInput,
                "hello",
            ),
            (
                Element::ActionPolicy(ActionPolicy::default()),
                SectionKind::ActionPolicy,
                "Pure tools: auto",
            ),
            (
                Element::PhaseFrame(PhaseFrame {
                    name: "execute".into(),
                    header: "Do the plan.".into(),
                    artifacts: vec![("plan".into(), "1. fix".into())],
                }),
                SectionKind::Phase,
                "## artifact: plan",
            ),
            (
                Element::Artifacts(vec![("BOARD".into(), "backlog 2".into())]),
                SectionKind::Artifact,
                "ARTIFACT BOARD (live state",
            ),
        ];
        for (element, kind, needle) in cases {
            let (got_kind, text) = element.section().unwrap();
            assert_eq!(got_kind, kind);
            assert!(text.contains(needle), "{kind:?} missing {needle:?}: {text}");
        }
    }

    #[test]
    fn structural_elements_have_no_text_section() {
        for element in [
            Element::ToolManifest(vec![]),
            Element::History(vec![]),
            Element::Multimodal(vec![]),
            Element::InferenceConfig(InferenceConfig::default()),
            Element::OutputMode(OutputMode::Toon),
        ] {
            assert!(element.section().is_none());
        }
    }

    #[test]
    fn element_round_trips_through_serde() {
        let element = Element::UserInput("hi".into());
        let text = serde_json::to_string(&element).unwrap();
        let back: Element = serde_json::from_str(&text).unwrap();
        assert_eq!(back, element);
    }
}
