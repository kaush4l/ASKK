//! The shape of the expected reply — the pinned last word of every prompt.
//!
//! Last on purpose. Everything above this is what the model knows; this is
//! what it must now produce, and it is the instruction most worth having in
//! working memory at the moment generation begins. Its content is static, but
//! prefix caching only ever caches a prefix — once the transcript above it has
//! changed, nothing after that was going to be cached wherever it sat, so the
//! position costs no cache that was reachable.

use context::{text, Component, Fidelity, Form, Part, Slot, Stability};
use kernel::SectionId;

use super::respond::{ResponseObject, BOTH};

/// The reply contract, carried as already-rendered text.
///
/// Pre-rendered rather than computed at render time so the component stays a
/// value whose hash covers the exact bytes the model will see — the thing that
/// makes "identical key means identical prompt" true rather than nearly true.
///
/// `object` is the exception, and it is the reason this component has a second
/// notation at all: a phase whose reply the machine will PARSE states its shape
/// as fields, and those fields can be written as lines or as JSON. Prose has no
/// second notation — asked for JSON, a paragraph is still a paragraph — so a
/// contract with no object declares one form and means it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResponseContract {
    pub instructions: String,
    pub object: Option<ResponseObject>,
}

impl Default for ResponseContract {
    fn default() -> Self {
        ResponseContract::prose()
    }
}

impl ResponseContract {
    /// Answer the person, in words. The cheap exit, and the common case.
    pub fn prose() -> Self {
        ResponseContract {
            instructions: "Reply in plain prose to the user's message. Be concise.".into(),
            object: None,
        }
    }

    /// A reply the machine will parse, stated as the fields it must carry.
    pub fn shaped(object: ResponseObject) -> Self {
        ResponseContract {
            instructions: String::new(),
            object: Some(object),
        }
    }

    /// Answer, or call tools. Written as an ordered choice rather than a
    /// description of two options, because a model given a menu picks; a model
    /// given a rule follows it.
    pub fn tool_envelope() -> Self {
        ResponseContract {
            instructions: "Either answer the user in plain prose, or call tools by writing \
                 the calls exactly as AFFORDANCES shows them and nothing else. Results come \
                 back on lines beginning `Result:` — read them, then answer."
                .into(),
            object: None,
        }
    }

    /// Whatever a caller needs to say instead. Used by the summarizer, whose
    /// output is notes rather than a reply to anyone.
    pub fn saying(instructions: impl Into<String>) -> Self {
        ResponseContract {
            instructions: instructions.into(),
            object: None,
        }
    }
}

impl Component for ResponseContract {
    fn id(&self) -> SectionId {
        SectionId("response_contract".into())
    }
    fn slot(&self) -> Slot {
        Slot::Response
    }
    fn intent(&self) -> String {
        "The exact shape of the expected reply.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Static
    }
    /// Never degrades. A model that has lost the shape of its own reply does
    /// not produce a shorter answer — it produces an unusable one, so there is
    /// no version of this section worth having less of.
    fn floor(&self) -> Fidelity {
        Fidelity::Full
    }
    fn budget_priority(&self) -> u8 {
        0
    }
    fn render(&self) -> Vec<Part> {
        self.render_in(Form::DEFAULT)
    }
    /// A shaped contract writes its object; a prose one has only its sentence,
    /// in every notation.
    fn render_in(&self, form: Form) -> Vec<Part> {
        match &self.object {
            Some(object) => object.render_in(form),
            None => text(self.instructions.trim()),
        }
    }
    fn forms(&self) -> &'static [Form] {
        match self.object {
            Some(_) => &BOTH,
            None => &[Form::Markdown],
        }
    }
    /// Always renders: a prompt with no reply shape is the one thing the
    /// assembler refuses to build.
    fn applies(&self) -> bool {
        true
    }
}
