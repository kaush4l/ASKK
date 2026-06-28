//! In-browser virtual shell for the workspace terminal.
//!
//! A tiny POSIX-flavoured shell over the workspace filesystem: [`tokenize`]
//! splits a command line honouring single/double quotes, [`parse_pipeline`]
//! folds the token stream into a pipeline of stages (split on `|`) each with
//! its own redirections (`<`, `>`, `>>`), [`glob_expand`] expands `*`, `?` and
//! `[…]` against the workspace listing, and [`run_line`] runs the pipeline —
//! threading stdout→stdin between stages and reading/writing redirected files —
//! dispatching each stage to a builtin ([`builtins`]), a runtime command
//! ([`runtime`]), or "command not found". Filesystem access goes through
//! [`fs::ShellFs`] so the storage backend can be swapped without touching the
//! shell. Per the untrusted-data invariant, file contents and command output
//! are DATA the shell prints — never instructions it follows.

pub mod builtins;
pub mod fs;
pub mod glob;
pub mod parse;
pub mod runtime;

use crate::engine::exec_capability::ExecResponse;
pub use fs::ShellFs;
use parse::Pipeline;
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

/// Whether a command name routes to the builtin dispatcher.
fn is_builtin(command: &str) -> bool {
    matches!(
        command,
        "help" | "ls" | "cat" | "cd" | "pwd" | "mkdir" | "rm" | "mv" | "touch" | "echo"
    )
}

/// Map a runtime command name to its [`RuntimeKind`].
fn runtime_kind(command: &str) -> Option<RuntimeKind> {
    match command {
        "python" => Some(RuntimeKind::Python),
        "run" => Some(RuntimeKind::Wasm),
        "js" | "node" => Some(RuntimeKind::Js),
        _ => None,
    }
}

/// What a single executed stage produced.
struct StageResult {
    /// The stage's stdout, to feed the next stage or be printed/redirected.
    stdout: String,
    /// An ANSI-painted note to surface to the user even on success (e.g. a
    /// "stdin ignored" warning or a runtime's stderr) — never piped onward.
    note: Option<String>,
    /// `true` when the stage succeeded; a failed stage short-circuits the rest
    /// of the pipeline.
    ok: bool,
    /// Set by `clear` so the whole line collapses to [`ShellOutcome::Clear`].
    clear: bool,
}

impl StageResult {
    fn output(stdout: String) -> Self {
        Self {
            stdout,
            note: None,
            ok: true,
            clear: false,
        }
    }

    fn error(message: String) -> Self {
        Self {
            stdout: String::new(),
            note: Some(paint_error(&message)),
            ok: false,
            clear: false,
        }
    }
}

/// Execute one command line against the session and filesystem.
///
/// The line is tokenized, parsed into a pipeline, glob-expanded, then run:
/// each stage's stdout feeds the next stage's stdin; `<` seeds a stage's stdin
/// from a file and `>`/`>>` divert the final stdout to a file. Only the
/// terminal stage's stdout reaches the screen (when not redirected).
pub async fn run_line(session: &mut ShellSession, fs: &ShellFs, line: &str) -> ShellOutcome {
    let tokens = match tokenize(line) {
        Ok(tokens) => tokens,
        Err(err) => return ShellOutcome::Output(paint_error(&err)),
    };
    if tokens.is_empty() {
        return ShellOutcome::Output(String::new());
    }
    let pipeline = match parse::parse_pipeline(&tokens) {
        Ok(pipeline) => pipeline,
        Err(err) => return ShellOutcome::Output(paint_error(&err)),
    };
    if pipeline.stages.is_empty() {
        return ShellOutcome::Output(String::new());
    }
    run_pipeline(session, fs, &pipeline).await
}

