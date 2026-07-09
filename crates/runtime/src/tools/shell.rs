//! `shell` — run a command line in the in-browser Linux VM (v86) and return
//! its output. The executor is injected (ADR-009): the web host wires it to
//! `window.AskkV86.exec` over the guest serial line; host runs and tests use
//! a scripted `MockShell`. The VM is a sandbox — no host filesystem, no
//! network, no persistence — so the call is `Effect::Pure` (auto-runs, no
//! confirmation gate); a compromised command can only touch the throwaway
//! guest. ponytail: raise to a gated effect if guest networking ever lands.

use std::rc::Rc;

use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
use serde_json::Value;

use crate::state::LocalBoxFuture;

use super::registry::{RegistryError, ToolRegistry};

/// The one-method seam: run a shell command in the guest, get its output.
pub trait ShellExec {
    fn exec<'a>(&'a self, command: &'a str) -> LocalBoxFuture<'a, Result<String, String>>;
}

/// Registers `shell` with the given executor (serial in `web`, mock elsewhere).
pub fn register_shell(
    reg: &mut ToolRegistry,
    exec: Rc<dyn ShellExec>,
) -> Result<(), RegistryError> {
    reg.register(Rc::new(ShellTool::new(exec)))
}

pub struct ShellTool {
    spec: ToolSpec,
    exec: Rc<dyn ShellExec>,
}

impl ShellTool {
    pub fn new(exec: Rc<dyn ShellExec>) -> Self {
        Self {
            spec: ToolSpec {
                name: "shell".into(),
                description: "Run a command line in the sandboxed in-browser \
                              Linux VM and return its combined output. Standard \
                              POSIX tools are available (busybox / Alpine)."
                    .into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The shell command to run, e.g. `uname -a`."
                        }
                    },
                    "required": ["command"]
                }),
                effect: Effect::Pure,
            },
            exec,
        }
    }
}

impl Tool for ShellTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }

    fn call<'a>(&'a self, args: Value, _ctx: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let command = args
                .get("command")
                .or_else(|| args.get("cmd"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let Some(command) = command else {
                return ToolResult::err("shell: missing string field 'command'");
            };
            match self.exec.exec(command).await {
                Ok(out) if out.trim().is_empty() => ToolResult::ok("(no output)"),
                Ok(out) => ToolResult::ok(out.trim_end().to_string()),
                Err(e) => ToolResult::err(format!("shell: {e}")),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::block_on;
    use std::cell::RefCell;

    struct MockShell {
        last: RefCell<String>,
        reply: Result<String, String>,
    }

    impl ShellExec for MockShell {
        fn exec<'a>(&'a self, command: &'a str) -> LocalBoxFuture<'a, Result<String, String>> {
            *self.last.borrow_mut() = command.to_string();
            let reply = self.reply.clone();
            Box::pin(async move { reply })
        }
    }

    fn tool(reply: Result<String, String>) -> (ShellTool, Rc<MockShell>) {
        let mock = Rc::new(MockShell {
            last: RefCell::new(String::new()),
            reply,
        });
        (ShellTool::new(mock.clone()), mock)
    }

    #[test]
    fn runs_command_and_returns_output() {
        block_on(async {
            let (tool, mock) = tool(Ok("Linux localhost 6.18\n".into()));
            let mut ctx = ToolCtx::default();
            let out = tool
                .call(serde_json::json!({"command": "uname -a"}), &mut ctx)
                .await;
            assert!(out.ok);
            assert_eq!(out.content, "Linux localhost 6.18");
            assert_eq!(*mock.last.borrow(), "uname -a");
        });
    }

    #[test]
    fn missing_command_is_an_error_not_a_call() {
        block_on(async {
            let (tool, mock) = tool(Ok("unused".into()));
            let mut ctx = ToolCtx::default();
            let out = tool.call(serde_json::json!({}), &mut ctx).await;
            assert!(!out.ok);
            assert!(mock.last.borrow().is_empty());
        });
    }

    #[test]
    fn empty_output_reports_no_output() {
        block_on(async {
            let (tool, _) = tool(Ok("  \n".into()));
            let mut ctx = ToolCtx::default();
            let out = tool
                .call(serde_json::json!({"command": "true"}), &mut ctx)
                .await;
            assert!(out.ok);
            assert_eq!(out.content, "(no output)");
        });
    }
}
