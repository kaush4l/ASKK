//! ASKING: the phase's configuration, the toolbox it grants, and the Document
//! that goes to the model. Split from `step.rs`, which owns the transitions,
//! so both hold the 200-line rule (I12) — and because these four functions are
//! the ones that must agree with each other about what the model may call
//! (I13), which is easier to check when they are together.

use context::ProviderFormat;
use kernel::EndpointName;

use crate::effect::Effect;
use crate::paper;
use crate::phase::{v1_phases, PhaseConfig, ResponseContract};
use crate::state::AgentState;
use crate::toolbox::Toolbox;

/// This agent's phase configuration.
pub(crate) fn config(state: &AgentState) -> PhaseConfig {
    v1_phases()
        .into_iter()
        .find(|c| c.phase == state.phase)
        .expect("current phase is configured")
}

/// The toolbox this phase grants — the ONLY source of what the model is told
/// it can call: this agent's own toolbox (`subagent::toolbox_for`) narrowed
/// by the phase's `ToolScope`.
pub(crate) fn scoped_tools(state: &AgentState, cfg: &PhaseConfig) -> Toolbox {
    // …AND NARROWED AGAIN BY THE STAGE (20). `plan` and `critique` are told in
    // words to call nothing; this is what makes the words true. Enforcing it
    // here rather than trusting the brief is `engine: base`'s lesson — a
    // capability described but not enforced is a setting that looks applied.
    match crate::stages::tools_on(crate::stages::current(state)) {
        true => state.toolbox.scoped(&cfg.tools),
        false => Toolbox::default(),
    }
}

/// Assemble the paper and ask the model. The affordances and response-contract
/// sections are rewritten from the phase's granted toolbox first, so what the
/// model may call and what it is told it may call cannot drift (I13).
pub(crate) fn call_model(state: &mut AgentState, at: kernel::Timestamp) -> Effect {
    let cfg = config(state);
    let tools = scoped_tools(state, &cfg);
    paper::set_text(&mut state.paper, "affordances", &tools.instructions());
    paper::set_text(&mut state.paper, "response_contract", &contract_text(&cfg, &tools));
    // Fresh every request, never cached: a cached clock is a wrong clock
    // (Python `Engine.context`).
    let environment = crate::now::environment(at, state.space.as_ref());
    paper::set_dynamic(&mut state.paper, "environment", &environment, at);
    Effect::CallModel {
        document: context::assemble(&state.paper, state.phase, cfg.budget),
        // G4 target: the local OpenAI-compatible proxy, text-only.
        format: ProviderFormat::OpenAiChat {
            vision: false,
            audio: false,
        },
        endpoint: EndpointName("model".into()),
        model: state.model.clone(),
        temperature: state.temperature,
        speaker: String::new(), // this agent's own turn
    }
}

/// What the phase demands back, in words the model can obey.
pub(crate) fn contract_text(cfg: &PhaseConfig, tools: &Toolbox) -> String {
    match (cfg.contract, tools.is_empty()) {
        (ResponseContract::ToolEnvelope, false) => "Either answer the user in plain prose, or \
             call tools by writing the calls exactly as AFFORDANCES shows them and nothing \
             else. Results come back on lines beginning `Result:` — read them, then answer."
            .into(),
        _ => "Reply in plain prose to the user's message. Be concise.".into(),
    }
}

