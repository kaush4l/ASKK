use crate::inference::{get_implementation, InferenceProvider, InferenceRequest};
use crate::responses::{parse_tool_calls, ReActAction, ResponseFormat};
use crate::state::{
    event, now_iso, Agent, AgentEventKind, AgentRun, AppResult, AppSnapshot, Message, ToolCall,
};
use crate::tools::ToolRegistry;
use uuid::Uuid;

pub trait RuntimeObject {
    fn name(&self) -> &str;
    fn is_initialized(&self) -> bool;
    fn initialize(&mut self);
    fn shutdown(&mut self);
}

#[derive(Clone, Debug)]
pub struct BrowserAgent {
    pub definition: Agent,
    pub history: Vec<Message>,
    pub response_format: ResponseFormat,
    initialized: bool,
}

impl BrowserAgent {
    pub fn new(definition: Agent) -> Self {
        let response_format = if definition.name.contains("Synthesizer") {
            ResponseFormat::Json
        } else {
            ResponseFormat::Toon
        };
        Self {
            definition,
            history: Vec::new(),
            response_format,
            initialized: false,
        }
    }

    pub fn enabled_tool_specs(&self, tools: &ToolRegistry) -> Vec<crate::state::ToolSpec> {
        tools.specs_for_agent(&self.definition.enabled_tools)
    }

    pub fn remember(&mut self, role: impl Into<String>, content: impl Into<String>) {
        self.history.push(Message {
            role: role.into(),
            content: content.into(),
        });
    }
}

impl RuntimeObject for BrowserAgent {
    fn name(&self) -> &str {
        &self.definition.name
    }

    fn is_initialized(&self) -> bool {
        self.initialized
    }

    fn initialize(&mut self) {
        self.initialized = true;
    }

    fn shutdown(&mut self) {
        self.initialized = false;
    }
}

#[derive(Clone, Debug, Default)]
pub struct ReActEngine {
    tools: ToolRegistry,
}

impl ReActEngine {
    pub fn new() -> Self {
        Self {
            tools: ToolRegistry::new(),
        }
    }

    pub async fn run_goal(
        &self,
        mut snapshot: AppSnapshot,
        goal: String,
    ) -> AppResult<AppSnapshot> {
        let run_id = Uuid::new_v4().to_string();
        let mut run = AgentRun {
            id: run_id.clone(),
            goal: goal.clone(),
            status: "running".to_string(),
            messages: Vec::new(),
            events: vec![event(
                &run_id,
                None,
                AgentEventKind::Started,
                "Run started",
                format!("Goal: {goal}"),
            )],
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: now_iso(),
        };

        let agents = snapshot
            .agents
            .iter()
            .filter(|agent| agent.enabled)
            .cloned()
            .map(BrowserAgent::new)
            .collect::<Vec<_>>();

        if agents.is_empty() {
            return Ok(self.finish_with_error(
                snapshot,
                run,
                "No enabled agents",
                "Enable at least one agent before running a goal.",
            ));
        }

        for mut agent in agents {
            agent.initialize();
            if !agent.is_initialized() {
                continue;
            }
            self.invoke_agent(&mut snapshot, &mut run, &mut agent, &goal)
                .await;
            agent.shutdown();

            if run.status == "error" {
                snapshot.status = "Provider call failed".to_string();
                snapshot.current_run = Some(run.clone());
                snapshot.runs.insert(0, run);
                return Ok(snapshot);
            }
        }

        if run.final_answer.trim().is_empty() {
            run.final_answer = build_local_final_answer(&run);
            run.events.push(event(
                &run_id,
                None,
                AgentEventKind::FinalAnswer,
                "Local final answer",
                run.final_answer.clone(),
            ));
        }

        run.status = "complete".to_string();
        snapshot.status = "Run complete".to_string();
        snapshot.current_run = Some(run.clone());
        snapshot.runs.insert(0, run);
        Ok(snapshot)
    }

