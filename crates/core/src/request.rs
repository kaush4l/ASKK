//! The rendered sheet: provider-agnostic request/reply wire types.
//! Providers consume these; they never re-template (ADR-002).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::contract::OutputMode;
use crate::tool::ToolSpec;

/// Named system-side request sections a sheet renders into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    Identity,
    Directive,
    Skills,
    State,
    Memory,
    UserInput,
    ActionPolicy,
    Phase,
    /// Live task state, re-read from its source before every call (ADR-033).
    Artifact,
    Contract,
}

impl SectionKind {
    pub fn name(self) -> &'static str {
        match self {
            SectionKind::Identity => "identity",
            SectionKind::Directive => "directive",
            SectionKind::Skills => "skills",
            SectionKind::State => "state",
            SectionKind::Memory => "memory",
            SectionKind::UserInput => "user_input",
            SectionKind::ActionPolicy => "action_policy",
            SectionKind::Phase => "phase",
            SectionKind::Artifact => "artifact",
            SectionKind::Contract => "contract",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

impl Message {
    pub fn new(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
        }
    }
}

/// Multimodal input part. Providers map or drop these.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Part {
    Image {
        media_type: String,
        data_base64: String,
    },
    Audio {
        media_type: String,
        data_base64: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InferenceConfig {
    /// Provider profile id (resolved by the inference registry).
    pub provider: String,
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

impl Default for InferenceConfig {
    fn default() -> Self {
        Self {
            provider: "default".into(),
            model: String::new(),
            temperature: None,
            max_tokens: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
}

/// Contract on the wire: native schema for providers that support structured
/// output, format instructions text for those that don't.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ContractWire {
    pub name: String,
    pub version: u8,
    pub schema: Value,
    pub instructions: String,
    pub mode: OutputMode,
}

/// The rendered sheet — everything a provider needs, nothing it re-composes.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct InferenceRequest {
    /// System-side, ordered. Contract/format instructions are always last.
    pub sections: Vec<(SectionKind, String)>,
    pub history: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    pub contract: ContractWire,
    pub parts: Vec<Part>,
    pub config: InferenceConfig,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct InferenceReply {
    pub text: String,
    /// Empty if the provider has no native tool calling.
    pub native_tool_calls: Vec<ToolCall>,
    pub usage: Option<Usage>,
}

impl InferenceReply {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_kind_names_are_stable() {
        assert_eq!(SectionKind::Identity.name(), "identity");
        assert_eq!(SectionKind::Contract.name(), "contract");
        assert_eq!(SectionKind::UserInput.name(), "user_input");
    }

    #[test]
    fn request_round_trips_through_serde() {
        let req = InferenceRequest {
            sections: vec![(SectionKind::Directive, "do it".into())],
            history: vec![Message::new(Role::User, "hi")],
            ..Default::default()
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: InferenceRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back, req);
    }

    #[test]
    fn default_config_targets_default_profile() {
        let cfg = InferenceConfig::default();
        assert_eq!(cfg.provider, "default");
        assert!(cfg.temperature.is_none());
    }
}
