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
//! | `pill.rs` | the pill on the left: folded, marks; open, the dashboard | the brand, the boxes, the pages, a line about the service |
//! | `boxes.rs` | a session as a box: its mark, its row, its tile, its head when open | a `Shown` (the box, its mark, where it opens, whether it is pinned), its open questions |
//! | `topbar.rs` | the page header | the title, the engines, the theme in use |
//! | `footer.rs` | the contact line | the entries |
//! | `stat.rs` | one number with its label | both |
//! | `companion.rs` | the character | its mood |
//! | `engine_chip.rs` | who a person is talking to; the choice between engines | a `Mode`, its live state |
//! | `turn.rs` | the conversation and each turn of it | `Beat`s, the runs held in full |
//! | `run.rs` | a run, its stages, its tool calls | a `Run`, a `Mark`, a `Call` |
//! | `media.rs` | an attachment | a `Chip`, its picture |
//! | `composer.rs` | the message box, the messages that wait, the choice of model | the text, the attachments, whether the engine works, the queue, the models |
//! | `markdown.rs` | an answer as headings, lists, tables, links; a block of code with a copy button | the blocks read from the text; a program and its language |
//! | `asks.rs` | a question that waits for the owner, with a field to answer it | an `Ask` |
//! | `spec.rs` | what an engine is made to do: its goal, its learnings, its tools | the three texts |
//! | `palette.rs` | "go to anything"; the list of shortcuts | every entry, whether it is open |
//! | `terminal.rs` | a terminal: the grid, the colours, the cursor, how it ended | a `Screen` |
//! | `edge.rs` | the edge of the panel beside a conversation, dragged to make it wider | its width |
mod wall;
pub use wall::Wall;
mod surface;
pub use surface::{Glass, Pane};
mod pill;
pub use pill::{Pill, PILL_WIDTH};
mod asks;
pub use asks::AskForm;
mod boxes;
pub use boxes::{BoxRow, BoxTile, OpenHead, Shown};
mod markdown;
#[allow(unused_imports)]
pub use markdown::{CodeBlock, Markdown, Prose};
mod spec;
pub use spec::SpecView;
mod palette;
pub use palette::{Palette, Shortcuts};
mod terminal;
pub use terminal::TerminalView;
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
pub use turn::{SessionThread, Thread, TurnView, Writing};
mod talks;
pub use talks::TalkList;
mod edge;
pub use edge::{SideEdge, SIDE_WIDTH};
mod workspace;
pub use workspace::{DiffView, FilesView};
mod composer;
#[allow(unused_imports)]
pub use composer::{Attached, Composer, ModelChoice, ModelPick, QueueList};
