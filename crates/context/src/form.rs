//! The formats a component can write itself in.
//!
//! `render()` is the toString and every component has one. `render_in` is the
//! same object in a different notation, and it exists because the best notation
//! is a property of the READER, not of the object: the same reply shape is
//! clearest as named lines to a 12B running locally and as a schema to a
//! provider that can enforce one.
//!
//! Two variants, because two are used. A component that supports only its
//! default says so in [`Component::forms`] and the default `render_in` hands
//! back the same parts for either — which is the honest answer to "can you
//! write yourself as JSON?" for a block of prose.
//!
//! [`Component::forms`]: crate::Component::forms

use serde::{Deserialize, Serialize};

/// One notation a component can render itself in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Form {
    /// Prose and headed lines: what a prompt is mostly made of, and what a
    /// small local model follows most reliably.
    Markdown,
    /// A JSON object. For a caller that will parse the reply strictly, or a
    /// provider that can constrain generation to a schema.
    Json,
}

impl Form {
    /// The notation assumed wherever none is named.
    pub const DEFAULT: Form = Form::Markdown;
}

impl Default for Form {
    fn default() -> Form {
        Form::DEFAULT
    }
}
