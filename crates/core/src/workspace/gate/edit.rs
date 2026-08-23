//! A CHECKED EDIT — `edit_file`, and the one rule that makes it safe to give a
//! model at all: the text it says it is replacing must be in the file EXACTLY
//! ONCE, or nothing is written and the refusal says what was actually there.
//!
//! **WHY IT EXISTS.** `write_file` was the only way to change a file, and
//! `write_file` REPLACES: an agent that wants to alter one line of a 900-line
//! file has to reproduce the other 899 from its own context, and a model that
//! misremembers one of them destroys work the environment cannot get back —
//! this guest keeps nothing across a reload (`agent::environment::DURABLE`), so
//! there is no earlier copy anywhere. That is the "loses work" this increment
//! is named after, and it is the half nobody was measuring.
//!
//! **WHY THE RULE IS `find` OCCURS ONCE, AND WHY IT REFUSES RATHER THAN
//! REWRITES.** It is `agent::relative_path`'s law
//! (`crates/agent/src/workspace.rs:152-170`) applied to content instead of to
//! a path: a silently clamped edit lands somewhere the agent did not mean and
//! it has no way to find out, while a refusal that quotes the mismatch back is
//! the thing that lets it correct itself. Two occurrences is not a
//! tie to break — it is the model not having said which one.
//!
//! **THE READ-MODIFY-WRITE, AND WHY IT IS NOT A RACE.** It is two port calls
//! with another agent's calls able to sit between them, which on any ordinary
//! machine is a lost update. Not here: `c2w.js` runs every command in this
//! browser through one promise `queue` against one `/bin/sh`, and that shared
//! fate — the thing `agent::environment::QUEUE` tells the model about as a cost
//! — is what makes this pair safe. Written down because the day there are two
//! shells it stops being true, and nothing else would say so.

use context::Args;
use kernel::{Execution, WorkspacePort};

/// Run `edit_file`, or refuse it in the model's own vocabulary.
pub(super) async fn run(
    port: &dyn WorkspacePort,
    root: &str,
    path: &str,
    args: &Args,
) -> Result<Execution, String> {
    // `find` and `replace` are TEXT and not names: the whitespace in them is
    // the argument. Trimming here would make a call that says it is replacing
    // `    return 1` replace something else (`crates/context/src/args.rs:19`).
    let find = args.text("find").map_err(|_| SHAPE.to_string())?;
    let replace = args.text("replace").map_err(|_| SHAPE.to_string())?;
    let before = port.read(root, path).await.map_err(super::unavailable)?;
    if before.status != 0 {
        return Ok(before);
    }
    let after = replaced(&before.output, find, replace).map_err(|why| refusal(path, find, &why))?;
    let wrote = port.write(root, path, &after).await.map_err(super::unavailable)?;
    match wrote.status {
        0 => Ok(Execution {
            status: 0,
            output: format!("edited {path}: replaced one occurrence, at line {}.", line_of(&before.output, find)),
        }),
        _ => Ok(wrote),
    }
}

/// Why an edit could not be made, as a COUNT, so the refusal can say the true
/// number rather than "not found or ambiguous".
#[derive(Debug)]
enum Why {
    /// `find` was the empty string, which is in every file everywhere.
    Blank,
    /// It is there this many times, and that is not one.
    Occurrences(usize),
}

/// `text` with the one occurrence of `find` replaced — or why not. Pure, so the
/// rule is testable without a shell (I3).
fn replaced(text: &str, find: &str, replace: &str) -> Result<String, Why> {
    if find.is_empty() {
        return Err(Why::Blank);
    }
    match text.matches(find).count() {
        1 => Ok(text.replacen(find, replace, 1)),
        n => Err(Why::Occurrences(n)),
    }
}

/// Which line the single occurrence starts on, counting from one — the number a
/// model can act on, and the only part of a successful edit worth saying.
fn line_of(text: &str, find: &str) -> usize {
    text.find(find).map_or(1, |at| text[..at].matches('\n').count() + 1)
}

/// The refusal, and it always ends the same way: THE FILE IS UNCHANGED. That
/// sentence is the whole reason this tool can be granted — a model that is not
/// certain whether its edit landed will write the file wholesale to be sure,
/// which is the destruction this tool replaces.
fn refusal(path: &str, find: &str, why: &Why) -> String {
    let said = match why {
        Why::Blank => "'find' was empty, and an empty string is in every file".to_string(),
        Why::Occurrences(0) => format!("that text is not in {path}"),
        Why::Occurrences(n) => format!(
            "that text is in {path} {n} times, so it does not name one place — include more of \
             the surrounding lines until it does"
        ),
    };
    format!(
        "nothing was edited and {path} is unchanged: {said}. You asked to replace:\n{}\n{SHAPE}",
        quoted(find)
    )
}

/// What was searched for, quoted back and bounded. The mismatch is the whole
/// value of the refusal — a model cannot fix a search it cannot see — but a
/// `find` the size of a file would spend the window twice over.
fn quoted(find: &str) -> String {
    match find.char_indices().nth(400) {
        Some((cut, _)) => format!("---\n{}\n--- (the first 400 characters of what you sent)", &find[..cut]),
        None => format!("---\n{find}\n---"),
    }
}

/// The call this tool wants, in its own vocabulary — every refusal ends in the
/// line the model should have written (`gate/files.rs`'s rule).
const SHAPE: &str = r#"Call it as edit_file({"path": "notes/today.md", "find": "the exact text to replace", "replace": "the new text"})."#;

#[cfg(test)]
mod tests {
    use super::{line_of, refusal, replaced, Why};

    /// The rule, in all three directions.
    #[test]
    fn an_edit_lands_only_when_the_text_it_names_is_in_the_file_once() {
        assert_eq!(replaced("a b a", "b", "B").unwrap(), "a B a");
        assert!(matches!(replaced("a b a", "a", "X"), Err(Why::Occurrences(2))));
        assert!(matches!(replaced("a b a", "z", "X"), Err(Why::Occurrences(0))));
        assert!(matches!(replaced("a b a", "", "X"), Err(Why::Blank)));
        // Verbatim: the leading whitespace is part of what was named.
        assert_eq!(replaced("x\n    y\n", "    y", "    z").unwrap(), "x\n    z\n");
    }

    /// A refusal names the file, says it is unchanged, quotes the search back
    /// and ends in the call shape.
    #[test]
    fn a_refusal_hands_back_the_mismatch_and_never_a_half_edit() {
        let said = refusal("a.md", "hello", &Why::Occurrences(3));
        assert!(said.contains("a.md is unchanged"), "{said}");
        assert!(said.contains("3 times"), "{said}");
        assert!(said.contains("hello"), "the search is quoted back: {said}");
        assert!(said.contains("edit_file({"), "{said}");
        // A huge search is bounded rather than reprinted whole.
        let big = refusal("a.md", &"x".repeat(5000), &Why::Occurrences(0));
        assert!(big.len() < 1200, "a refusal must not spend the window: {}", big.len());
    }

    #[test]
    fn the_line_reported_is_where_the_replaced_text_starts() {
        assert_eq!(line_of("one\ntwo\nthree\n", "three"), 3);
        assert_eq!(line_of("one\ntwo\n", "one"), 1);
    }
}
