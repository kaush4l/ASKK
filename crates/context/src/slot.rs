//! Where a component belongs in the prompt. The order of these values IS the
//! prompt order (derived `Ord`) — ordering is structural, not conventional.
//!
//! This is the type that ends an accident. Order used to be `sort_by_key(
//! stability)` and nothing else, which made a *caching* property do an
//! *ordering* job: `response_contract` is declared `Static`, so the
//! output-format instruction rendered fourth, near the top. A slot says where
//! a thing goes and says nothing about how often it changes; `Stability` says
//! how often it changes and says nothing about where it goes. Two questions,
//! two types.

use serde::{Deserialize, Serialize};

/// The prompt's sections, in the order the model reads them. Numbering leaves
/// gaps of ten so a new slot can land between two existing ones without
/// renumbering — the numbers are ordering, and renumbering would rewrite every
/// golden for no reason.
///
/// Two ends are pinned on purpose and everything else is arrangement:
/// [`Slot::Soul`] is first because an agent must be someone before it is told
/// anything, and [`Slot::Response`] is last because the shape of the reply is
/// the instruction the model should be holding when it starts writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Slot {
    /// Who this agent is. Always first.
    Soul = 0,
    /// Name, role, presentation.
    Identity = 10,
    /// How to behave; the response discipline.
    OperatingRules = 20,
    /// What exists and how to call it — the toolbox. Stable, so it stays
    /// inside the cacheable head rather than after the transcript.
    Affordances = 30,
    /// Durable facts about the person.
    User = 40,
    /// Retained knowledge across sessions.
    Memory = 50,
    /// Time, locale, device, the shared space. Never cached: a cached clock is
    /// a wrong clock.
    Environment = 60,
    /// What is being attempted right now.
    Task = 70,
    /// The conversation so far.
    History = 80,
    /// Results of the last actions.
    Observations = 90,
    /// The exact shape of the expected reply. Always last.
    Response = 99,
}

impl Slot {
    /// The pinned head. `validate` requires one of these to exist: a prompt
    /// without it is an agent that was never told who it is.
    pub fn is_head(self) -> bool {
        matches!(self, Slot::Soul | Slot::Identity)
    }

    /// The pinned tail. Exactly one component may claim it, and it sorts last.
    ///
    /// This is also the one place the stability order is allowed to break.
    /// Prefix caching only ever caches a *prefix*: once `environment` and
    /// `history` have changed, nothing after them was going to be cached
    /// wherever it sat, so pinning static contract text behind them costs no
    /// cache that was reachable and buys recency for the output format.
    pub fn is_tail(self) -> bool {
        matches!(self, Slot::Response)
    }
}
