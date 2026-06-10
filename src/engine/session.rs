//! Shell-side builders for the core engine: translate the selected agent and
//! snapshot state into a [`BaseEngine`], reify the finalized allowlist as a
//! [`ToolMap`] of executor closures, and supply the platform sleeper. This is
//! the one place the shell's world (snapshot, executor, MCP discovery) is
//! converted into the core's world (plain state + callables).

use std::rc::Rc;

use crate::core::{BaseEngine, Sleeper, ToolMap};
use crate::inference::SubAgentInfo;
use crate::responses::FormatNegotiator;
use crate::state::{Agent, Message, ProviderConfig, Skill};

use super::execution::BrowserExecutionProvider;

/// Build the engine's shared state record from init-time run state. Inference
/// attaches inside [`BaseEngine::new`] via the registry, exactly as the legacy
/// loop resolved it.
pub(super) fn build_base_engine(
    agent: &Agent,
    provider: ProviderConfig,
    soul: String,
    skills: Vec<Skill>,
    sub_agents: Vec<SubAgentInfo>,
    conversation: Vec<Message>,
) -> BaseEngine {
    let mut base = BaseEngine::new(provider);
    base.name = agent.name.clone();
    base.description = agent.role.clone();
    base.soul = soul;
    base.skills = skills;
    base.sub_agents = sub_agents;
    base.conversation = conversation;
    base.negotiator = FormatNegotiator::new(agent.response_format);
    base.sleeper = platform_sleeper();
    base
}

/// Reify the finalized allowlist as the core tool map: every name — compiled,
/// MCP-backed, or an `agent_<slug>` delegation — binds to the same executor
/// closure, so the core treats them identically. Sub-agent-as-tool happens
/// here, at bind time; the loop never special-cases delegation.
pub(super) fn build_tool_map(
    executor: &BrowserExecutionProvider,
    enabled_tools: &[String],
) -> ToolMap {
    let mut map = ToolMap::default();
    for name in enabled_tools {
        let executor = executor.clone();
        let tool_name = name.clone();
        map.bind(
            name.clone(),
            Rc::new(move |snapshot, args| {
                let executor = executor.clone();
                let tool_name = tool_name.clone();
                let args = args.clone();
                Box::pin(async move {
                    // The binding returns only the result body; the core engine
                    // owns the ToolResult envelope (it assigns the call id), so
                    // the id the executor stamps here goes unused.
                    let result = executor
                        .execute_domain_tool(snapshot, String::new(), &tool_name, args)
                        .await;
                    if result.ok {
                        Ok(result.content)
                    } else {
                        Err(result.content)
                    }
                })
            }),
        );
    }
    map
}

/// Cooperative retry backoff in the browser: a real event-loop timer.
#[cfg(target_arch = "wasm32")]
fn platform_sleeper() -> Sleeper {
    Rc::new(|ms| {
        Box::pin(async move {
            gloo_timers::future::TimeoutFuture::new(ms).await;
        })
    })
}

/// On the host test runner there is no event-loop timer; yield immediately,
/// matching the legacy `backoff` no-op.
#[cfg(not(target_arch = "wasm32"))]
fn platform_sleeper() -> Sleeper {
    crate::core::noop_sleeper()
}
