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

use crate::render::ProviderFormat;

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

    /// The notation to write a paper in for a given provider target. The
    /// chooser: `Form` answers "what does this reader want", and the reader is
    /// the endpoint.
    ///
    /// Markdown for every target today, and that is a REAL COMPUTED ANSWER,
    /// not a stub, for the reason `agent::components::respond` states in full:
    /// this build ships against a 12B running locally, which follows a
    /// `ROUTE:` line nearly always and emits valid JSON only mostly, with
    /// silent failures — a stray fence, a trailing comma, a preamble before
    /// the brace. The `Json` branch becomes reachable the moment a target that
    /// can constrain generation to a schema lands, which is the same one
    /// `render` already carries a `todo!("G5: second provider")` for.
    pub fn for_target(target: ProviderFormat) -> Form {
        match target {
            ProviderFormat::OpenAiChat { .. } => Form::Markdown,
            ProviderFormat::Anthropic | ProviderFormat::Gemini => Form::Markdown,
        }
    }
}

impl Default for Form {
    fn default() -> Form {
        Form::DEFAULT
    }
}
