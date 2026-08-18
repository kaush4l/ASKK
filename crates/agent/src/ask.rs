//! ASKING: the phase's configuration, the toolbox it grants, and the Document
//! that goes to the model. Split from `step.rs`, which owns the transitions,
//! so both hold the 200-line rule (I12) — and because these four functions are
//! the ones that must agree with each other about what the model may call
//! (I13), which is easier to check when they are together.

use context::ProviderFormat;
use kernel::EndpointName;

use crate::components::{Affordances, Environment, ResponseContract as Contract};
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
    let stage = crate::stages::current(state);
    // …AND THE PLAN STAGE GETS EXACTLY WHAT ITS BRIEF NAMES. It is told to list
    // the skills and read the ones that apply, so refusing it every tool would
    // make that instruction a lie, and granting it the whole toolbox would let
    // it start the work it is supposed to be planning. Two tools, named here
    // and nowhere else.
    if crate::brief::skill_only(stage) {
        let skills = [crate::skills::LIST_SKILLS, crate::skills::READ_SKILL]
            .iter()
            .map(|n| kernel::ToolId((*n).into()))
            .collect();
        return state.toolbox.scoped(&crate::phase::ToolScope::Only(skills));
    }
    match crate::stages::tools_on(stage) {
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
    // The three sections that are rebuilt for every single call, each from the
    // component that owns its shape. What the model may call and what it is
    // told it may call cannot drift, because both come from one toolbox (I13).
    paper::set_component(&mut state.paper, &Affordances::new(tools.usages()), at);
    let shape = stage_contract(state, &cfg, &tools);
    paper::set_component(&mut state.paper, &shape, at);
    // Fresh every request, never cached: a cached clock is a wrong clock
    // (Python `Engine.context`).
    let environment = Environment {
        text: crate::now::environment(at, state.space.as_ref()),
    };
    paper::set_component(&mut state.paper, &environment, at);
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

/// What the phase demands back, as the component that will render it.
///
/// The envelope form is offered only when there is something to call: telling
/// a model it may call tools and then showing it none is an invitation to
/// invent one.
pub(crate) fn contract(cfg: &PhaseConfig, tools: &Toolbox) -> Contract {
    match (cfg.contract, tools.is_empty()) {
        (ResponseContract::ToolEnvelope, false) => Contract::tool_envelope(),
        _ => Contract::prose(),
    }
}

/// …UNLESS THE STAGE DEMANDS A SHAPE (the strategy vote). A stage whose reply
/// the machine PARSES states the reply as fields; the phase's contract is what
/// every other stage falls back to.
fn stage_contract(state: &AgentState, cfg: &PhaseConfig, tools: &Toolbox) -> Contract {
    crate::brief::contract(crate::stages::current(state))
        .unwrap_or_else(|| contract(cfg, tools))
}

