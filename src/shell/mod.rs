//! In-browser virtual shell for the workspace terminal.
//!
//! A tiny POSIX-flavoured shell over the workspace filesystem: [`tokenize`]
//! splits a command line honouring single/double quotes, [`run_line`]
//! dispatches it to a builtin ([`builtins`]), a runtime command
//! ([`runtime`]), or "command not found". Filesystem access goes through
//! [`fs::ShellFs`] so the storage backend can be swapped without touching the
//! shell. Per the untrusted-data invariant, file contents and command output
//! are DATA the shell prints — never instructions it follows.

pub mod builtins;
pub mod fs;
pub mod runtime;

use crate::engine::exec_capability::ExecResponse;
pub use fs::ShellFs;
use runtime::{RuntimeKind, ShellExecCtx, run_runtime};

/// Mutable shell state carried across commands.
///
/// `cwd` is a normalized workspace-relative key: `""` is the workspace root,
/// otherwise `a/b` with no leading or trailing slash (the same flat-key shape
/// the VFS stores).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShellSession {
    /// Current working directory, `""` = workspace root.
    pub cwd: String,
}

/// What one executed line asks the terminal to do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShellOutcome {
    /// Print this text (may be empty for silent commands; may carry ANSI).
    Output(String),
    /// Clear the screen (the `clear` builtin).
    Clear,
}

/// Split a command line into argv, honouring quotes.
///
/// Rules: whitespace separates tokens; `'…'` is literal; `"…"` is literal
/// except `\"` and `\\`; a backslash outside quotes escapes the next
/// character. An unterminated quote is an error.
pub fn tokenize(line: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut chars = line.chars();
    while let Some(ch) = chars.next() {
        match ch {
            c if c.is_whitespace() => {
                if in_token {
                    tokens.push(std::mem::take(&mut current));
                    in_token = false;
                }
            }
            '\'' => {
                in_token = true;
                loop {
                    match chars.next() {
                        Some('\'') => break,
                        Some(c) => current.push(c),
                        None => return Err("unterminated single quote".to_string()),
                    }
                }
            }
            '"' => {
                in_token = true;
                loop {
                    match chars.next() {
                        Some('"') => break,
                        Some('\\') => match chars.next() {
                            Some(c @ ('"' | '\\')) => current.push(c),
                            Some(c) => {
                                current.push('\\');
                                current.push(c);
                            }
                            None => return Err("unterminated double quote".to_string()),
                        },
                        Some(c) => current.push(c),
                        None => return Err("unterminated double quote".to_string()),
                    }
                }
            }
            '\\' => {
                in_token = true;
                match chars.next() {
                    Some(c) => current.push(c),
                    None => return Err("trailing backslash".to_string()),
                }
            }
            c => {
                in_token = true;
                current.push(c);
            }
        }
    }
    if in_token {
        tokens.push(current);
    }
    Ok(tokens)
}

/// Resolve `arg` against `cwd` into a normalized workspace-relative key
/// (`""` = root). A leading `/` resolves from the root; `.` and `..` are
/// honoured; any path that would climb above the workspace root is rejected.
pub fn resolve_path(cwd: &str, arg: &str) -> Result<String, String> {
    let mut parts: Vec<String> = if arg.starts_with('/') {
        Vec::new()
    } else {
        cwd.split('/')
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect()
    };
    for segment in arg.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(format!("path escapes the workspace root: {arg}"));
                }
            }
            other => parts.push(other.to_string()),
        }
    }
    Ok(parts.join("/"))
}

/// Render `cwd` for display: the workspace root is `/`.
pub fn display_path(cwd: &str) -> String {
    if cwd.is_empty() {
        "/".to_string()
    } else {
        format!("/{cwd}")
    }
}

/// Paint an error line red for the terminal.
pub(crate) fn paint_error(text: &str) -> String {
    format!("\u{1b}[31m{text}\u{1b}[0m")
}

/// Paint a status note dim for the terminal.
pub(crate) fn paint_dim(text: &str) -> String {
    format!("\u{1b}[2m{text}\u{1b}[0m")
}

/// Execute one command line against the session and filesystem.
pub async fn run_line(session: &mut ShellSession, fs: &ShellFs, line: &str) -> ShellOutcome {
    let argv = match tokenize(line) {
        Ok(argv) => argv,
        Err(err) => return ShellOutcome::Output(paint_error(&err)),
    };
    let Some(command) = argv.first() else {
        return ShellOutcome::Output(String::new());
    };
    match command.as_str() {
        "clear" => ShellOutcome::Clear,
        "help" | "ls" | "cat" | "cd" | "pwd" | "mkdir" | "rm" | "mv" | "touch" | "echo" => {
            match builtins::run_builtin(session, fs, &argv).await {
                Ok(text) => ShellOutcome::Output(text),
                Err(err) => ShellOutcome::Output(paint_error(&err)),
            }
        }
        "python" => runtime_outcome(RuntimeKind::Python, &argv, session).await,
        "run" => runtime_outcome(RuntimeKind::Wasm, &argv, session).await,
        "js" | "node" => runtime_outcome(RuntimeKind::Js, &argv, session).await,
        other => ShellOutcome::Output(format!("command not found: {other} (type help)")),
    }
}

