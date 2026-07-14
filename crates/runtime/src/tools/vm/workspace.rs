//! Workspace file tools over the same VM shell seam (`ShellExec`) the `shell`
//! tool uses. Writing a file to a raw serial TTY by hand (heredocs, quoting,
//! `$`/backtick escaping) is where LLMs slip; these tools assemble the shell
//! command on the RUST side — a QUOTED heredoc (`<<'DELIM'`, no expansion) with
//! a delimiter guaranteed absent from the content — so `write_file` is exact
//! and byte-safe. read/list/edit round out the set. Everything runs in the
//! sandboxed guest, so all four are `Effect::Pure`.

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::{json, Value};

use crate::state::LocalBoxFuture;

use super::shell::ShellExec;
use crate::tools::registry::{RegistryError, ToolRegistry};

/// Register the workspace file tools with the guest shell executor.
pub fn register_workspace(
    reg: &mut ToolRegistry,
    exec: Rc<dyn ShellExec>,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(FsTool::new(FsOp::Write, exec.clone())))?;
    reg.register(Rc::new(FsTool::new(FsOp::Read, exec.clone())))?;
    reg.register(Rc::new(FsTool::new(FsOp::List, exec.clone())))?;
    reg.register(Rc::new(FsTool::new(FsOp::Edit, exec)))
}

#[derive(Clone, Copy)]
enum FsOp {
    Write,
    Read,
    List,
    Edit,
}

/// A heredoc delimiter that does not appear as a line in `content`.
fn safe_delimiter(content: &str) -> String {
    let mut n = 0u32;
    loop {
        let delim = format!("ASKK_EOF_{n}");
        if !content.lines().any(|l| l.trim() == delim) {
            return delim;
        }
        n += 1;
    }
}

/// Single-quote a path for `sh` (wrap in quotes, escape embedded quotes).
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

struct FsTool {
    spec: ToolSpec,
    op: FsOp,
    exec: Rc<dyn ShellExec>,
}

impl FsTool {
    fn new(op: FsOp, exec: Rc<dyn ShellExec>) -> Self {
        let (name, description, schema) = match op {
            FsOp::Write => (
                "write_file",
                "Create or overwrite a file in the VM with exact contents \
                 (parent directories are created).",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute or project-relative file path." },
                        "content": { "type": "string", "description": "The full file contents." }
                    },
                    "required": ["path", "content"]
                }),
            ),
            FsOp::Read => (
                "read_file",
                "Read a file from the VM and return its contents.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path to read." }
                    },
                    "required": ["path"]
                }),
            ),
            FsOp::List => (
                "list_files",
                "List a directory in the VM (long form). Defaults to the \
                 current project directory.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory to list (default '.')." }
                    }
                }),
            ),
            FsOp::Edit => (
                "edit_file",
                "Replace the FIRST occurrence of an exact substring in a file. \
                 Fails if the substring is absent (so a bad edit is caught).",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File to edit." },
                        "find": { "type": "string", "description": "Exact text to replace (must occur)." },
                        "replace": { "type": "string", "description": "Replacement text." }
                    },
                    "required": ["path", "find", "replace"]
                }),
            ),
        };
        Self {
            spec: ToolSpec {
                name: name.into(),
                description: description.into(),
                input_schema: schema,
                effect: Effect::Pure,
            },
            op,
            exec,
        }
    }
}

