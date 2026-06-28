//! Pipeline parsing for the virtual shell.
//!
//! [`parse_pipeline`] folds a flat token stream (already split by
//! [`super::tokenize`]) into a [`Pipeline`]: a list of [`Stage`]s separated by
//! `|`, where each stage carries its own argv plus the file redirections
//! (`<`, `>`, `>>`) pulled out of the token run. Operators are recognised here
//! and nowhere else, so the rest of the shell sees clean argv vectors and an
//! explicit list of what to read from / write to.
//!
//! The parser is pure and host-testable — it never touches the filesystem; it
//! only decides *structure*. Globbing and execution happen later.

/// A single redirection attached to a stage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Redirect {
    /// `< path`: feed the file's contents to the stage's stdin.
    Input(String),
    /// `> path`: truncate-write the stage's stdout to the file.
    Output(String),
    /// `>> path`: append the stage's stdout to the file.
    Append(String),
}

/// One command in a pipeline: its argv and any redirections.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Stage {
    /// The command and its arguments (operators already stripped out).
    pub argv: Vec<String>,
    /// Redirections in the order they appeared on the line.
    pub redirects: Vec<Redirect>,
}

impl Stage {
    /// The last input redirection wins, mirroring POSIX `cmd < a < b`.
    pub fn input_target(&self) -> Option<&str> {
        self.redirects.iter().rev().find_map(|redir| match redir {
            Redirect::Input(path) => Some(path.as_str()),
            _ => None,
        })
    }

    /// The last output redirection wins, with its append flag. POSIX lets a
    /// later `>`/`>>` override an earlier one (`cmd > a > b` writes only `b`).
    pub fn output_target(&self) -> Option<(&str, bool)> {
        self.redirects.iter().rev().find_map(|redir| match redir {
            Redirect::Output(path) => Some((path.as_str(), false)),
            Redirect::Append(path) => Some((path.as_str(), true)),
            Redirect::Input(_) => None,
        })
    }
}

/// A parsed command line: one or more stages joined by `|`.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Pipeline {
    pub stages: Vec<Stage>,
}

/// Fold a token stream into a [`Pipeline`].
///
/// `|` ends the current stage and begins the next; `<`, `>` and `>>` consume
/// the following token as their target path. Errors mirror a real shell:
/// an operator with no following path, an empty stage (e.g. a leading or
/// doubled `|`), or a redirect that would have no command to attach to.
pub fn parse_pipeline(tokens: &[String]) -> Result<Pipeline, String> {
    if tokens.is_empty() {
        return Ok(Pipeline::default());
    }
    let mut stages = Vec::new();
    let mut current = Stage::default();
    let mut iter = tokens.iter();
    while let Some(token) = iter.next() {
        match token.as_str() {
            "|" => {
                finish_stage(&mut stages, std::mem::take(&mut current))?;
            }
            "<" | ">" | ">>" => {
                let target = iter
                    .next()
                    .ok_or_else(|| format!("syntax error: expected a file path after '{token}'"))?;
                if is_operator(target) {
                    return Err(format!(
                        "syntax error: expected a file path after '{token}', found '{target}'"
                    ));
                }
                let redirect = match token.as_str() {
                    "<" => Redirect::Input(target.clone()),
                    ">" => Redirect::Output(target.clone()),
                    _ => Redirect::Append(target.clone()),
                };
                current.redirects.push(redirect);
            }
            _ => current.argv.push(token.clone()),
        }
    }
    finish_stage(&mut stages, current)?;
    Ok(Pipeline { stages })
}

/// Push a finished stage, rejecting empties (a `|` with nothing on a side).
fn finish_stage(stages: &mut Vec<Stage>, stage: Stage) -> Result<(), String> {
    if stage.argv.is_empty() {
        if stage.redirects.is_empty() {
            return Err("syntax error: empty command near '|'".to_string());
        }
        return Err("syntax error: redirection without a command".to_string());
    }
    stages.push(stage);
    Ok(())
}

