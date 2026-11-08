//! The built-in element kinds. Add a kind: one file here, one line in `KINDS`.

mod counter;
mod loop_;
mod memory;
mod meter;
pub mod model;
mod note;
mod phases;
mod status;
mod timer;
mod tools;
pub mod workflows;

use crate::object::Kind;

pub static KINDS: [&dyn Kind; 11] = [
    &note::Note,
    &counter::Counter,
    &status::Status,
    &meter::Meter,
    &timer::Timer,
    &model::Model,
    &loop_::Loop,
    &phases::Phases,
    &tools::Tools,
    &memory::Memory,
    &workflows::Workflows,
];

pub fn find(kind: &str) -> Option<&'static dyn Kind> {
    KINDS.iter().copied().find(|k| k.kind() == kind)
}
