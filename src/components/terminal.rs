//! xterm.js terminal pane.
//!
//! Bridges the bundled xterm.js asset (`assets/xterm_term.js`, built from
//! `scripts/xterm-term/` — see its package.json) into the Dioxus UI, mirroring
//! the [`super::code_editor`] pattern: the bundle exposes a small
//! `window.AskkTerm` API; this component mounts a terminal into a host `div`
//! and keeps one persistent `document::eval` channel open. JS pushes entered
//! lines and Ctrl-C interrupts up via `dioxus.send`; Rust runs each line
//! through the virtual shell ([`crate::shell`]) and pushes output, prompts and
//! clears back down via [`document::Eval::send`].

use crate::shell::{ShellFs, ShellOutcome, ShellSession, display_path, run_line};
use dioxus::prelude::*;
use serde::Deserialize;

const XTERM_BUNDLE: Asset = asset!("/assets/xterm_term.js");

/// An event reported by the mounted terminal.
#[derive(Clone, PartialEq, Deserialize)]
pub struct TermEvent {
    /// `true` once, right after the terminal finishes mounting. Rust responds
    /// with the banner and the first prompt (and drains queued injections).
    #[serde(default)]
    pub ready: bool,
    /// A line the user submitted with Enter.
    #[serde(default)]
    pub line: Option<String>,
    /// `true` when the user pressed Ctrl-C while a command was in flight.
    #[serde(default)]
    pub interrupt: bool,
}

/// Output the workspace page injects into the terminal from outside the shell
/// (e.g. the editor's ▶ Run button). Queued until the terminal is ready, so a
/// just-opened panel never drops output.
#[derive(Clone, Debug, PartialEq)]
pub enum TermInject {
    /// Print this text (a trailing newline is added by the bundle if missing).
    Write(String),
    /// Clear the screen and scrollback.
    Clear,
}

