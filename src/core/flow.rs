//! # Flow: the one run loop, named
//!
//! Every engine runs the same loop ([`super::Engine::run`]). Its shape is fixed here, in code;
//! what varies is a value in the engine's folder, never a new loop.
//!
//! An event arrives ([`Stage::Input`]); then, up to `max_steps` times, the stages of
//! [`Stage::STEP`] in this order:
//!
//! | stage | what happens | what varies, and where the value lives |
//! | --- | --- | --- |
//! | `Refresh` | elements that watch something fetch it again | which elements: `elements/*.json` |
//! | `Prompt` | the prompt is put together from the elements' sections | which elements, their config; the order of sections is [`super::Slot`] |
//! | `Observe` | how full the context is, as numbers the elements may react to | the model's context: `models.json` |
//! | `Refocus` | only when the prompt nears the limit: history is folded into a summary | the instruction: the element with the refocus role |
//! | `Think` | the model is asked (the engine never learns the provider) | `model` in `engine.json`; sampling: the `sampling` element, per phase |
//! | `Parse` | the reply is read by the elements | the reply format: the `handoff` element |
//! | `Act` | the tools the reply names are called, together | which tools: the `tools` element |
//! | `Save` | state is written through the store | — |
//!
//! The loop ends when a reply is an answer, names no tool, the engine is stopped, or the steps
//! run out (`max_steps` in `engine.json`).
//!
//! ## The loop is a value
//! Which of these stages an engine runs is its own choice, written in its `engine.json`:
//!
//! ```json
//! {"name": "summariser", "flow": ["prompt", "think", "parse", "save"]}
//! ```
//!
//! That is the whole customization: a list. It is checked when the engine is initialised
//! ([`Flow::validate`]) — an unknown stage, a stage out of order or twice, or a loop without
//! `prompt`, `think`, `parse` and `save` is refused with the reason, and the engine does not
//! start. Left out, an engine runs every stage.
//!
//! The engine marks each stage as it enters it ([`super::Engine::trace`]); in tests and
//! development builds every run is checked against its flow as it goes ([`follows`]).
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Input,
    Refresh,
    Prompt,
    Observe,
    Refocus,
    Think,
    Parse,
    Act,
    Save,
}

impl Stage {
    /// The stages of one step, in the only order they may happen.
    pub const STEP: [Stage; 8] = [Stage::Refresh, Stage::Prompt, Stage::Observe, Stage::Refocus, Stage::Think, Stage::Parse, Stage::Act, Stage::Save];
}

/// The stages one engine runs each step: a value in its `engine.json` (`"flow": [...]`).
///
/// The structure is fixed: stages come from [`Stage::STEP`], in that order, each at most once,
/// and the four that make it a loop at all ([`Flow::REQUIRED`]) are always there. Inside that
/// structure an engine chooses: no `act` = it only answers, never calls a tool; no `refocus` =
/// its history is never folded; no `refresh` / `observe` = those are skipped.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Flow(pub Vec<Stage>);

impl Default for Flow {
    fn default() -> Self {
        Flow(Stage::STEP.to_vec())
    }
}

impl Flow {
    /// Without these there is no loop: ask the model, read the reply, keep the state.
    pub const REQUIRED: [Stage; 4] = [Stage::Prompt, Stage::Think, Stage::Parse, Stage::Save];

    pub fn has(&self, s: Stage) -> bool {
        self.0.contains(&s)
    }

    /// Every stage (the default; not written to `engine.json`).
    pub fn is_whole(&self) -> bool {
        self.0 == Stage::STEP
    }

    /// The first stage of every step.
    fn opens(&self) -> Option<Stage> {
        self.0.first().copied()
    }

    /// The structure the value must keep.
    pub fn validate(&self) -> Result<(), String> {
        let mut last = None;
        for s in &self.0 {
            let i = Stage::STEP.iter().position(|x| x == s).ok_or_else(|| format!("'{}' is not a stage of a step", name(*s)))?;
            if last.is_some_and(|l| i <= l) {
                return Err(format!("'{}' is out of order (the order is {})", name(*s), Stage::STEP.map(name).join(", ")));
            }
            last = Some(i);
        }
        match Self::REQUIRED.iter().find(|r| !self.has(**r)) {
            Some(missing) => Err(format!("'{}' is required", name(*missing))),
            None => Ok(()),
        }
    }
}