/// Whether a token is a control operator (so it can't be a redirect target).
fn is_operator(token: &str) -> bool {
    matches!(token, "|" | "<" | ">" | ">>")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        toks(parts)
    }

    #[test]
    fn parses_a_plain_command_as_one_stage() {
        let pipeline = parse_pipeline(&toks(&["ls", "-la", "src"])).expect("parse");
        assert_eq!(pipeline.stages.len(), 1);
        assert_eq!(pipeline.stages[0].argv, argv(&["ls", "-la", "src"]));
        assert!(pipeline.stages[0].redirects.is_empty());
    }

    #[test]
    fn splits_stages_on_the_pipe() {
        let pipeline = parse_pipeline(&toks(&["cat", "a.txt", "|", "grep", "x"])).expect("parse");
        assert_eq!(pipeline.stages.len(), 2);
        assert_eq!(pipeline.stages[0].argv, argv(&["cat", "a.txt"]));
        assert_eq!(pipeline.stages[1].argv, argv(&["grep", "x"]));
    }

    #[test]
    fn pulls_redirections_out_of_the_argv() {
        let pipeline = parse_pipeline(&toks(&["echo", "hi", ">", "out.txt"])).expect("parse");
        assert_eq!(pipeline.stages[0].argv, argv(&["echo", "hi"]));
        assert_eq!(pipeline.stages[0].output_target(), Some(("out.txt", false)));

        let pipeline = parse_pipeline(&toks(&["echo", "hi", ">>", "log"])).expect("parse");
        assert_eq!(pipeline.stages[0].output_target(), Some(("log", true)));

        let pipeline = parse_pipeline(&toks(&["cat", "<", "in.txt"])).expect("parse");
        assert_eq!(pipeline.stages[0].argv, argv(&["cat"]));
        assert_eq!(pipeline.stages[0].input_target(), Some("in.txt"));
    }

    #[test]
    fn redirections_may_sit_anywhere_in_the_run() {
        // `> out cat a` — redirect before the command, like a real shell.
        let pipeline = parse_pipeline(&toks(&[">", "out", "cat", "a"])).expect("parse");
        assert_eq!(pipeline.stages[0].argv, argv(&["cat", "a"]));
        assert_eq!(pipeline.stages[0].output_target(), Some(("out", false)));
    }

    #[test]
    fn last_redirection_of_a_kind_wins() {
        let pipeline = parse_pipeline(&toks(&["echo", "x", ">", "a", ">", "b"])).expect("parse");
        assert_eq!(pipeline.stages[0].output_target(), Some(("b", false)));
        let pipeline = parse_pipeline(&toks(&["cat", "<", "a", "<", "b"])).expect("parse");
        assert_eq!(pipeline.stages[0].input_target(), Some("b"));
    }

    #[test]
    fn rejects_operator_without_a_target() {
        assert!(parse_pipeline(&toks(&["echo", ">"])).is_err());
        assert!(parse_pipeline(&toks(&["cat", "<"])).is_err());
        assert!(parse_pipeline(&toks(&["echo", ">", ">>"])).is_err());
    }

    #[test]
    fn rejects_empty_stages_around_pipes() {
        assert!(parse_pipeline(&toks(&["|", "ls"])).is_err());
        assert!(parse_pipeline(&toks(&["ls", "|"])).is_err());
        assert!(parse_pipeline(&toks(&["ls", "|", "|", "wc"])).is_err());
    }

    #[test]
    fn rejects_a_redirect_only_stage() {
        // `> out` on its own has nowhere to attach.
        assert!(parse_pipeline(&toks(&[">", "out"])).is_err());
        assert!(parse_pipeline(&toks(&["ls", "|", ">", "out"])).is_err());
    }

    #[test]
    fn empty_token_stream_yields_no_stages() {
        let pipeline = parse_pipeline(&[]).expect("parse");
        assert!(pipeline.stages.is_empty());
    }
}
