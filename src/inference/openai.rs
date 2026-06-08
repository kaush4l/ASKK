//! The OpenAI-compatible provider: assembles the system prompt (soul + role +
//! tools + skills + response-format instructions) and the wire transcript, calls
//! the chat-completions endpoint through [`transport`](super::transport), and parses
//! the reply into a [`ReActResponse`]. Any BYOK endpoint speaking this API works.

use serde::Serialize;
use serde_json::json;

use super::transport::{assistant_content, send_chat_completion, send_chat_completion_stream};
use super::{InferenceOutput, InferenceProvider, InferenceRequest};
use crate::responses::{ReActResponse, response_to_result};
use crate::state::{AppResult, Message, ProviderConfig};

#[derive(Clone, Debug, Default)]
pub struct OpenAiCompatibleInference;

#[derive(Debug, Serialize)]
struct WireMessage {
    role: String,
    content: String,
}

impl InferenceProvider for OpenAiCompatibleInference {
    async fn invoke_react(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        let raw_text = self.invoke_text(config, &request).await?;
        let parsed = response_to_result::<ReActResponse>(&raw_text)?;
        Ok(InferenceOutput { raw_text, parsed })
    }

    async fn invoke_react_streaming(
        &self,
        config: &ProviderConfig,
        request: InferenceRequest,
        on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<InferenceOutput<ReActResponse>> {
        match self
            .invoke_text_streaming(config, &request, on_partial_answer)
            .await
        {
            Ok(raw_text) => {
                let parsed = response_to_result::<ReActResponse>(&raw_text)?;
                Ok(InferenceOutput { raw_text, parsed })
            }
            Err(_) => self.invoke_react(config, request).await,
        }
    }
}

impl OpenAiCompatibleInference {
    async fn invoke_text(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
    ) -> AppResult<String> {
        let messages = self.normalize_messages(request)?;
        let mut body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        });
        if let Some(top_p) = config.top_p {
            body["top_p"] = json!(top_p);
        }

        let parsed = send_chat_completion(config, body).await?;
        assistant_content(parsed)
    }

    async fn invoke_text_streaming(
        &self,
        config: &ProviderConfig,
        request: &InferenceRequest,
        on_partial_answer: &mut dyn FnMut(String),
    ) -> AppResult<String> {
        let messages = self.normalize_messages(request)?;
        let mut body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": true,
        });
        if let Some(top_p) = config.top_p {
            body["top_p"] = json!(top_p);
        }

        send_chat_completion_stream(config, body, on_partial_answer).await
    }

    fn normalize_messages(&self, request: &InferenceRequest) -> AppResult<Vec<WireMessage>> {
        // The agent owns prompt formatting; the provider only wires the rendered
        // system prompt to the transcript and ships it.
        let system = crate::agent_prompt::render_system_prompt(request)?;

        let mut messages = vec![WireMessage {
            role: "system".to_string(),
            content: system,
        }];
        if request.history.is_empty() {
            // Single-shot fallback: no transcript supplied, send the goal directly.
            messages.push(WireMessage {
                role: "user".to_string(),
                content: format!("Goal: {}", request.goal),
            });
        } else {
            // The engine supplies the full ordered conversation (prior turns, the
            // current query, then this run's ReAct turns).
            messages.extend(request.history.iter().map(history_wire_message));
        }
        Ok(messages)
    }
}

fn history_wire_message(message: &Message) -> WireMessage {
    match message.role.as_str() {
        "assistant" => WireMessage {
            role: "assistant".to_string(),
            content: message.content.clone(),
        },
        "tool" => WireMessage {
            role: "user".to_string(),
            content: format!("Tool observation:\n{}", message.content),
        },
        "user" => WireMessage {
            role: "user".to_string(),
            content: message.content.clone(),
        },
        _ => WireMessage {
            role: "user".to_string(),
            content: format!("{}:\n{}", message.role, message.content),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::ResponseFormat;
    use crate::state::Skill;

    #[test]
    fn agent_calls_include_soul_prompt_before_role() {
        let request = InferenceRequest {
            agent_name: "Planner".to_string(),
            agent_role: "Plan carefully.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: vec![Skill {
                id: "care".to_string(),
                name: "Care".to_string(),
                content: "Work carefully.".to_string(),
                enabled: true,
                source_path: None,
            }],
            goal: "Ship it.".to_string(),
            history: Vec::new(),
            tools: Vec::new(),
            sub_agents: Vec::new(),
            response_format: ResponseFormat::Toon,
        };

        let messages = OpenAiCompatibleInference
            .normalize_messages(&request)
            .unwrap();
        let system = &messages[0].content;

        assert!(system.starts_with("Shared behavior."));
        assert!(
            system.find("You are Planner.").unwrap() > system.find("Shared behavior.").unwrap()
        );
        assert!(system.contains("Role:\nPlan carefully."));
        assert!(system.contains("## Care\nWork carefully."));
    }

    #[test]
    fn tool_history_is_sent_as_user_context() {
        let request = InferenceRequest {
            agent_name: "Researcher".to_string(),
            agent_role: "Research.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: Vec::new(),
            goal: "Find current info.".to_string(),
            history: vec![
                Message {
                    role: "assistant".to_string(),
                    content: "response: web_search({\"query\":\"askk\"})".to_string(),
                },
                Message {
                    role: "tool".to_string(),
                    content: "web_search -> {\"success\":true}".to_string(),
                },
            ],
            tools: Vec::new(),
            sub_agents: Vec::new(),
            response_format: ResponseFormat::Toon,
        };

        let messages = OpenAiCompatibleInference
            .normalize_messages(&request)
            .unwrap();
        // With a transcript supplied, the conversation follows the system message
        // directly (no separate "Goal:" turn): system, assistant, tool-as-user.
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[2].role, "user");
        assert!(messages[2].content.starts_with("Tool observation:\n"));
    }

    #[test]
    fn empty_history_falls_back_to_goal_message() {
        let request = InferenceRequest {
            agent_name: "Planner".to_string(),
            agent_role: "Plan.".to_string(),
            soul: "Shared behavior.".to_string(),
            skills: Vec::new(),
            goal: "Ship it.".to_string(),
            history: Vec::new(),
            tools: Vec::new(),
            sub_agents: Vec::new(),
            response_format: ResponseFormat::Toon,
        };

        let messages = OpenAiCompatibleInference
            .normalize_messages(&request)
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].role, "user");
        assert_eq!(messages[1].content, "Goal: Ship it.");
    }
}
