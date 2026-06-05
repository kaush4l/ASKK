use crate::inference::{get_implementation, InferenceProvider, InferenceRequest};
use crate::responses::{parse_tool_calls, ReActAction};
use crate::state::{
    event, now_iso, Agent, AgentEventKind, AgentRun, AppResult, AppSnapshot, Message, ToolCall,
    ToolResult, ToolSpec,
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
    initialized: bool,
}

impl BrowserAgent {
    pub fn new(definition: Agent) -> Self {
        Self {
            definition,
            history: Vec::new(),
            initialized: false,
        }
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

    #[allow(dead_code)]
    pub async fn run_goal(&self, snapshot: AppSnapshot, goal: String) -> AppResult<AppSnapshot> {
        self.run_goal_with_observer(snapshot, goal, |_| {}).await
    }

    pub async fn run_goal_with_observer<F>(
        &self,
        snapshot: AppSnapshot,
        goal: String,
        mut observer: F,
    ) -> AppResult<AppSnapshot>
    where
        F: FnMut(AgentRun),
    {
        let inference = get_implementation(&snapshot.provider);
        self.run_goal_with_parts_and_observer(
            snapshot,
            goal,
            &self.tools,
            &inference,
            &mut observer,
        )
        .await
    }

    #[cfg(test)]
    async fn run_goal_with_parts<Tools, Inference>(
        &self,
        snapshot: AppSnapshot,
        goal: String,
        tools: &Tools,
        inference: &Inference,
    ) -> AppResult<AppSnapshot>
    where
        Tools: AgentToolbox,
        Inference: InferenceProvider,
    {
        let mut observer = |_| {};
        self.run_goal_with_parts_and_observer(snapshot, goal, tools, inference, &mut observer)
            .await
    }

    async fn run_goal_with_parts_and_observer<Tools, Inference>(
        &self,
        mut snapshot: AppSnapshot,
        goal: String,
        tools: &Tools,
        inference: &Inference,
        observer: &mut dyn FnMut(AgentRun),
    ) -> AppResult<AppSnapshot>
    where
        Tools: AgentToolbox,
        Inference: InferenceProvider,
    {
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
        notify(observer, &run);

        let enabled_agents = snapshot
            .agents
            .iter()
            .filter(|agent| agent.enabled)
            .cloned()
            .collect::<Vec<_>>();

        if enabled_agents.is_empty() {
            let next = self.finish_with_error(
                snapshot,
                run,
                "No enabled agents",
                "Enable at least one agent before running a goal.",
            );
            if let Some(run) = next.current_run.as_ref() {
                notify(observer, run);
            }
            return Ok(next);
        }

        let enabled_agent_count = enabled_agents.len();
        let mut agent = BrowserAgent::new(enabled_agents[0].clone());
        agent.initialize();
        if agent.is_initialized() {
            self.invoke_agent_loop(
                &mut snapshot,
                &mut run,
                &mut agent,
                &goal,
                enabled_agent_count,
                tools,
                inference,
                observer,
            )
            .await;
            agent.shutdown();
        }

        if run.status == "error" {
            snapshot.status = "Provider call failed".to_string();
            snapshot.current_run = Some(run.clone());
            snapshot.runs.insert(0, run);
            if let Some(run) = snapshot.current_run.as_ref() {
                notify(observer, run);
            }
            return Ok(snapshot);
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
        if let Some(run) = snapshot.current_run.as_ref() {
            notify(observer, run);
        }
        Ok(snapshot)
    }

    async fn invoke_agent_loop(
        &self,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        agent: &mut BrowserAgent,
        goal: &str,
        enabled_agent_count: usize,
        tools: &impl AgentToolbox,
        inference: &impl InferenceProvider,
        observer: &mut dyn FnMut(AgentRun),
    ) {
        let specs = tools.specs_for_agent(&agent.definition.enabled_tools);
        let run_id = run.id.clone();
        let agent_id = agent.definition.id.clone();

        if enabled_agent_count > 1 {
            run.events.push(event(
                &run_id,
                Some(agent_id.clone()),
                AgentEventKind::Started,
                "Single-agent ReAct loop selected",
                format!(
                    "{} enabled agents were configured. This run uses {} as the active agent.",
                    enabled_agent_count,
                    agent.name()
                ),
            ));
            notify(observer, run);
        }

        let mut step = 0usize;
        #[allow(while_true)]
        while true {
            step = step.saturating_add(1);
            if self
                .invoke_agent_step(
                    snapshot, run, agent, goal, &specs, tools, inference, step, observer,
                )
                .await
            {
                return;
            }

            if run.status == "error" {
                return;
            }
        }
    }

    async fn invoke_agent_step(
        &self,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        agent: &mut BrowserAgent,
        goal: &str,
        specs: &[crate::state::ToolSpec],
        tools: &impl AgentToolbox,
        inference: &impl InferenceProvider,
        step: usize,
        observer: &mut dyn FnMut(AgentRun),
    ) -> bool {
        let run_id = run.id.clone();
        let agent_id = agent.definition.id.clone();
        run.events.push(event(
            &run_id,
            Some(agent_id.clone()),
            AgentEventKind::LlmRequest,
            format!("{} step {step}", agent.name()),
            format!(
                "Sending goal, {} prior message(s), and {} compiled tool spec(s) to {} provider.",
                run.messages.len(),
                specs.len(),
                inference.provider_name()
            ),
        ));
        notify(observer, run);

        let request = InferenceRequest {
            agent_name: agent.definition.name.clone(),
            agent_role: agent.definition.role.clone(),
            soul: snapshot.soul.clone(),
            skills: snapshot.skills.clone(),
            goal: goal.to_string(),
            history: run.messages.clone(),
            tools: specs.to_vec(),
            response_format: agent.definition.response_format,
        };

        let mut on_partial_answer = |partial: String| {
            run.final_answer = partial;
            notify(observer, run);
        };
        let output = match inference
            .invoke_react_streaming(&snapshot.provider, request, &mut on_partial_answer)
            .await
        {
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
                notify(observer, run);
                return true;
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
        notify(observer, run);

        match output.parsed.action {
            ReActAction::Tool => {
                let tool_calls = parse_tool_calls(&output.parsed.response);
                if tool_calls.is_empty() {
                    let parse_error = format!(
                        "Tool parse error -> No valid tool call found in response: {}. Use the form tool_name({{\"key\":\"value\"}}), then try again.",
                        output.parsed.response
                    );
                    run.messages.push(Message {
                        role: "tool".to_string(),
                        content: parse_error.clone(),
                    });
                    run.events.push(event(
                        &run_id,
                        Some(agent_id),
                        AgentEventKind::Error,
                        "Tool parse error",
                        parse_error,
                    ));
                    notify(observer, run);
                    return false;
                }

                for tool_call in tool_calls {
                    self.execute_tool_call(
                        snapshot,
                        run,
                        agent,
                        tools,
                        tool_call.name,
                        tool_call.args,
                        observer,
                    )
                    .await;
                }
                false
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
                    notify(observer, run);
                }
                true
            }
        }
    }

    async fn execute_tool_call(
        &self,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        agent: &BrowserAgent,
        tools: &impl AgentToolbox,
        name: String,
        args: serde_json::Value,
        observer: &mut dyn FnMut(AgentRun),
    ) {
        let run_id = run.id.clone();
        let agent_id = agent.definition.id.clone();
        if !agent
            .definition
            .enabled_tools
            .iter()
            .any(|tool| tool == &name)
        {
            run.messages.push(Message {
                role: "tool".to_string(),
                content: format!(
                    "{name} -> ERROR: {} requested `{name}`, but it is not enabled for this agent.",
                    agent.definition.name
                ),
            });
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
            notify(observer, run);
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
        notify(observer, run);

        let result = tools.execute(snapshot, call_id, &name, args).await;
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
        notify(observer, run);
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

fn notify(observer: &mut dyn FnMut(AgentRun), run: &AgentRun) {
    observer(run.clone());
}

trait AgentToolbox {
    fn specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec>;

    async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: serde_json::Value,
    ) -> ToolResult;
}

impl AgentToolbox for ToolRegistry {
    fn specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec> {
        ToolRegistry::specs_for_agent(self, enabled_tools)
    }

    async fn execute(
        &self,
        snapshot: &mut AppSnapshot,
        call_id: String,
        tool_name: &str,
        args: serde_json::Value,
    ) -> ToolResult {
        ToolRegistry::execute(self, snapshot, call_id, tool_name, args).await
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference::InferenceOutput;
    use crate::responses::{ReActAction, ReActResponse, ResponseFormat};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct FakeInference {
        requests: Arc<Mutex<Vec<InferenceRequest>>>,
    }

    impl InferenceProvider for FakeInference {
        fn provider_name(&self) -> &'static str {
            "fake-openai-compatible"
        }

        async fn invoke_react(
            &self,
            _config: &crate::state::ProviderConfig,
            request: InferenceRequest,
        ) -> AppResult<InferenceOutput<ReActResponse>> {
            let call_number = {
                let mut requests = self.requests.lock().expect("request lock");
                requests.push(request.clone());
                requests.len()
            };

            match call_number {
                1 => Ok(fake_output(
                    ReActAction::Tool,
                    r#"web_search(({"query":"OpenAI news","count":3}))"#,
                )),
                2 => {
                    assert!(
                        request.history.iter().any(|message| {
                            message.role == "tool"
                                && message.content.contains("web_search ->")
                                && message.content.contains("Reuters")
                        }),
                        "second model call should include the web_search tool observation"
                    );
                    Ok(fake_output(
                        ReActAction::Answer,
                        "Recent OpenAI news includes a Reuters item from the web search results.",
                    ))
                }
                _ => Err("fake model should have answered after the web_search observation".into()),
            }
        }
    }

    #[derive(Clone, Default)]
    struct ParseErrorThenAnswerInference {
        requests: Arc<Mutex<Vec<InferenceRequest>>>,
    }

    impl InferenceProvider for ParseErrorThenAnswerInference {
        fn provider_name(&self) -> &'static str {
            "fake-openai-compatible"
        }

        async fn invoke_react(
            &self,
            _config: &crate::state::ProviderConfig,
            request: InferenceRequest,
        ) -> AppResult<InferenceOutput<ReActResponse>> {
            let call_number = {
                let mut requests = self.requests.lock().expect("request lock");
                requests.push(request.clone());
                requests.len()
            };

            match call_number {
                1 => Ok(fake_output(ReActAction::Tool, "search the web now")),
                2 => {
                    assert!(
                        request.history.iter().any(|message| {
                            message.role == "tool"
                                && message.content.contains("Tool parse error ->")
                        }),
                        "second model call should receive the parse-error observation"
                    );
                    Ok(fake_output(
                        ReActAction::Answer,
                        "I corrected the malformed tool request and can answer now.",
                    ))
                }
                _ => Err("fake model should have answered after parse-error feedback".into()),
            }
        }
    }

    #[derive(Clone, Default)]
    struct FakeTools {
        calls: Arc<Mutex<Vec<(String, Value)>>>,
    }

    impl AgentToolbox for FakeTools {
        fn specs_for_agent(&self, enabled_tools: &[String]) -> Vec<ToolSpec> {
            assert!(enabled_tools.iter().any(|tool| tool == "web_search"));
            vec![ToolSpec {
                name: "web_search".to_string(),
                description: "Search the web.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "count": { "type": "integer" }
                    },
                    "required": ["query"]
                }),
            }]
        }

        async fn execute(
            &self,
            _snapshot: &mut AppSnapshot,
            call_id: String,
            tool_name: &str,
            args: Value,
        ) -> ToolResult {
            assert_eq!(tool_name, "web_search");
            assert_eq!(args["query"], "OpenAI news");
            self.calls
                .lock()
                .expect("tool call lock")
                .push((tool_name.to_string(), args));
            ToolResult {
                call_id,
                ok: true,
                content: json!({
                    "success": true,
                    "data": {
                        "web": [
                            {
                                "title": "OpenAI News | Today's Latest Stories | Reuters",
                                "url": "https://www.reuters.com/technology/openai/",
                                "description": "Reuters search result snippet",
                                "position": 1
                            }
                        ]
                    }
                })
                .to_string(),
            }
        }
    }

