//! The pinned head: who this agent is, before it is told anything else.

use context::{text, Component, Fidelity, Part, Slot, Stability};
use kernel::SectionId;

/// The agent's own file, verbatim. `adopt_spec` fills this with the markdown
/// body of `agent.md`, which IS the system prompt — there is no second place
/// an agent's character is written down.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Soul {
    pub text: String,
}

impl Default for Soul {
    fn default() -> Self {
        Soul {
            text: "You are HARNESS, a personal agent living in this browser. Values: \
                   honesty over comfort, the smallest correct step, legibility over \
                   cleverness. Voice: plain, direct, unhurried."
                .into(),
        }
    }
}

impl Component for Soul {
    fn id(&self) -> SectionId {
        SectionId("soul".into())
    }
    fn slot(&self) -> Slot {
        Slot::SOUL
    }
    fn intent(&self) -> String {
        "Who this agent is; values and voice.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Static
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Summarized
    }
    fn budget_priority(&self) -> u8 {
        0
    }
    fn render(&self) -> Vec<Part> {
        text(nested(self.text.trim()))
    }
}

/// Push every markdown heading in an agent file down one level.
///
/// An `agent.md` is written as a document, so it uses `##` for its own
/// sections — "## Tools", "## The shared space". The paper uses `##` for the
/// blocks it assembles. Rendered as-is the two are indistinguishable, and the
/// model reads one flat list in which the agent's prose about tools sits at
/// the same level as the actual list of tools it may call. Demoting the file's
/// headings makes the frame outrank the content, which is what it is.
///
/// Fenced code is left alone: a `#` at the start of a line inside a fence is a
/// shell comment, and rewriting it would corrupt an example the agent meant to
/// give.
fn nested(body: &str) -> String {
    let mut fenced = false;
    body.lines()
        .map(|line| {
            if line.trim_start().starts_with("```") {
                fenced = !fenced;
            }
            match !fenced && line.starts_with('#') {
                true => format!("#{line}"),
                false => line.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Name and one-line role. Separate from [`Soul`] so a long character brief
/// can be summarised away under budget pressure while the model still knows
/// what to call itself — the two degrade independently because they answer
/// different questions.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Identity {
    pub name: String,
    pub description: String,
}

impl Component for Identity {
    fn id(&self) -> SectionId {
        SectionId("identity".into())
    }
    fn slot(&self) -> Slot {
        Slot::IDENTITY
    }
    fn intent(&self) -> String {
        "Name, role, presentation.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Static
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Pointer
    }
    fn budget_priority(&self) -> u8 {
        1
    }
    fn render(&self) -> Vec<Part> {
        match (self.name.as_str(), self.description.trim()) {
            ("", _) => text("Name: HARNESS. Role: resident assistant."),
            // A name with no role behind it still ends cleanly; the old string
            // build left a trailing space here whenever the description was
            // absent, which is exactly the class of thing a component stops.
            (name, "") => text(format!("Name: {name}.")),
            (name, role) => text(format!("Name: {name}. {role}")),
        }
    }
}

/// The standing behavioural rules. Fixed: these are the house's, not the
/// agent file's, which is why nothing overwrites them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OperatingRules;

impl Component for OperatingRules {
    fn id(&self) -> SectionId {
        SectionId("operating_rules".into())
    }
    fn slot(&self) -> Slot {
        Slot::OPERATING_RULES
    }
    fn intent(&self) -> String {
        "How to behave; the response discipline.".into()
    }
    fn stability(&self) -> Stability {
        Stability::Static
    }
    fn floor(&self) -> Fidelity {
        Fidelity::Summarized
    }
    fn budget_priority(&self) -> u8 {
        1
    }
    fn render(&self) -> Vec<Part> {
        text(
            "Do one thing per turn. Never claim an action succeeded without an \
             observation proving it. Prefer asking over guessing.",
        )
    }
}