/// A stage as it is written in `engine.json`.
pub fn name(s: Stage) -> &'static str {
    match s {
        Stage::Input => "input",
        Stage::Refresh => "refresh",
        Stage::Prompt => "prompt",
        Stage::Observe => "observe",
        Stage::Refocus => "refocus",
        Stage::Think => "think",
        Stage::Parse => "parse",
        Stage::Act => "act",
        Stage::Save => "save",
    }
}

/// What a stage is for, in one line (shown beside each stage of a run's record).
pub fn about(s: Stage) -> &'static str {
    match s {
        Stage::Input => "What started the run: a message, an alert, a request.",
        Stage::Refresh => "Elements that watch something read it again, so the prompt shows the world as it is now.",
        Stage::Prompt => "The prompt is put together from the elements' sections, in the fixed order of slots.",
        Stage::Observe => "How full the context is, measured; elements may react to the numbers.",
        Stage::Refocus => "The prompt neared the limit: the conversation was folded into a summary.",
        Stage::Think => "The model is asked. Everything it knows is in the prompt above (and the images shown).",
        Stage::Parse => "The reply is read: the fields it wrote first, the tools it calls, or its answer.",
        Stage::Act => "The tools the reply named are called, all at once; their results open the next step.",
        Stage::Save => "State is written through the store, so a restart resumes here.",
    }
}

/// Whether `trace` is a legal run of `flow`: an input, then steps that each open with the
/// flow's first stage and move forward through the flow's stages (one may be skipped — a
/// refocus that was not needed — never repeated, reordered, or outside the flow).
pub fn follows(trace: &[Stage], flow: &Flow) -> bool {
    let Some((first, rest)) = trace.split_first() else { return true };
    if *first != Stage::Input {
        return false;
    }
    let mut last: Option<usize> = None;
    for s in rest {
        let Some(i) = flow.0.iter().position(|x| x == s) else { return false };
        // The flow's first stage opens a step; inside a step the position only grows.
        if Some(*s) != flow.opens() && last.is_some_and(|l| i <= l) {
            return false;
        }
        if Some(*s) == flow.opens() && last == Some(i) {
            return false;
        }
        last = Some(i);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use Stage::*;

    #[test]
    fn a_trace_moves_forward_inside_each_step() {
        let whole = Flow::default();
        assert!(follows(&[Input, Refresh, Prompt, Observe, Think, Parse, Act, Save, Refresh, Prompt, Think, Parse, Act, Save], &whole));
        assert!(follows(&[Input, Refresh, Prompt, Observe, Refocus, Think], &whole));
        assert!(!follows(&[Refresh, Prompt], &whole), "a run starts with an input");
        assert!(!follows(&[Input, Refresh, Think, Prompt], &whole), "the prompt comes before the model");
        assert!(!follows(&[Input, Refresh, Act, Act], &whole), "no stage twice in a step");
        assert!(!follows(&[Input, Refresh, Input], &whole), "one input per run");
        let small = Flow(vec![Prompt, Think, Parse, Save]);
        assert!(follows(&[Input, Prompt, Think, Parse, Save, Prompt, Think, Parse, Save], &small));
        assert!(!follows(&[Input, Prompt, Think, Parse, Act, Save], &small), "a stage outside the flow");
    }

    #[test]
    fn a_flow_keeps_the_structure() {
        assert!(Flow::default().validate().is_ok() && Flow::default().is_whole());
        assert!(Flow(vec![Prompt, Think, Parse, Save]).validate().is_ok());
        assert!(Flow(vec![Refresh, Prompt, Think, Parse, Act, Save]).validate().is_ok());
        assert!(Flow(vec![Prompt, Think, Parse]).validate().unwrap_err().contains("'save' is required"));
        assert!(Flow(vec![Think, Prompt, Parse, Save]).validate().unwrap_err().contains("out of order"));
        assert!(Flow(vec![Input, Prompt, Think, Parse, Save]).validate().unwrap_err().contains("not a stage of a step"));
        assert_eq!(serde_json::to_string(&Flow(vec![Prompt, Think, Parse, Save])).unwrap(), r#"["prompt","think","parse","save"]"#);
    }
}