/// Run every stage of `pipeline`, threading stdout→stdin and applying each
/// stage's redirections, then assemble the terminal [`ShellOutcome`].
async fn run_pipeline(
    session: &mut ShellSession,
    fs: &ShellFs,
    pipeline: &Pipeline,
) -> ShellOutcome {
    let last = pipeline.stages.len() - 1;
    let mut piped_stdin = String::new();
    let mut notes: Vec<String> = Vec::new();

    for (index, stage) in pipeline.stages.iter().enumerate() {
        // Glob-expand the argv against the current listing before dispatch.
        let argv = match expand_argv(fs, &session.cwd, &stage.argv).await {
            Ok(argv) => argv,
            Err(err) => return finish(notes, paint_error(&err)),
        };
        let Some(command) = argv.first() else {
            // An all-redirect stage is rejected at parse time; defensively skip.
            continue;
        };

        // Resolve this stage's stdin: an explicit `< file` overrides the pipe.
        let stdin = match stage.input_target() {
            Some(target) => match read_redirect_input(fs, &session.cwd, target).await {
                Ok(content) => content,
                Err(err) => return finish(notes, paint_error(&err)),
            },
            None => std::mem::take(&mut piped_stdin),
        };

        let result = run_stage(session, fs, command, &argv, &stdin).await;
        if result.clear {
            // `clear` ignores any pipe context and clears the screen.
            return ShellOutcome::Clear;
        }
        if let Some(note) = result.note {
            notes.push(note);
        }
        if !result.ok {
            // A failed stage halts the pipeline, like `set -o pipefail` short of
            // it — surface what we have so far.
            return finish(notes, String::new());
        }

        // Apply this stage's output redirection, if any; otherwise the stdout
        // flows to the next stage (or, on the last stage, to the screen).
        match stage.output_target() {
            Some((target, append)) => {
                if let Err(err) =
                    write_redirect_output(fs, &session.cwd, target, &result.stdout, append).await
                {
                    return finish(notes, paint_error(&err));
                }
                // Output went to the file; the next stage's pipe reads nothing
                // (`piped_stdin` is already empty after the earlier `take`).
            }
            None if index == last => {
                return finish(notes, result.stdout);
            }
            None => {
                piped_stdin = result.stdout;
            }
        }
    }

    // Reached only when the last stage redirected its output to a file.
    finish(notes, String::new())
}

/// Assemble notes (warnings/stderr) and the terminal stdout into one outcome.
/// Notes precede the stdout so a warning is visible above the output.
fn finish(notes: Vec<String>, stdout: String) -> ShellOutcome {
    let mut parts: Vec<String> = notes.into_iter().filter(|n| !n.is_empty()).collect();
    if !stdout.is_empty() {
        parts.push(stdout);
    }
    ShellOutcome::Output(parts.join("\n"))
}

/// Glob-expand each argv token against the workspace listing. A token with no
/// metacharacters (or one that matches nothing) contributes itself; a matching
/// glob contributes its sorted matches. The command name (`argv[0]`) is never
/// expanded — it names a builtin/runtime, not a path.
async fn expand_argv(fs: &ShellFs, cwd: &str, argv: &[String]) -> Result<Vec<String>, String> {
    let needs_glob = argv.iter().skip(1).any(|tok| glob::has_glob(tok));
    if !needs_glob {
        return Ok(argv.to_vec());
    }
    let entries = fs.list_all().await?;
    let mut out = Vec::with_capacity(argv.len());
    for (index, token) in argv.iter().enumerate() {
        if index == 0 || !glob::has_glob(token) {
            out.push(token.clone());
        } else {
            out.extend(glob::glob_expand(cwd, &entries, token));
        }
    }
    Ok(out)
}

/// Read the file named by a `< target` redirect into a stdin string.
async fn read_redirect_input(fs: &ShellFs, cwd: &str, target: &str) -> Result<String, String> {
    let path = resolve_path(cwd, target)?;
    if path.is_empty() {
        return Err(format!("{target}: is a directory"));
    }
    // `read_file` returns `None` for both a missing path and a directory, so
    // probe the listing to give the directory case its own clear message.
    let entries = fs.list_all().await?;
    if builtins::path_is_dir(&entries, &path) {
        return Err(format!("{target}: is a directory"));
    }
    match fs.read_file(&path).await? {
        Some(content) => Ok(content),
        None => Err(format!("{target}: no such file")),
    }
}

