//! Parts: a small catalogue of parts drawn with made-up values (Settings, the Parts tab).
//!
//! A component is given what it shows, so it can be shown with nothing behind it. This page
//! does that for the parts that have no live source in every build:
//!
//! - **a terminal box** (`TerminalView`): made-up screens (`ui/features/terminal.rs`,
//!   `samples`), with what is typed into each written out underneath as the bytes a program
//!   would read. Nothing is sent anywhere.
//! - **an answer in Markdown** (`Prose`): every kind of block, and each language coloured.
//! - **a long thread** (`SessionThread`): as many made-up turns as asked for, to see that a
//!   long conversation stays quick (`docs/components.md`, "Long threads").
use crate::core::session::{Turn, AGENT, USER};
use crate::ui::features::terminal::samples;
use crate::ui::web::components::{Pane, Prose, SessionThread, TerminalView};
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// What was typed, with the bytes that cannot be seen written as escapes (`\r`, `\x1b[A`).
fn seen(bytes: &str) -> String {
    bytes.chars().map(|c| if c.is_control() { c.escape_default().to_string() } else { c.to_string() }).collect()
}

const SAMPLE: &str = "# An answer\n\nThe sum of the squares of the first **20 primes** is `30007`. It was worked out by a program, *not* from memory, and ~~guessed~~ checked. See [the method](https://en.wikipedia.org/wiki/Prime_number).\n\n## Steps\n\n1. List the primes\n2. Square each\n   - by multiplying\n3. Add them\n\n- [x] ran the program\n- [ ] wrote it up\n\n> A result is only as good as its check.\n\n| stage | took | did |\n| --- | ---: | --- |\n| think | 1.2s | wrote the program |\n| act | 41ms | ran it |\n\n```rust\n/// The sum of the squares.\nfn sum(primes: &[u64]) -> u64 {\n    primes.iter().map(|p| p * p).sum() // 30007\n}\n```\n\n```ts\nconst sum = (primes: number[]) => primes.reduce((a, p) => a + p * p, 0); // 30007\n```\n\n```python\ndef total(primes):\n    \"\"\"The sum of the squares.\"\"\"\n    return sum(p * p for p in primes)  # 30007\n```\n\n```json\n{\"result\": 30007, \"checked\": true, \"by\": \"run_code\"}\n```\n\n```sh\n# run it\nnode sum.mjs \"$HOME/primes.txt\" && echo done\n```\n\n```diff\n--- a/sum.rs\n+++ b/sum.rs\n@@ -1,3 +1,3 @@\n-    primes.iter().sum()\n+    primes.iter().map(|p| p * p).sum()\n```\n\n---\n\nMarkup written by hand is shown as text: <b onclick=\"x\">not bold</b>.\n";

#[component]
pub fn PartsView() -> Element {
    let mut typed = use_signal(|| vec![String::new(); samples().len()]);
    let mut turns = use_signal(|| 0usize);
    let thread: Vec<Turn> = (0..turns())
        .map(|i| if i % 2 == 0 { Turn { who: USER.into(), text: format!("Question {}: what is {} squared?", i / 2 + 1, i / 2 + 1) } } else { Turn { who: AGENT.into(), text: format!("**{}**. It was worked out, not remembered:\n\n```js\n{} * {}\n```\n\n- checked once\n- checked twice", (i / 2 + 1) * (i / 2 + 1), i / 2 + 1, i / 2 + 1) } })
        .collect();
    rsx! {
        div { class: "parts",
            Pane { class: "stack",
                h2 { "A terminal box" }
                p { class: "dim", "Made-up screens. Type into one: what would be sent to its program is written under it. Shift and Tab leaves a terminal." }
                for (i, (name, screen)) in samples().into_iter().enumerate() {
                    section { key: "{name}", class: "parts-term", "aria-label": "{name}",
                        h3 { "{name}" }
                        TerminalView { screen, label: name, on_type: move |bytes: String| typed.write()[i].push_str(&bytes) }
                        p { class: "parts-typed", role: "status", span { class: "dim", "typed: " } code { "{seen(&typed.read()[i])}" } }
                    }
                }
            }
            Pane { class: "stack",
                h2 { "An answer in Markdown" }
                div { class: "lane", Prose { class: "say-text", text: SAMPLE } }
            }
            Pane { class: "stack parts-thread",
                h2 { "A long thread" }
                div { class: "row",
                    for n in [50usize, 500, 2000] {
                        Button { key: "{n}", variant: ButtonVariant::Secondary, size: ButtonSize::Sm, aria_pressed: turns() == n, onclick: move |_| turns.set(n), "{n} turns" }
                    }
                    Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, onclick: move |_| turns.set(0), "None" }
                    span { class: "dim", role: "status", "{turns} made-up turns" }
                }
                if turns() > 0 { SessionThread { turns: thread, agent: "the agent" } }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::features::markdown::{parse, Block};

    #[test]
    fn what_was_typed_is_written_so_it_can_be_seen() {
        assert_eq!(seen("ls\r"), "ls\\r");
        assert_eq!(seen("\x1b[A\x03"), "\\u{1b}[A\\u{3}");
    }

    #[test]
    fn the_sample_answer_has_every_kind_of_block() {
        let blocks = parse(SAMPLE);
        let has = |f: fn(&Block) -> bool| blocks.iter().any(f);
        assert!(has(|b| matches!(b, Block::Heading { .. })) && has(|b| matches!(b, Block::List { start: Some(_), .. })) && has(|b| matches!(b, Block::List { start: None, .. })));
        assert!(has(|b| matches!(b, Block::Quote(_))) && has(|b| matches!(b, Block::Table { .. })) && has(|b| matches!(b, Block::Rule)));
        let langs: Vec<&str> = blocks.iter().filter_map(|b| if let Block::Code { lang, .. } = b { Some(lang.as_str()) } else { None }).collect();
        assert_eq!(langs, ["rust", "ts", "python", "json", "sh", "diff"]);
    }
}
