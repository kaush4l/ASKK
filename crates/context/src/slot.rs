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
//!
//! It is a newtype over `u8` rather than a closed enum because a component
//! does not have to live in this crate. A browser faculty, a shared-space
//! block, an artifacts block — each must be able to declare where it sits by
//! naming a number, without a patch to the pure core. The gaps of ten are what
//! make that safe: `Slot(92)` lands between `OBSERVATIONS` and `DIRECTIVE` and
//! nothing is renumbered. The named constants below stay the vocabulary; the
//! open type is the headroom.

use serde::{Deserialize, Serialize};

/// The prompt's sections, in the order the model reads them. Numbering leaves
/// gaps of ten so a new slot can land between two existing ones without
/// renumbering — the numbers are ordering, and renumbering would rewrite every
/// golden for no reason.
///
/// Two ends are pinned on purpose and everything else is arrangement:
/// [`Slot::SOUL`] is first because an agent must be someone before it is told
/// anything, and [`Slot::RESPONSE`] is last because the shape of the reply is
/// the instruction the model should be holding when it starts writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Slot(pub u8);

impl Slot {
    /// Who this agent is. Always first.
    pub const SOUL: Slot = Slot(0);
    /// Name, role, presentation.
    pub const IDENTITY: Slot = Slot(10);
    /// How to behave; the response discipline.
    pub const OPERATING_RULES: Slot = Slot(20);
    /// What exists and how to call it — the toolbox. Stable, so it stays
    /// inside the cacheable head rather than after the transcript.
    pub const AFFORDANCES: Slot = Slot(30);
    /// Durable facts about the person.
    pub const USER: Slot = Slot(40);
    /// Retained knowledge across sessions.
    pub const MEMORY: Slot = Slot(50);
    /// The shared space: its workspace folder, its settled facts, its notes.
    pub const SPACE: Slot = Slot(55);
    /// Time, locale, device, the shared space. Never cached: a cached clock is
    /// a wrong clock.
    pub const ENVIRONMENT: Slot = Slot(60);
    /// What is being attempted right now.
    pub const TASK: Slot = Slot(70);
    /// The conversation so far.
    pub const HISTORY: Slot = Slot(80);
    /// Results of the last actions.
    pub const OBSERVATIONS: Slot = Slot(90);
    /// What this turn is being asked to do, before replying. Last of the
    /// content, because it is the instruction the reply must satisfy.
    pub const DIRECTIVE: Slot = Slot(95);
    /// The exact shape of the expected reply. Always last.
    pub const RESPONSE: Slot = Slot(99);

    /// The pinned head. `validate` requires one of these to exist: a prompt
    /// without it is an agent that was never told who it is.
    pub fn is_head(self) -> bool {
        self == Slot::SOUL || self == Slot::IDENTITY
    }

    /// The pinned tail. Exactly one component may claim it, and it sorts last.
    ///
    /// This is also the one place the stability order is allowed to break.
    /// Prefix caching only ever caches a *prefix*: once `environment` and
    /// `history` have changed, nothing after them was going to be cached
    /// wherever it sat, so pinning static contract text behind them costs no
    /// cache that was reachable and buys recency for the output format.
    pub fn is_tail(self) -> bool {
        self == Slot::RESPONSE
    }
}