/// Build the shell command for this op. Pure — unit-tested without a VM.
fn command_for(op: FsOp, args: &Value) -> Result<String, String> {
    let str_arg = |k: &str| args.get(k).and_then(Value::as_str);
    match op {
        FsOp::Write => {
            let path = str_arg("path").ok_or("write_file: missing 'path'")?;
            let content = str_arg("content").ok_or("write_file: missing 'content'")?;
            let delim = safe_delimiter(content);
            let dir = "mkdir -p \"$(dirname ".to_string() + &shell_quote(path) + ")\"";
            // Quoted heredoc: the body is literal, no expansion. A trailing
            // newline keeps the closing delimiter on its own line.
            Ok(format!(
                "{dir} && cat > {} <<'{delim}'\n{content}\n{delim}\nprintf 'wrote %s\\n' {}",
                shell_quote(path),
                shell_quote(path)
            ))
        }
        FsOp::Read => {
            let path = str_arg("path").ok_or("read_file: missing 'path'")?;
            Ok(format!("cat {}", shell_quote(path)))
        }
        FsOp::List => {
            let path = str_arg("path").unwrap_or(".");
            Ok(format!("ls -la {}", shell_quote(path)))
        }
        FsOp::Edit => {
            let path = str_arg("path").ok_or("edit_file: missing 'path'")?;
            let find = str_arg("find").ok_or("edit_file: missing 'find'")?;
            let replace = str_arg("replace").ok_or("edit_file: missing 'replace'")?;
            if find.is_empty() {
                return Err("edit_file: 'find' must not be empty".into());
            }
            // awk with plain-string (not regex) first-match replacement, driven
            // by env vars so no metacharacter of find/replace reaches the shell.
            let script = r#"BEGIN{f=ENVIRON["ASKK_FIND"];r=ENVIRON["ASKK_REPL"];done=0}
{ if(!done){i=index($0,f); if(i>0){$0=substr($0,1,i-1) r substr($0,i+length(f)); done=1}} print }
END{ if(!done){ exit 3 } }"#;
            let q = |s: &str| shell_quote(s);
            Ok(format!(
                "ASKK_FIND={find} ASKK_REPL={replace} awk {script} {path} > {path}.tmp && \
                 mv {path}.tmp {path} && printf 'edited %s\\n' {path} || \
                 {{ rm -f {path}.tmp; echo 'edit_file: text not found'; false; }}",
                find = q(find),
                replace = q(replace),
                script = q(script),
                path = q(path)
            ))
        }
    }
}

impl Tool for FsTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let command = match command_for(self.op, &args) {
                Ok(c) => c,
                Err(e) => return ToolResult::err(e),
            };
            match self.exec.exec(&command).await {
                Ok(out) if out.trim().is_empty() => ToolResult::ok("(no output)"),
                Ok(out) => ToolResult::ok(out.trim_end().to_string()),
                Err(e) => ToolResult::err(format!("{}: {e}", self.spec.name)),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_uses_a_quoted_heredoc_with_a_safe_delimiter() {
        let cmd = command_for(
            FsOp::Write,
            &json!({"path": "/root/project/main.sh", "content": "echo hi\n$HOME stays literal"}),
        )
        .unwrap();
        assert!(cmd.contains("<<'ASKK_EOF_0'"));
        assert!(cmd.contains("$HOME stays literal")); // no expansion, verbatim
        assert!(cmd.contains("mkdir -p"));
    }

    #[test]
    fn write_bumps_delimiter_when_content_collides() {
        let cmd = command_for(
            FsOp::Write,
            &json!({"path": "f", "content": "line\nASKK_EOF_0\nmore"}),
        )
        .unwrap();
        assert!(cmd.contains("<<'ASKK_EOF_1'"));
    }

    #[test]
    fn read_and_list_quote_the_path() {
        let read = command_for(FsOp::Read, &json!({"path": "a b.txt"})).unwrap();
        assert_eq!(read, "cat 'a b.txt'");
        let list = command_for(FsOp::List, &json!({})).unwrap();
        assert_eq!(list, "ls -la '.'");
    }

    #[test]
    fn edit_passes_find_replace_via_env_not_shell() {
        let cmd = command_for(
            FsOp::Edit,
            &json!({"path": "f", "find": "a$b", "replace": "c`d"}),
        )
        .unwrap();
        assert!(cmd.contains("ASKK_FIND='a$b'"));
        assert!(cmd.contains("ASKK_REPL='c`d'"));
        assert!(cmd.contains("text not found")); // failure branch present
    }

    #[test]
    fn missing_required_fields_error() {
        assert!(command_for(FsOp::Write, &json!({"path": "f"})).is_err());
        assert!(command_for(FsOp::Edit, &json!({"path": "f", "find": ""})).is_err());
    }
}
