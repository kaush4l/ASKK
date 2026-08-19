//! THE SPECIAL RESPONSE OBJECT — a reply shape stated as fields rather than
//! described in a sentence.
//!
//! `ResponseContract::prose()` says "answer in plain prose", which is all a
//! conversational turn needs. A phase whose reply the MACHINE reads needs more
//! than that: the strategy vote is parsed, the plan brief is read back to the
//! work that follows, and a verdict decides whether a turn may report itself
//! answered. For those the shape is not advice, it is a contract, and a
//! sentence describing it is the loosest possible way to state one.
//!
//! WHY LINES AND NOT JSON BY DEFAULT. This app ships against a 12B running
//! locally. Asked for `{"route": "..."}` it produces valid JSON most of the
//! time, and the failures are silent — a stray fence, a trailing comma, a
//! preamble before the brace — each of which turns a parse into a fallback.
//! Asked for a line beginning `ROUTE:` it is right nearly always, and the
//! failures are visible in the reply itself. So `Form::Markdown` is the default
//! and `Form::Json` is there for a provider that can constrain generation,
//! where the argument reverses.

use context::{Form, Part};

/// One field the reply must carry: the word that opens its line, and what
/// belongs after it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Field {
    pub name: &'static str,
    pub about: &'static str,
}

/// The reply shape a phase demands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResponseObject {
    /// What the reply is for, in one sentence, before the fields.
    pub about: &'static str,
    pub fields: &'static [Field],
}

impl ResponseObject {
    /// The shape as instructions, in the notation asked for.
    pub fn render_in(&self, form: Form) -> Vec<Part> {
        let text = match form {
            Form::Markdown => self.lines(),
            Form::Json => self.json(),
        };
        context::text(text)
    }

    /// Named lines: `NAME: what goes here`. The instruction is "these lines and
    /// nothing else" rather than "include these lines", because a model told to
    /// include something includes it inside a paragraph.
    fn lines(&self) -> String {
        let body: Vec<String> = self
            .fields
            .iter()
            .map(|f| format!("{}: {}", f.name, f.about))
            .collect();
        format!(
            "{}\n\nReply with exactly these lines, each starting with its word, and write \
             nothing else — no preamble, no explanation after them:\n\n{}",
            self.about,
            body.join("\n")
        )
    }

    /// The same object as JSON. Written as a filled-in example rather than as a
    /// schema: a model shown `{"route": "<answer|react|project>"}` copies the
    /// shape, while one shown `{"type": "object", "properties": …}` reasons
    /// about it and sometimes replies with the schema.
    fn json(&self) -> String {
        let body: Vec<String> = self
            .fields
            .iter()
            .map(|f| format!("  {:?}: \"{}\"", f.name.to_lowercase(), f.about))
            .collect();
        format!(
            "{}\n\nReply with one JSON object and nothing else — no fence, no text before or \
             after it:\n\n{{\n{}\n}}",
            self.about,
            body.join(",\n")
        )
    }
}

/// Both notations, for a contract that carries one of these.
pub(crate) const BOTH: [Form; 2] = [Form::Markdown, Form::Json];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::ResponseContract;
    use context::Component;

    fn body(parts: Vec<context::Part>) -> String {
        parts
            .iter()
            .map(|p| match p {
                context::Part::Text { text } => text.clone(),
                other => format!("{other:?}"),
            })
            .collect()
    }

    /// A SHAPED CONTRACT MEANS SOMETHING DIFFERENT IN EACH NOTATION, which is
    /// the whole reason `render_in` exists. The fields are the same object; the
    /// instructions for writing it down are not.
    #[test]
    fn a_shaped_contract_writes_itself_as_lines_or_as_json() {
        let contract = ResponseContract::shaped(crate::strategy::OBJECT);
        assert_eq!(contract.forms(), &BOTH, "it declares both, and means it");

        let lines = body(contract.render_in(Form::Markdown));
        assert!(lines.contains("ROUTE: one word"), "{lines}");
        assert!(!lines.contains('{'), "the default notation is not JSON: {lines}");

        let json = body(contract.render_in(Form::Json));
        assert!(json.contains("\"route\""), "{json}");
        assert!(json.contains("\"why\""), "{json}");
        assert!(json.trim_end().ends_with('}'), "one object and nothing after it: {json}");

        // …and the DEFAULT is the lines, because that is what this build's
        // model follows. `render` and `render_in(DEFAULT)` are one answer.
        assert_eq!(body(contract.render()), lines);
    }

    /// PROSE HAS ONE NOTATION AND SAYS SO. Asked for JSON, a paragraph is still
    /// a paragraph — the honest answer, and the reason `render_in` has a
    /// default rather than being required of every component.
    #[test]
    fn an_unshaped_contract_declares_one_form_and_ignores_the_request() {
        let contract = ResponseContract::prose();
        assert_eq!(contract.forms(), &[Form::Markdown]);
        assert_eq!(body(contract.render_in(Form::Json)), body(contract.render()));
    }


    /// THE WIRE IS LIVE — the notation reaches the PAPER, not just `render_in`.
    ///
    /// The two tests above call `render_in` directly, so they passed even while
    /// `Component::section` hardcoded `render()` and no caller ever chose a
    /// notation. This one goes through the path a real call takes: set the
    /// paper's form, rebuild the section through `set_component`, assemble, and
    /// read the bytes the model would see.
    ///
    /// Both halves matter. The shaped contract must honour the request; the
    /// soul, which declares one form, must IGNORE it. The second assertion is
    /// what proves `forms()` is consulted rather than the form applied blindly.
    #[test]
    fn the_papers_form_reaches_the_assembled_section_and_only_where_supported() {
        let at = kernel::Timestamp(0);
        let mut paper = crate::components::seed();
        paper.form = Form::Json;
        let shaped = ResponseContract::shaped(crate::strategy::OBJECT);
        crate::paper::set_component(&mut paper, &shaped, at);

        let doc = context::assemble(&paper, kernel::PhaseId::Work, context::Budget::unlimited());
        let section = |id: &str| {
            body(
                doc.sections
                    .iter()
                    .find(|s| s.id.0 == id)
                    .unwrap_or_else(|| panic!("{id} is in the paper"))
                    .parts
                    .clone(),
            )
        };

        let contract = section("response_contract");
        assert!(contract.contains("\"route\""), "asked for Json, got: {contract}");
        assert!(contract.contains("\"why\""), "{contract}");

        // …and the component that has only one notation is untouched by the ask.
        let soul = section("soul");
        assert!(!soul.contains('{'), "a prose block stays prose in Json: {soul}");
        assert_eq!(soul, body(super::super::Soul::default().render()));
    }
}