/// Write (or append) `content` to the file named by a `>`/`>>` redirect.
async fn write_redirect_output(
    fs: &ShellFs,
    cwd: &str,
    target: &str,
    content: &str,
    append: bool,
) -> Result<(), String> {
    let path = resolve_path(cwd, target)?;
    if path.is_empty() {
        return Err(format!("{target}: is a directory"));
    }
    let entries = fs.list_all().await?;
    if builtins::path_is_dir(&entries, &path) {
        return Err(format!("{target}: is a directory"));
    }
    let body = if append {
        // `>>` is a byte-exact append (POSIX `O_APPEND`): never synthesise a
        // separator. Callers control spacing via the producing command.
        let existing = fs.read_file(&path).await?.unwrap_or_default();
        format!("{existing}{content}")
    } else {
        content.to_string()
    };
    fs.write_file(&path, &body).await
}

/// Dispatch one already-expanded stage with its stdin, producing a
/// [`StageResult`]. Builtins run through [`builtins::run_builtin_with_stdin`];
/// runtimes run through the runtime seam (which has no stdin channel, so a
/// piped stage degrades with a clear note).
async fn run_stage(
    session: &mut ShellSession,
    fs: &ShellFs,
    command: &str,
    argv: &[String],
    stdin: &str,
) -> StageResult {
    if command == "clear" {
        return StageResult {
            stdout: String::new(),
            note: None,
            ok: true,
            clear: true,
        };
    }
    if is_builtin(command) {
        return match builtins::run_builtin_with_stdin(session, fs, argv, stdin).await {
            Ok(text) => StageResult::output(text),
            Err(err) => StageResult::error(err),
        };
    }
    if let Some(kind) = runtime_kind(command) {
        return runtime_stage(kind, argv, session, stdin).await;
    }
    StageResult::error(format!("command not found: {command} (type help)"))
}

/// Run a non-builtin command through the runtime seam and shape its result.
/// The seam has no stdin channel, so a runtime in the middle of a pipe is told
/// its piped input was dropped rather than silently losing it.
async fn runtime_stage(
    kind: RuntimeKind,
    argv: &[String],
    session: &ShellSession,
    stdin: &str,
) -> StageResult {
    let ctx = ShellExecCtx {
        cwd: session.cwd.clone(),
    };
    let response = run_runtime(kind, argv, &ctx).await;
    let mut note = None;
    if !stdin.is_empty() {
        note = Some(paint_dim(
            "note: piped stdin is not available to runtimes; it was ignored",
        ));
    }
    StageResult {
        stdout: stdout_of(&response),
        note: merge_notes(note, stderr_note(&response)),
        ok: response.ok,
        clear: false,
    }
}

/// The raw stdout a runtime stage contributes to a pipe (or, on the terminal
/// stage, to the screen). Trailing newline trimmed so it sits cleanly between
/// other pipeline output; the next stage's tokenizer/`cat` re-adds structure.
fn stdout_of(response: &ExecResponse) -> String {
    response.stdout.trim_end_matches('\n').to_string()
}

/// The user-facing note for a finished process: stderr in red and a dim
/// `[exit N]` on failure. `None` for a clean run with no stderr. Never piped.
fn stderr_note(response: &ExecResponse) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if !response.stderr.is_empty() {
        parts.push(paint_error(response.stderr.trim_end()));
    }
    if !response.ok {
        parts.push(paint_dim(&format!("[exit {}]", response.exit_code)));
    }
    (!parts.is_empty()).then(|| parts.join("\n"))
}