    #[test]
    fn react_loop_calls_web_search_then_answers_from_tool_observation() {
        let engine = ReActEngine::new();
        let inference = FakeInference::default();
        let tools = FakeTools::default();
        let mut snapshot = AppSnapshot::default();
        snapshot.agents = vec![Agent {
            id: "agent".to_string(),
            name: "Agent".to_string(),
            role: "Use web search for current news, then answer.".to_string(),
            enabled: true,
            enabled_tools: vec!["web_search".to_string()],
            response_format: ResponseFormat::Toon,
            source_path: None,
        }];

        let next = pollster::block_on(engine.run_goal_with_parts(
            snapshot,
            "What is the latest OpenAI news?".to_string(),
            &tools,
            &inference,
        ))
        .expect("run should complete");

        let run = next.current_run.expect("current run");
        assert_eq!(run.status, "complete");
        assert!(run.final_answer.contains("Recent OpenAI news"));
        assert_eq!(run.tool_calls.len(), 1);
        assert_eq!(run.tool_calls[0].tool_name, "web_search");
        assert_eq!(run.tool_results.len(), 1);
        assert!(run.tool_results[0].ok);
        assert!(run
            .messages
            .iter()
            .any(|message| message.role == "tool" && message.content.contains("Reuters")));
        assert_eq!(inference.requests.lock().expect("request lock").len(), 2);
        assert_eq!(tools.calls.lock().expect("tool call lock").len(), 1);
    }

