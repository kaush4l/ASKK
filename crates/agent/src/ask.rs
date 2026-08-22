//! ASKING — everything that decides what ONE model call contains: the phase's
//! configuration, the toolbox that phase grants, the Document assembled under
//! its budget, and the contract demanded back.
//!
//! It is apart from `step.rs`, which owns the TRANSITIONS, because these
//! functions have one obligation to each other that no transition shares: what
//! the model may call and what it is TOLD it may call must be the same set
//! (I13). That is a property of these five together, and it is checkable by
//! reading them together.

use context::ProviderFormat;
use kernel::EndpointName;

use crate::components;
use crate::components::ResponseContract as Contract;
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
    // WHO IS READING. This is the only place that holds both the endpoint and
    // the paper, so it is the only place that can choose the notation the
    // paper is written in (I13). Set BEFORE the rebuilds below, because each
    // one reads the request off the paper.
    // G4 target: the local OpenAI-compatible proxy, text-only.
    let format = ProviderFormat::OpenAiChat {
        vision: false,
        audio: false,
    };
    state.paper.form = context::Form::for_target(format);
    // The sections rebuilt for every single call — WHICH ones, and why, is
    // `components::dynamic`'s to say. This walks the set; it does not name it.
    for block in components::dynamic(state, &cfg, &tools, at) {
        paper::set_component(&mut state.paper, block.as_ref(), at);
    }
    // …AND THEN THE ONES WHOSE WORDS NAME TOOLS, AGAIN, HONESTLY (T25).
    for block in per_stage_blocks(state, &tools) {
        paper::set_component(&mut state.paper, &block, at);
    }
    Effect::CallModel {
        document: context::assemble(&state.paper, state.phase, cfg.budget),
        format,
        endpoint: EndpointName("model".into()),
        model: state.model.clone(),
        temperature: state.temperature,
        speaker: String::new(), // this agent's own turn
    }
}

/// THE FACULTY BLOCKS WHOSE PROSE NAMES TOOLS, RE-RENDERED AGAINST THE GRANT
/// THIS CALL ACTUALLY HAS (T25).
///
/// THE DEFECT. `## space` names `observe`, `find_files` and `start_process`
/// when the agent holds them — a fix that made the block honest per AGENT. But
/// a host writes that block from `AgentState.toolbox`, and what a TURN may call
/// is [`scoped_tools`], narrowed by the stage. On shipped `main` in `strategy`
/// — the first call of every single turn — `## affordances` said "No tools are
/// installed" and `## space` named three of them five lines later.
///
/// WHY THE SEAM IS HERE AND NOT IN THE HOST. `core::faculty::run::refresh_all`
/// runs ONCE per pass, before an event is pumped, and it is async. The stage
/// cursor moves INSIDE that pump: a stage's reply advances `state.stage` and
/// builds the next call in the same synchronous `step`. So a block written by a
/// host is always at least one stage stale, and handing the host a stage-scoped
/// toolbox would only move the lie rather than remove it. The grant is decided
/// here, synchronously, by the function above; the words that name it belong
/// beside the decision. That is this file's stated obligation — what the model
/// may call and what it is TOLD it may call must be the same set.
///
/// WHAT WAS REJECTED. (1) Scoping `faculty::Sensing.tools` — stale, above.
/// (2) Predicting the next stage in `refresh_all` — a second copy of
/// `stages::next` living in the runtime. (3) Censoring tool names out of
/// rendered parts at assembly — text surgery on prose the core did not write.
/// (4) A `fn(&Toolbox)` hook on `faculty::Faculty` so any faculty could declare
/// grant-dependent prose — generality with one user today; the class test in
/// `tests/prompt.rs` is what makes the SECOND user fail loudly instead.
///
/// It writes to the PAPER and never back into `senses`: `senses` is the record
/// of what a host last saw, read elsewhere as exactly that, and the paper is
/// the per-call artifact. `set_component` upserts by id, so this replaces the
/// host's wording for this call only.
fn per_stage_blocks(state: &AgentState, tools: &Toolbox) -> Vec<components::Sensed> {
    crate::faculty::blocks_of(&state.faculties)
        .into_iter()
        .filter(|block| block.id == crate::faculty::SPACE)
        .map(|block| components::Sensed {
            block,
            parts: components::space_parts(&state.space, tools),
        })
        .collect()
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
pub(crate) fn stage_contract(state: &AgentState, cfg: &PhaseConfig, tools: &Toolbox) -> Contract {
    crate::brief::contract(crate::stages::current(state))
        .unwrap_or_else(|| contract(cfg, tools))
}