/// Glue executed via `document::eval`. Waits for the bundle global and the
/// host element (the `<script>` may still be loading when this runs), mounts
/// the terminal, then services both directions of the channel until told to
/// close. Same lifecycle scheme as the CodeMirror glue, including the
/// token-guarded teardown against remount races.
const TERM_GLUE: &str = r#"
const HOST = "askk-term-host";
while (!(window.AskkTerm && document.getElementById(HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const token = window.AskkTerm.mount(HOST, {
    onLine: (line) => dioxus.send({ line }),
    onInterrupt: () => dioxus.send({ interrupt: true }),
});
dioxus.send({ ready: true });
for (;;) {
    const msg = await dioxus.recv();
    if (!msg || msg.cmd === "close") break;
    if (msg.cmd === "write") window.AskkTerm.write(HOST, msg.text);
    if (msg.cmd === "prompt") window.AskkTerm.setPrompt(HOST, msg.text);
    if (msg.cmd === "clear") window.AskkTerm.clear(HOST);
}
// Token-guarded: if a newer mount already replaced this terminal (remount
// race), this teardown is stale and must not destroy the new instance.
window.AskkTerm.destroy(HOST, token);
"#;

fn term_send(controller: &Signal<Option<document::Eval>>, msg: serde_json::Value) {
    if let Some(eval) = controller.peek().as_ref() {
        let _ = eval.send(msg);
    }
}

/// Print `text` in the terminal (ANSI allowed, `\n` newlines).
fn term_write(controller: &Signal<Option<document::Eval>>, text: &str) {
    term_send(
        controller,
        serde_json::json!({ "cmd": "write", "text": text }),
    );
}

/// Print a fresh prompt and unlock input.
fn term_prompt(controller: &Signal<Option<document::Eval>>, prompt: &str) {
    term_send(
        controller,
        serde_json::json!({ "cmd": "prompt", "text": prompt }),
    );
}

/// Wipe the screen and scrollback.
fn term_clear(controller: &Signal<Option<document::Eval>>) {
    term_send(controller, serde_json::json!({ "cmd": "clear" }));
}

/// The shell prompt for `cwd`: a coloured `askk /path $ `.
fn prompt_for(cwd: &str) -> String {
    format!(
        "\u{1b}[38;5;141maskk\u{1b}[0m \u{1b}[38;5;75m{}\u{1b}[0m $ ",
        display_path(cwd)
    )
}

/// The interactive shell terminal. `cwd` is owned by the parent so the working
/// directory survives panel tab switches; `inject` is a queue of outside
/// output (drained once the terminal is ready).
#[component]
pub fn Terminal(
    mut cwd: Signal<String>,
    mut inject: Signal<Vec<TermInject>>,
    on_fs_change: EventHandler<()>,
) -> Element {
    let mut controller = use_signal(|| Option::<document::Eval>::None);
    let mut ready = use_signal(|| false);
    // Cancellation generation. Ctrl-C bumps it; a finished command whose
    // captured generation no longer matches discards its result instead of
    // printing. The command future still runs to completion in the background,
    // so a runtime it started (e.g. the run_js worker) is terminated by its
    // own hard timeout rather than leaked mid-await.
    let mut run_gen = use_signal(|| 0u64);

    // Drain injected output once the terminal is ready (and on later pushes).
    use_effect(move || {
        if !ready() {
            return;
        }
        let pending = inject.read().clone();
        if pending.is_empty() {
            return;
        }
        for item in &pending {
            match item {
                TermInject::Write(text) => term_write(&controller, text),
                TermInject::Clear => term_clear(&controller),
            }
        }
        inject.set(Vec::new());
    });

    // Tell the JS side to stop its receive loop and tear the terminal down
    // when this pane unmounts (in-flight command tasks end with the scope).
    use_drop(move || {
        if let Some(eval) = controller.peek().as_ref() {
            let _ = eval.send(serde_json::json!({ "cmd": "close" }));
        }
        controller.set(None);
    });

    let mut handle_event = move |event: TermEvent| {
        if event.ready {
            term_write(
                &controller,
                "ASKK shell — in-browser workspace terminal. Type 'help'.\n",
            );
            term_prompt(&controller, &prompt_for(&cwd.peek()));
            ready.set(true);
            return;
        }
        if event.interrupt {
            // Cancel the in-flight command: its result is discarded below.
            run_gen.with_mut(|generation| *generation += 1);
            term_write(&controller, "^C\n");
            term_prompt(&controller, &prompt_for(&cwd.peek()));
            return;
        }
        let Some(line) = event.line else {
            return;
        };
        run_gen.with_mut(|generation| *generation += 1);
        let generation = *run_gen.peek();
        let start_cwd = cwd.peek().clone();
        spawn(async move {
            let fs = ShellFs::new();
            let mut session = ShellSession { cwd: start_cwd };
            let outcome = run_line(&mut session, &fs, &line).await;
            if *run_gen.peek() != generation {
                // Cancelled by Ctrl-C: the interrupt handler already printed
                // ^C and a fresh prompt — drop this result.
                return;
            }
            cwd.set(session.cwd);
            match outcome {
                ShellOutcome::Output(text) => {
                    if !text.is_empty() {
                        let text = if text.ends_with('\n') {
                            text
                        } else {
                            format!("{text}\n")
                        };
                        term_write(&controller, &text);
                    }
                }
                ShellOutcome::Clear => term_clear(&controller),
            }
            term_prompt(&controller, &prompt_for(&cwd.peek()));
            // The command may have touched files; let the page refresh its
            // explorer tree.
            on_fs_change.call(());
        });
    };

    rsx! {
        document::Script { src: XTERM_BUNDLE }
        div {
            // Shared with TERM_GLUE and the AskkTerm terminal registry.
            id: "askk-term-host",
            class: "ide-term-host",
            onmounted: move |_| {
                let eval = document::eval(TERM_GLUE);
                controller.set(Some(eval));
                spawn(async move {
                    let mut eval = eval;
                    while let Ok(event) = eval.recv::<TermEvent>().await {
                        handle_event(event);
                    }
                });
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_includes_the_display_path() {
        let prompt = prompt_for("");
        assert!(prompt.contains("askk"));
        assert!(prompt.contains("/\u{1b}[0m $ "));
        assert!(prompt_for("src/lib").contains("/src/lib"));
    }
}
