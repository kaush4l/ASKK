//! # Asks: what an engine waits for the owner to say
//!
//! An engine that cannot go on writes its question into its `asks.md`, one line each:
//! `- the question? Asked by: who`. A box with such a line is blocked. This file reads the
//! lines ([`parse_asks`]) and writes the answer as the message the engine expects
//! ([`answer_text`]), so the Asks page and a blocked box answer in the same words.
#![cfg_attr(feature = "local", allow(dead_code))]

/// One open question for the owner.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ask {
    pub question: String,
    pub asked_by: String,
}

/// Parse `- question? Asked by: who` lines (the split is on the last ` Asked by: `).
pub fn parse_asks(text: &str) -> Vec<Ask> {
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("- "))
        .map(|rest| match rest.rsplit_once(" Asked by: ") {
            Some((q, by)) => Ask { question: q.trim().into(), asked_by: by.trim().into() },
            None => Ask { question: rest.trim().into(), asked_by: String::new() },
        })
        .filter(|a| !a.question.is_empty())
        .collect()
}

/// The message an answer is sent as: it names the question so the receiver can route it.
pub fn answer_text(question: &str, answer: &str) -> String {
    format!("Answer to: {question}\n{}", answer.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURRENT: &str = "- Which contact details should the footer show (email, GitHub, LinkedIn, other) and the exact values or links? Asked by: user request #41 via askk/developer, to fill the footer config.\n- SPY buy: no order tool exists in the repo and the market was closed. Retry at Mon 2026-11-09 09:30 ET, and which tool or broker path should place the order (add one)? Asked by: askk/developer #54.\n";

    #[test]
    fn parses_the_current_asks() {
        let a = parse_asks(CURRENT);
        assert_eq!(a.len(), 2);
        assert!(a[0].question.starts_with("Which contact details") && a[0].question.ends_with("links?"));
        assert!(a[0].asked_by.starts_with("user request #41"));
        assert!(a[1].question.starts_with("SPY buy") && a[1].question.ends_with("(add one)?"));
        assert_eq!(a[1].asked_by, "askk/developer #54.");
    }

    #[test]
    fn empty_input_has_no_asks() {
        assert!(parse_asks("").is_empty());
        assert!(parse_asks("\n\nnot a list line\n").is_empty());
    }

    #[test]
    fn answer_names_the_question() {
        let t = answer_text("Retry the SPY buy?", " yes ");
        assert_eq!(t, "Answer to: Retry the SPY buy?\nyes");
    }
}