    #[test]
    fn react_loop_does_not_turn_tool_parse_error_into_final_answer() {
        let engine = ReActEngine::new();
        let inference = ParseErrorThenAnswerInference::default();
        let tools = FakeTools::default();
        let mut snapshot = AppSnapshot::default();
        snapshot.agents = vec![Agent {
            id: "agent".to_string(),
            name: "Agent".to_string(),
            role: "Use tools when needed.".to_string(),
            enabled: true,
            enabled_tools: vec!["web_search".to_string()],
            response_format: ResponseFormat::Toon,
            source_path: None,
        }];

        let next = pollster::block_on(engine.run_goal_with_parts(
            snapshot,
            "What is the news today?".to_string(),
            &tools,
            &inference,
        ))
        .expect("run should complete");

        let run = next.current_run.expect("current run");
        assert_eq!(run.status, "complete");
        assert_eq!(
            run.final_answer,
            "I corrected the malformed tool request and can answer now."
        );
        assert_eq!(run.tool_calls.len(), 0);
        assert!(run.messages.iter().any(
            |message| message.role == "tool" && message.content.contains("Tool parse error ->")
        ));
        assert_eq!(inference.requests.lock().expect("request lock").len(), 2);
    }

    fn fake_output(action: ReActAction, response: &str) -> InferenceOutput<ReActResponse> {
        InferenceOutput {
            raw_text: format!(
                "observation: ok\n\nthinking: continue\n\nplan:\n- use evidence\n\naction: {}\n\nresponse: {}",
                action.as_str(),
                response
            ),
            parsed: ReActResponse {
                observation: "ok".to_string(),
                thinking: "continue".to_string(),
                plan: vec!["use evidence".to_string()],
                action,
                response: response.to_string(),
            },
        }
    }
}
