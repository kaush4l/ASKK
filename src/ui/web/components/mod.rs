//! # Components: this app's own parts, one file each
//!
//! The rule: **a component is given the object and the values it shows.** It never asks the
//! service, never reads something shared behind its back, and never decides what the words
//! about an engine say. A view asks (`crate::api::…`) and hands the answer down; what a run or
//! a state reads as comes from `ui/features/`. So the same part draws the same thing wherever
//! it is placed, and can be shown with made-up values (a test, a catalogue).
//! `structure.rs` holds the rule (`a_component_only_shows_what_it_is_given`).
//!
//! | file | the part | what it is given |
//! | --- | --- | --- |
//! | `wall.rs`, `surface.rs` | the backdrop; a calm pane; a pane of glass | — |
//! | `icon.rs` | a line icon | its name |
//! | `sidebar.rs` | the navigation panel | the brand, the links |
//! | `topbar.rs` | the page header | the title, the engines, the theme in use |
//! | `footer.rs` | the contact line | the entries |
//! | `stat.rs` | one number with its label | both |
//! | `companion.rs` | the character | its mood |
//! | `engine_chip.rs` | who a person is talking to; the choice between engines | a `Mode`, its live state |
//! | `turn.rs` | the conversation and each turn of it | `Beat`s, the runs held in full |
//! | `run.rs` | a run, its stages, its tool calls | a `Run`, a `Mark`, a `Call` |
//! | `media.rs` | an attachment | a `Chip`, its picture |
//! | `composer.rs` | the message box | the text, the attachments, whether the engine works |
mod wall;
pub use wall::Wall;
mod surface;
pub use surface::{Glass, Pane};
mod sidebar;
pub use sidebar::Sidebar;
mod topbar;
pub use topbar::{engine_of, next_theme, Topbar};
mod footer;
pub use footer::Footer;
mod stat;
pub use stat::Stat;
mod icon;
pub use icon::{Icon, ICONS};
mod companion;
pub use companion::Companion;
mod engine_chip;
pub use engine_chip::{EngineChip, EnginePick};
mod media;
pub use media::MediaChip;
mod run;
#[allow(unused_imports)]
pub use run::{CallRow, Elapsed, RunView, StageRow};
mod turn;
#[allow(unused_imports)]
pub use turn::{Thread, TurnView};
mod composer;
pub use composer::{Attached, Composer};