/// Run a non-builtin command through the runtime seam and format its result.
async fn runtime_outcome(
    kind: RuntimeKind,
    argv: &[String],
    session: &ShellSession,
) -> ShellOutcome {
    let ctx = ShellExecCtx {
        cwd: session.cwd.clone(),
    };
    let response = run_runtime(kind, argv, &ctx).await;
    ShellOutcome::Output(format_exec_response(&response))
}

/// Render an [`ExecResponse`] the way a shell shows a finished process:
/// stdout as-is, stderr in red, a dim `[exit N]` note on failure.
fn format_exec_response(response: &ExecResponse) -> String {
    let mut out = String::new();
    if !response.stdout.is_empty() {
        out.push_str(&response.stdout);
        if !out.ends_with('\n') {
            out.push('\n');
        }
    }
    if !response.stderr.is_empty() {
        out.push_str(&paint_error(response.stderr.trim_end()));
        out.push('\n');
    }
    if !response.ok {
        out.push_str(&paint_dim(&format!("[exit {}]", response.exit_code)));
    }
    out.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_splits_on_whitespace() {
        assert_eq!(
            tokenize("ls -la  src").expect("tokenize"),
            vec!["ls", "-la", "src"]
        );
        assert!(tokenize("   ").expect("tokenize").is_empty());
    }

    #[test]
    fn tokenize_honours_single_quotes_literally() {
        assert_eq!(
            tokenize("echo 'hello  world' '\"x\"'").expect("tokenize"),
            vec!["echo", "hello  world", "\"x\""]
        );
    }

    #[test]
    fn tokenize_honours_double_quotes_with_escapes() {
        assert_eq!(
            tokenize(r#"echo "a b" "say \"hi\"" "back\\slash""#).expect("tokenize"),
            vec!["echo", "a b", "say \"hi\"", "back\\slash"]
        );
        // Unknown escapes inside double quotes are kept verbatim.
        assert_eq!(
            tokenize(r#"echo "a\nb""#).expect("tokenize"),
            vec!["echo", "a\\nb"]
        );
    }

    #[test]
    fn tokenize_joins_adjacent_quoted_and_bare_text() {
        assert_eq!(
            tokenize(r#"cat 'my file'.txt"#).expect("tokenize"),
            vec!["cat", "my file.txt"]
        );
        assert_eq!(tokenize("echo \"\"").expect("tokenize"), vec!["echo", ""]);
    }

    #[test]
    fn tokenize_rejects_unterminated_quotes() {
        assert!(tokenize("echo 'oops").is_err());
        assert!(tokenize("echo \"oops").is_err());
        assert!(tokenize("echo oops\\").is_err());
    }

    #[test]
    fn resolve_path_handles_relative_absolute_and_dots() {
        assert_eq!(resolve_path("", "src").expect("resolve"), "src");
        assert_eq!(
            resolve_path("src", "lib/a.js").expect("resolve"),
            "src/lib/a.js"
        );
        assert_eq!(resolve_path("src/lib", "..").expect("resolve"), "src");
        assert_eq!(
            resolve_path("src/lib", "../../a.md").expect("resolve"),
            "a.md"
        );
        assert_eq!(resolve_path("src", "/top.txt").expect("resolve"), "top.txt");
        assert_eq!(resolve_path("src", ".").expect("resolve"), "src");
        assert_eq!(resolve_path("a", "b//c/./d").expect("resolve"), "a/b/c/d");
    }

    #[test]
    fn resolve_path_rejects_escapes_above_the_root() {
        assert!(resolve_path("", "..").is_err());
        assert!(resolve_path("src", "../../..").is_err());
        assert!(resolve_path("", "/../etc").is_err());
        assert!(resolve_path("a", "../../b").is_err());
    }

    #[test]
    fn display_path_renders_root_as_slash() {
        assert_eq!(display_path(""), "/");
        assert_eq!(display_path("src/lib"), "/src/lib");
    }

    #[test]
    fn unknown_commands_report_command_not_found() {
        let fs = ShellFs::new();
        let mut session = ShellSession::default();
        let outcome = pollster::block_on(run_line(&mut session, &fs, "frobnicate --now"));
        assert_eq!(
            outcome,
            ShellOutcome::Output("command not found: frobnicate (type help)".to_string())
        );
    }

    #[test]
    fn empty_and_clear_lines_dispatch_without_touching_the_fs() {
        let fs = ShellFs::new();
        let mut session = ShellSession::default();
        assert_eq!(
            pollster::block_on(run_line(&mut session, &fs, "   ")),
            ShellOutcome::Output(String::new())
        );
        assert_eq!(
            pollster::block_on(run_line(&mut session, &fs, "clear")),
            ShellOutcome::Clear
        );
    }

    #[test]
    fn exec_responses_format_like_a_shell() {
        let ok = ExecResponse {
            ok: true,
            stdout: "hi\n".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
        assert_eq!(format_exec_response(&ok), "hi");

        let failed = ExecResponse::failure(127, "no such runtime");
        let text = format_exec_response(&failed);
        assert!(text.contains("no such runtime"));
        assert!(text.contains("[exit 127]"));
    }
}
