//! Sheet assembly: pure element-list construction in docs/MODELS.md order.
//! The runtime hands assemble the pieces; assemble only arranges them.

use askk_core::{
    ActionPolicy, Contract, Directive, Element, Identity, InferenceConfig, MemoryBlock, Message,
    OutputMode, Part, PhaseFrame, Sheet, Skill, StateSnapshot, ToolSpec,
};

use crate::config::{resolve_contract, AgentConfig};

/// Per-turn overrides applied AT assembly (no post-assembly sheet patching):
/// the phase's contract, a per-run directive, the negotiated output mode.
/// `None` = the agent-level default.
#[derive(Debug, Clone, Default)]
pub struct AssembleOverrides {
    pub contract: Option<Contract>,
    pub directive: Option<String>,
    pub output_mode: Option<OutputMode>,
}

/// Build the sheet for one agent invocation.
///
/// Element order (docs/MODELS.md): Identity, Directive, Clock, Skills,
/// ToolManifest, Contract, StateSnapshot, Memory, History, UserInput,
/// Multimodal (only when parts exist), InferenceConfig, ActionPolicy,
/// OutputMode, PhaseFrame (opt).
///
/// `clock_ms` is the injected wall clock (unix ms) — rendered as a standing
/// "time" section right after the soul/agent framing; there is no `now` tool.
///
/// Precondition: `agent` passed `config::validate` — the contract name must
/// resolve. An unvalidated config panics here rather than silently degrading.
#[allow(clippy::too_many_arguments)] // the pieces are explicit params by design
pub fn assemble(
    agent: &AgentConfig,
    soul: &str,
    clock_ms: u64,
    skills: Vec<Skill>,
    input: &str,
    snapshot: StateSnapshot,
    memory: MemoryBlock,
    history: Vec<Message>,
    tool_specs: Vec<ToolSpec>,
    parts: Vec<Part>,
    policy: ActionPolicy,
    config: InferenceConfig,
    phase_frame: Option<PhaseFrame>,
    overrides: AssembleOverrides,
) -> Sheet {
    let contract = overrides.contract.unwrap_or_else(|| {
        resolve_contract(agent, &agent.contract).unwrap_or_else(|e| {
            panic!(
                "{}: {e} — run config::validate before assemble",
                agent.source_path
            )
        })
    });
    let mut elements = vec![
        Element::Identity(Identity {
            name: agent.name.clone(),
            soul: soul.to_string(),
            role: agent.body.clone(),
        }),
        // ponytail: the agent card is the standing goal framing; the live task
        // arrives via UserInput. Overrides carry a per-run directive.
        Element::Directive(Directive {
            text: overrides
                .directive
                .unwrap_or_else(|| agent.description.clone()),
        }),
        Element::Clock(clock_ms),
        Element::Skills(skills),
        Element::ToolManifest(tool_specs),
        Element::Contract(contract),
        Element::StateSnapshot(snapshot),
        Element::Memory(memory),
        Element::History(history),
        Element::UserInput(input.to_string()),
    ];
    if !parts.is_empty() {
        elements.push(Element::Multimodal(parts));
    }
    elements.push(Element::InferenceConfig(config));
    elements.push(Element::ActionPolicy(policy));
    elements.push(Element::OutputMode(
        overrides.output_mode.unwrap_or(agent.format),
    ));
    if let Some(frame) = phase_frame {
        elements.push(Element::PhaseFrame(frame));
    }
    Sheet { elements }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::Effect;
    use serde_json::json;

    fn agent() -> AgentConfig {
        AgentConfig::from_markdown(
            "agents/coder.md",
            "---\nid: coder\nname: Coder\ndescription: Writes code.\ntools: read\n---\nYou write Rust.",
        )
        .unwrap()
    }

    fn full_sheet(parts: Vec<Part>, phase_frame: Option<PhaseFrame>) -> Sheet {
        assemble(
            &agent(),
            "Be honest.",
            1_784_052_000_000,
            vec![Skill {
                name: "concise".into(),
                body: "brief".into(),
            }],
            "fix the bug",
            StateSnapshot::default(),
            MemoryBlock::default(),
            vec![Message::new(askk_core::Role::User, "earlier")],
            vec![ToolSpec {
                name: "read".into(),
                description: "read a file".into(),
                input_schema: json!({"type": "object"}),
                effect: Effect::Pure,
            }],
            parts,
            ActionPolicy::default(),
            InferenceConfig::default(),
            phase_frame,
            AssembleOverrides::default(),
        )
    }

    fn tag(element: &Element) -> &'static str {
        match element {
            Element::Identity(_) => "identity",
            Element::Directive(_) => "directive",
            Element::Clock(_) => "clock",
            Element::Skills(_) => "skills",
            Element::ToolManifest(_) => "tool_manifest",
            Element::Contract(_) => "contract",
            Element::StateSnapshot(_) => "state_snapshot",
            Element::Memory(_) => "memory",
            Element::History(_) => "history",
            Element::UserInput(_) => "user_input",
            Element::Multimodal(_) => "multimodal",
            Element::InferenceConfig(_) => "inference_config",
            Element::ActionPolicy(_) => "action_policy",
            Element::OutputMode(_) => "output_mode",
            Element::PhaseFrame(_) => "phase_frame",
            Element::Artifacts(_) => "artifacts",
        }
    }

    #[test]
    fn element_order_matches_models_md() {
        let sheet = full_sheet(
            vec![Part::Image {
                media_type: "image/png".into(),
                data_base64: "AA==".into(),
            }],
            Some(PhaseFrame {
                name: "execute".into(),
                header: "Go.".into(),
                artifacts: vec![],
            }),
        );
        let tags: Vec<&str> = sheet.elements.iter().map(tag).collect();
        assert_eq!(
            tags,
            vec![
                "identity",
                "directive",
                "clock",
                "skills",
                "tool_manifest",
                "contract",
                "state_snapshot",
                "memory",
                "history",
                "user_input",
                "multimodal",
                "inference_config",
                "action_policy",
                "output_mode",
                "phase_frame",
            ]
        );
    }

    #[test]
    fn rendered_section_names_golden() {
        let sheet = full_sheet(
            vec![],
            Some(PhaseFrame {
                name: "execute".into(),
                header: "Go.".into(),
                artifacts: vec![],
            }),
        );
        let req = sheet.render();
        let names: Vec<&str> = req.sections.iter().map(|(k, _)| k.name()).collect();
        assert_eq!(
            names,
            vec![
                "identity",
                "directive",
                "time",
                "skills",
                "state",
                "memory",
                "user_input",
                "action_policy",
                "phase",
                "contract", // format instructions always render LAST
            ]
        );
        assert_eq!(req.contract.name, "react");
        assert_eq!(req.tools.len(), 1);
        assert_eq!(req.history.len(), 1);
    }

    #[test]
    fn multimodal_and_phase_frame_appear_only_when_given() {
        let sheet = full_sheet(vec![], None);
        let tags: Vec<&str> = sheet.elements.iter().map(tag).collect();
        assert!(!tags.contains(&"multimodal"));
        assert!(!tags.contains(&"phase_frame"));
        assert_eq!(tags.last(), Some(&"output_mode"));
    }

    #[test]
    #[should_panic(expected = "run config::validate before assemble")]
    fn unvalidated_contract_panics_loudly() {
        let mut bad = agent();
        bad.contract = "mystery".into();
        full_sheet(vec![], None); // sanity: builder itself is fine
        assemble(
            &bad,
            "",
            0,
            vec![],
            "",
            StateSnapshot::default(),
            MemoryBlock::default(),
            vec![],
            vec![],
            vec![],
            ActionPolicy::default(),
            InferenceConfig::default(),
            None,
            AssembleOverrides::default(),
        );
    }

    #[test]
    fn overrides_apply_at_assembly_no_patching_needed() {
        let sheet = assemble(
            &agent(),
            "",
            0,
            vec![],
            "go",
            StateSnapshot::default(),
            MemoryBlock::default(),
            vec![],
            vec![],
            vec![],
            ActionPolicy::default(),
            InferenceConfig::default(),
            None,
            AssembleOverrides {
                contract: Some(askk_core::contracts::critique()),
                directive: Some("per-run directive".into()),
                output_mode: Some(askk_core::OutputMode::Json),
            },
        );
        let req = sheet.render();
        assert_eq!(req.contract.name, "critique");
        assert_eq!(req.contract.mode, askk_core::OutputMode::Json);
        assert!(req
            .sections
            .iter()
            .any(|(k, text)| k.name() == "directive" && text.contains("per-run directive")));
    }
}
