//! WHAT EACH STAGE IS TOLD — and, since this increment, the fact that it is
//! not told it from here. The words live in `public/stages/<key>.md` and arrive
//! the way `public/agents/*/agent.md` arrives: fetched at boot, handed into the
//! pure core as `(key, text)` pairs. What is left in this file is what was
//! never prose — the reply shape a stage demands, and which stages may act.
//!
//! A BRIEF IS A PROPERTY OF THE STAGE, NOT OF THE AGENT. A stage name is a
//! member of a closed vocabulary (`stages::STAGES`) and its meaning belongs to
//! the MACHINE: `acts`, `skill_only`, `stages::verify_ahead` and `passes::again`
//! all branch on the name. If two agents could mean different things by
//! `verify`, the machine would be reasoning about a word whose meaning it no
//! longer knows. The agent's own voice already reaches the model in full,
//! through `Soul` — an agent that wants to plan differently edits its soul, and
//! a per-agent brief would be a SECOND place an agent's instructions live,
//! competing with the first. The verify brief is the plainest case: it names
//! the CHECK line the plan brief asked for, so a per-agent copy could quietly
//! stop naming CHECK while the other half kept telling the model to write one.
//!
//! …AND THAT CHECK LINE IS A NOTE TO THE MODEL, NOT TO THE MACHINE (26). It is
//! prose the plan stage writes for the verify stage to act on, and nothing here
//! parses it — the paragraph above is why. The one check a MACHINE reads is
//! `goal.check` in the agent's own frontmatter (`crate::goal`), which is a
//! declared command run by the harness itself. There is exactly one of those,
//! so there is no question of which wins; reading structure out of a brief to
//! find a second would hardcode the brief again in a new place.
//!
//! THE CORE PARSES NONE OF IT. A brief is opaque prose that reaches the model
//! through `components::Directive`, and the only operations here are trim and
//! is-it-empty. No line splitting, no keyword search: the moment core reads
//! structure out of a brief, the brief is hardcoded again in a new place.
//!
//! AND THERE IS NO COMPILED-IN COPY. A missing or blank file REFUSES, loudly,
//! at load and again at the stage that wanted it. A default here would be the
//! `engine: reakt` failure with better manners — a setting that looks applied.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::components::ResponseContract as Contract;
use crate::error::AgentError;
use crate::stages::{CRITIQUE, PLAN, VERIFY, WORK};
use crate::strategy::{self, STRATEGY};

/// The paragraph appended to the `plan` brief for an agent that has a space.
/// NOT a stage — a key, and a key rather than the tail of `plan.md`, because
/// the alternative is core splitting one file on a separator, which is parsing
/// the brief.
pub const DURABLE: &str = "durable";

/// Every brief there is. Closed, like `stages::STAGES`, and for the same
/// reason: an unknown key is a file somebody wrote that nothing will ever read.
/// `work` and `answer` are absent BY DESIGN — the person's own request is the
/// instruction there, and a second one would compete with it.
pub const BRIEF_KEYS: [&str; 5] = [STRATEGY, PLAN, VERIFY, CRITIQUE, DURABLE];

/// The loaded briefs, by key. `BTreeMap` and not `HashMap` so two identical
/// agents assemble two identical papers (I7, I14) — the same rule `senses`
/// carries, for the same reason.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Briefs(BTreeMap<String, String>);