/// Combine two optional notes (e.g. a stdin warning and a process's stderr).
fn merge_notes(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(a), Some(b)) => Some(format!("{a}\n{b}")),
        (Some(a), None) | (None, Some(a)) => Some(a),
        (None, None) => None,
    }
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
        // Errors render red, like every other shell error.
        assert_eq!(
            outcome,
            ShellOutcome::Output(paint_error("command not found: frobnicate (type help)"))
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
    fn exec_responses_split_into_pipeable_stdout_and_a_note() {
        let ok = ExecResponse {
            ok: true,
            stdout: "hi\n".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
        // stdout pipes onward with no trailing newline and no note on success.
        assert_eq!(stdout_of(&ok), "hi");
        assert_eq!(stderr_note(&ok), None);

        let failed = ExecResponse::failure(127, "no such runtime");
        // A failure carries its stderr and exit code as a note, not as stdout.
        assert_eq!(stdout_of(&failed), "");
        let note = stderr_note(&failed).expect("note");
        assert!(note.contains("no such runtime"));
        assert!(note.contains("[exit 127]"));
    }

    #[test]
    fn merge_notes_combines_present_notes() {
        assert_eq!(merge_notes(None, None), None);
        assert_eq!(merge_notes(Some("a".into()), None), Some("a".to_string()));
        assert_eq!(merge_notes(None, Some("b".into())), Some("b".to_string()));
        assert_eq!(
            merge_notes(Some("a".into()), Some("b".into())),
            Some("a\nb".to_string())
        );
    }

    // ---- end-to-end pipeline plumbing over an in-memory filesystem ----------

    /// Run `line` against a fresh in-memory workspace seeded with `entries`
    /// (`(path, content)`, or content `"dir"` for an explicit directory) and
    /// return the printed text. `cwd` sets the starting directory.
    fn run(cwd: &str, entries: &[(&str, &str)], line: &str) -> String {
        let fs = ShellFs::in_memory(entries);
        let mut session = ShellSession {
            cwd: cwd.to_string(),
        };
        match pollster::block_on(run_line(&mut session, &fs, line)) {
            ShellOutcome::Output(text) => text,
            ShellOutcome::Clear => "<clear>".to_string(),
        }
    }

    /// Like [`run`], but also hands back the resulting file contents so a
    /// redirection's effect on the filesystem can be asserted.
    fn run_then_read(entries: &[(&str, &str)], line: &str, path: &str) -> (String, Option<String>) {
        let fs = ShellFs::in_memory(entries);
        let mut session = ShellSession::default();
        let printed = match pollster::block_on(run_line(&mut session, &fs, line)) {
            ShellOutcome::Output(text) => text,
            ShellOutcome::Clear => "<clear>".to_string(),
        };
        let content = pollster::block_on(fs.read_file(path)).expect("read");
        (printed, content)
    }

    #[test]
    fn pipe_feeds_stdout_into_the_next_stage_stdin() {
        // `echo` produces text; `cat` (no args) re-emits its stdin.
        assert_eq!(run("", &[], "echo hello | cat"), "hello");
        // A three-stage pipe: only the terminal stage reaches the screen.
        assert_eq!(run("", &[], "echo a | cat | cat"), "a");
    }

    #[test]
    fn cat_reads_a_piped_file_through_stdin() {
        let entries = [("note.txt", "from file\n")];
        // `cat note.txt | cat` pipes the file body (newline and all, since
        // builtin output is not trimmed mid-pipe) through a stdin-reading cat.
        assert_eq!(run("", &entries, "cat note.txt | cat"), "from file\n");
    }

    #[test]
    fn output_redirect_truncates_and_writes_a_file() {
        let (printed, content) = run_then_read(&[], "echo hello > out.txt", "out.txt");
        assert!(printed.is_empty(), "redirected output is not echoed");
        assert_eq!(content, Some("hello".to_string()));
    }

    #[test]
    fn append_redirect_adds_to_an_existing_file() {
        let entries = [("log.txt", "first\n")];
        let (_, content) = run_then_read(&entries, "echo second >> log.txt", "log.txt");
        assert_eq!(content, Some("first\nsecond".to_string()));
    }

    #[test]
    fn append_redirect_creates_the_file_when_absent() {
        let (_, content) = run_then_read(&[], "echo only >> fresh.txt", "fresh.txt");
        assert_eq!(content, Some("only".to_string()));
    }

    #[test]
    fn append_is_byte_exact_with_no_synthesised_separator() {
        // The existing file has no trailing newline; `>>` must append verbatim,
        // never inserting a `\n` between the old and new bytes.
        let entries = [("buf", "abc")];
        let (_, content) = run_then_read(&entries, "echo def >> buf", "buf");
        assert_eq!(content, Some("abcdef".to_string()));
    }

    #[test]
    fn input_redirect_seeds_stdin_from_a_file() {
        let entries = [("data.txt", "payload")];
        assert_eq!(run("", &entries, "cat < data.txt"), "payload");
    }

    #[test]
    fn input_redirect_reports_a_missing_file() {
        let out = run("", &[], "cat < nope.txt");
        assert!(out.contains("no such file"), "got: {out}");
    }

    #[test]
    fn pipe_and_redirect_compose() {
        // Pipe through a stdin-cat, then divert the result to a file.
        let entries = [("seed.txt", "carried")];
        let (printed, content) =
            run_then_read(&entries, "cat seed.txt | cat > copy.txt", "copy.txt");
        assert!(printed.is_empty());
        assert_eq!(content, Some("carried".to_string()));
    }

    #[test]
    fn glob_expands_arguments_against_the_listing() {
        let entries = [("a.txt", "A\n"), ("b.txt", "B\n"), ("c.md", "C\n")];
        // `cat *.txt` expands to both .txt files (sorted) and concatenates them.
        assert_eq!(run("", &entries, "cat *.txt"), "A\nB\n");
    }

    #[test]
    fn glob_expands_across_a_directory_segment() {
        let entries = [("src/x.py", "x"), ("src/y.py", "y"), ("src/z.js", "z")];
        // `ls src/*.py` resolves to the two python files (shown by base path).
        let out = run("", &entries, "ls src/*.py");
        assert!(out.contains("x.py"), "got: {out}");
        assert!(out.contains("y.py"), "got: {out}");
        assert!(!out.contains("z.js"), "got: {out}");
    }

    #[test]
    fn glob_with_no_match_is_passed_through_literally() {
        // No `.zip` files: the literal `*.zip` reaches `cat`, which reports it.
        let entries = [("a.txt", "A")];
        let out = run("", &entries, "cat *.zip");
        assert!(out.contains("*.zip"), "got: {out}");
        assert!(out.contains("no such file"), "got: {out}");
    }

    #[test]
    fn command_name_is_never_glob_expanded() {
        // `*` as the command must not expand to a filename; it's "not found".
        let entries = [("ls", "x")];
        let out = run("", &entries, "* foo");
        assert!(out.contains("command not found"), "got: {out}");
    }

    #[test]
    fn redirect_into_a_directory_is_rejected() {
        let entries = [("dir", "dir")];
        let out = run("", &entries, "echo x > dir");
        assert!(out.contains("is a directory"), "got: {out}");
    }

    #[test]
    fn a_failed_stage_halts_the_pipeline() {
        // `cat missing` fails; the downstream `cat` never runs and the error
        // (red) is what surfaces.
        let out = run("", &[], "cat missing.txt | cat");
        assert!(out.contains("no such file"), "got: {out}");
    }

    #[test]
    fn runtime_in_a_pipe_notes_that_stdin_was_dropped() {
        // On the host the python arm fails (no browser), but the stdin-dropped
        // note must still be present — it's about the seam, not the substrate.
        let out = run("", &[], "echo hi | python script.py");
        assert!(out.contains("piped stdin"), "got: {out}");
    }
}