    async fn invoke_agent(
        &self,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        agent: &mut BrowserAgent,
        goal: &str,
    ) {
        let specs = agent.enabled_tool_specs(&self.tools);
        let run_id = run.id.clone();
        let agent_id = agent.definition.id.clone();
        let inference = get_implementation(&snapshot.provider);
        run.events.push(event(
            &run_id,
            Some(agent_id.clone()),
            AgentEventKind::LlmRequest,
            format!("{} thinking", agent.name()),
            format!(
                "Sending goal and {} compiled tool specs to {} provider.",
                specs.len(),
                inference.provider_name()
            ),
        ));

        let request = InferenceRequest {
            agent_name: agent.definition.name.clone(),
            agent_role: agent.definition.role.clone(),
            soul: snapshot.soul.clone(),
            skills: snapshot.skills.clone(),
            goal: goal.to_string(),
            history: run.messages.clone(),
            tools: specs,
            response_format: agent.response_format,
        };

        let output = match inference.invoke_react(&snapshot.provider, request).await {
            Ok(output) => output,
            Err(err) => {
                run.status = "error".to_string();
                run.events.push(event(
                    &run_id,
                    Some(agent_id),
                    AgentEventKind::Error,
                    format!("{} provider error", agent.definition.name),
                    err,
                ));
                return;
            }
        };

        agent.remember(
            "assistant",
            format!(
                "[action={}] {}",
                output.parsed.action.as_str(),
                output.parsed.response
            ),
        );
        run.messages.push(Message {
            role: "assistant".to_string(),
            content: format!("{}: {}", agent.definition.name, output.raw_text),
        });
        run.events.push(event(
            &run_id,
            Some(agent_id.clone()),
            AgentEventKind::LlmResponse,
            format!("{} responded", agent.definition.name),
            format!(
                "observation: {}\nthinking: {}\nplan: {}\naction: {}\nresponse: {}",
                output.parsed.observation,
                output.parsed.thinking,
                output.parsed.plan.join(", "),
                output.parsed.action.as_str(),
                output.parsed.response
            ),
        ));

        match output.parsed.action {
            ReActAction::Tool => {
                let tool_calls = parse_tool_calls(&output.parsed.response);
                if tool_calls.is_empty() {
                    run.events.push(event(
                        &run_id,
                        Some(agent_id),
                        AgentEventKind::Error,
                        "Tool parse error",
                        format!(
                            "No valid tool call found in response: {}",
                            output.parsed.response
                        ),
                    ));
                    return;
                }

                for tool_call in tool_calls {
                    self.execute_tool_call(snapshot, run, agent, tool_call.name, tool_call.args)
                        .await;
                }
            }
            ReActAction::Answer => {
                let answer = output.parsed.final_text();
                if !answer.trim().is_empty() {
                    run.final_answer = answer.clone();
                    run.events.push(event(
                        &run_id,
                        Some(agent_id),
                        AgentEventKind::FinalAnswer,
                        format!("{} final answer", agent.definition.name),
                        answer,
                    ));
                }
            }
        }
    }

    async fn execute_tool_call(
        &self,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        agent: &BrowserAgent,
        name: String,
        args: serde_json::Value,
    ) {
        let run_id = run.id.clone();
        let agent_id = agent.definition.id.clone();
        if !agent
            .definition
            .enabled_tools
            .iter()
            .any(|tool| tool == &name)
        {
            run.events.push(event(
                &run_id,
                Some(agent_id),
                AgentEventKind::Error,
                "Tool disabled",
                format!(
                    "{} requested `{name}`, but it is not enabled for this agent.",
                    agent.definition.name
                ),
            ));
            return;
        }

        let call_id = Uuid::new_v4().to_string();
        let call = ToolCall {
            id: call_id.clone(),
            agent_id: agent_id.clone(),
            tool_name: name.clone(),
            arguments: args.clone(),
        };
        run.tool_calls.push(call);
        run.events.push(event(
            &run_id,
            Some(agent_id.clone()),
            AgentEventKind::ToolRequested,
            format!("{} called {}", agent.definition.name, name),
            serde_json::to_string_pretty(&args).unwrap_or_else(|_| "{}".to_string()),
        ));

        let result = self.tools.execute(snapshot, call_id, &name, args).await;
        run.messages.push(Message {
            role: "tool".to_string(),
            content: format!("{} -> {}", name, result.content),
        });
        run.events.push(event(
            &run_id,
            Some(agent_id),
            AgentEventKind::ToolCompleted,
            format!("{} completed", name),
            result.content.clone(),
        ));
        run.tool_results.push(result);
    }

    fn finish_with_error(
        &self,
        mut snapshot: AppSnapshot,
        mut run: AgentRun,
        title: &str,
        body: &str,
    ) -> AppSnapshot {
        run.status = "error".to_string();
        run.events
            .push(event(&run.id, None, AgentEventKind::Error, title, body));
        snapshot.current_run = Some(run);
        snapshot.status = title.to_string();
        snapshot
    }
}

fn build_local_final_answer(run: &AgentRun) -> String {
    let tool_count = run.tool_results.len();
    let last_message = run
        .messages
        .last()
        .map(|message| message.content.as_str())
        .unwrap_or("No assistant output was produced.");
    format!(
        "Run completed with {tool_count} compiled tool result(s). Last agent output: {last_message}"
    )
}