impl Briefs {
    /// Whether any brief was loaded at all. What the loud path asks before it
    /// blames one key: an app that fetched nothing has a different problem
    /// from an app missing `verify.md`.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The set back as the `(key, text)` pairs it was loaded from. A sub-agent's
    /// Worker boots from what the page already fetched — it cannot fetch these
    /// itself — so the loaded set has to be able to say what it holds.
    pub fn pairs(&self) -> Vec<(String, String)> {
        self.0.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}

/// The file a key is read from, which is the sentence a person needs. It is
/// built here rather than at each refusal so the two refusals — the load and
/// the stage — cannot name two different paths.
pub(crate) fn path_of(key: &str) -> String {
    format!("public/stages/{key}.md")
}

/// EVERY KEY, OR A REFUSAL. An unknown key, a missing one, or one whose file is
/// empty once trimmed is `MalformedBrief` naming the file to fix. It refuses
/// the whole set rather than the one key because a half-loaded set is an app
/// that runs until the turn that needed the missing one, which is the failure
/// this increment exists to delete.
pub fn load(pairs: impl IntoIterator<Item = (String, String)>) -> Result<Briefs, AgentError> {
    let mut loaded = BTreeMap::new();
    for (key, text) in pairs {
        if !BRIEF_KEYS.contains(&key.as_str()) {
            return Err(malformed(
                &key,
                format!("no stage is briefed by that name — the briefs are: {}", BRIEF_KEYS.join(", ")),
            ));
        }
        if text.trim().is_empty() {
            return Err(malformed(&key, format!("{} is empty", path_of(&key))));
        }
        loaded.insert(key, text.trim().to_string());
    }
    if let Some(missing) = BRIEF_KEYS.iter().find(|k| !loaded.contains_key(**k)) {
        return Err(malformed(
            missing,
            format!("{} was not loaded, so the {missing} stage has nothing to say", path_of(missing)),
        ));
    }
    Ok(Briefs(loaded))
}

/// THE WORDS THIS STAGE ENTERS WITH. `work` and `answer` get an empty string,
/// which is how the block disappears on them rather than lingering with the
/// previous stage's instruction still in it. A briefed stage whose file never
/// loaded is `Err` naming the key: entering it unbriefed is a plan stage that
/// writes no plan and a verify stage that names no CHECK, both of them looking
/// exactly like a stage that ran.
///
/// The `\n\n` before the durable paragraph is the APPENDER's business and never
/// the file's. `durable.md` holds prose and this joins it on; the alternative —
/// one `plan.md` split on a separator — is core parsing a brief.
pub(crate) fn directive(briefs: &Briefs, stage: &str, has_space: bool) -> Result<String, String> {
    if !keyed(stage) {
        return Ok(String::new());
    }
    let mut said = of(briefs, stage).ok_or_else(|| stage.to_string())?.to_string();
    if stage == PLAN && has_space {
        let durable = of(briefs, DURABLE).ok_or_else(|| DURABLE.to_string())?;
        said.push_str(&format!("\n\n{durable}"));
    }
    Ok(said)
}

/// The words this stage was given, if it is a stage that gets any. `None`
/// covers two different things on purpose — `work` and `answer`, which are
/// right to have none, and a briefed stage whose file never arrived, which is
/// the loud case. `keyed` is what tells the caller which one it is holding.
fn of<'a>(briefs: &'a Briefs, stage: &str) -> Option<&'a str> {
    briefs.0.get(stage).map(String::as_str)
}

/// Whether this stage is one that must be briefed before it may be entered.
fn keyed(stage: &str) -> bool {
    matches!(stage, STRATEGY | PLAN | VERIFY | CRITIQUE)
}

/// The reply shape this stage demands, where it demands one.
///
/// `None` means "whatever the phase would have asked for anyway" — prose to the
/// person, or a tool envelope where there are tools. Only a stage whose reply
/// the MACHINE reads needs to override that, and today exactly one does. It
/// stays compiled in because it is not prose: it is the shape `strategy::
/// route_of` parses back, and the two are one decision.
pub(crate) fn contract(stage: &str) -> Option<Contract> {
    match stage {
        STRATEGY => Some(Contract::shaped(strategy::OBJECT)),
        _ => None,
    }
}

/// Whether this stage may act, and — where it may — with what.
///
/// `plan` is the interesting one. It is told to read skills, so refusing it
/// every tool would make that instruction a lie; granting it the whole toolbox
/// would let it start the work it is supposed to be planning. It gets the two
/// skill tools, which is exactly the capability its brief names.
pub(crate) fn skill_only(stage: &str) -> bool {
    stage == PLAN
}

/// Stages that may call the agent's full toolbox — WRITTEN AS WHAT MAY ACT,
/// which is the point of this function and not a style choice.
///
/// It read `!matches!(stage, STRATEGY | PLAN | CRITIQUE | ANSWER)`: a
/// default-ALLOW list in a codebase whose I6 is default-deny, and the only one
/// of its three siblings written that way — `keyed` and `skill_only` both name
/// what is INCLUDED. A sixth entry in `stages::STAGES` would have taken the
/// agent's ENTIRE toolbox by omission — capability by forgetting, which is
/// what I6 refuses.
///
/// `answer` is still absent on purpose — the vote said that turn needs no tool
/// — but absent by not being listed, a fact about this line rather than about
/// somebody's memory. `tests/stages.rs` pins the DIRECTION of the default, not
/// a case — the shape `docs/CRITIQUE-04.md` says to look for first.
pub(crate) fn acts(stage: &str) -> bool {
    matches!(stage, WORK | VERIFY)
}

fn malformed(key: &str, message: String) -> AgentError {
    AgentError::MalformedBrief {
        key: key.to_string(),
        message,
    }
}
