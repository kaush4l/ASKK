//! A terminal, drawn: the screen the service worked out, and typing sent back as keys.
//!
//! [`TerminalView`] is given a [`Screen`] (`core/screen.rs`) and draws it as a grid of one
//! width of letter: every row, each run of text in its colours, the cursor, and how the
//! program ended once it has. It asks for nothing. What is typed goes up through `on_type`
//! as the bytes a program reads (`ui/features/terminal.rs`); sending them to the service is
//! the view's to do.
//!
//! The 16 base colours are tokens, so they suit light and dark. The other colours of the 256
//! and `#rrggbb` are the program's own choice and are drawn exactly as given: those are the
//! one place a look is written on the element itself.
//!
//! The keyboard: a field under the screen holds the focus, so a phone raises its keyboard
//! and an input method can compose; the screen is that field's label. Shift+Tab leaves the terminal; every other key
//! goes to the program, Tab and Escape too.
use crate::core::screen::Screen;
use crate::ui::features::terminal::{keys, rows, standing, Cell, Ink, Typed};
use dioxus::prelude::*;

/// The names of a cell's looks, and the exact colours it was given (empty when it has none).
fn look(c: &Cell) -> (String, String) {
    let mut names = vec!["term-cell".to_string()];
    let mut exact = String::new();
    for (ink, role, property) in [(&c.fg, "fg", "color"), (&c.bg, "bg", "background-color")] {
        match ink {
            Ink::Own => {}
            Ink::Other => names.push(format!("t-{role}-other")),
            Ink::Base(n) => names.push(format!("t-{role}-{n}")),
            Ink::Exact(hex) => exact.push_str(&format!("{property}:{hex};")),
        }
    }
    for (on, name) in [(c.bold, "t-bold"), (c.dim, "t-dim"), (c.italic, "t-italic"), (c.underline, "t-underline"), (c.cursor, "t-cursor")] {
        if on {
            names.push(name.to_string());
        }
    }
    (names.join(" "), exact)
}

/// One terminal. `label` names it for a screen reader (the box's title). `on_type`: the bytes
/// to send to the program, as the person types.
#[component]
pub fn TerminalView(screen: Screen, #[props(default)] label: String, on_type: EventHandler<String>) -> Element {
    let id = use_hook(|| dioxus::core::current_scope_id().0);
    let mut composing = use_signal(|| false);
    let grid = rows(&screen);
    let dead = !screen.alive;
    let name = if label.is_empty() { "Terminal".to_string() } else { format!("Terminal: {label}") };
    // Text that came through the field (a phone's keyboard, an input method, a paste): send
    // it, and empty the field for the next.
    let send_field = move |text: String| {
        if !text.is_empty() {
            on_type.call(text);
        }
        document::eval(&format!("const f = document.getElementById('term-keys-{id}'); if (f) f.value = '';"));
    };
    rsx! {
        div { class: if dead { "term is-dead" } else { "term" }, "data-cols": "{screen.cols}", "data-rows": "{screen.rows}",
            // The screen as text, for reading and for a screen reader: each row is a line. It
            // is the field's label, so a press or a touch anywhere on it gives the field the
            // focus (and a phone raises its keyboard) with no script in between.
            label { class: "term-screen", r#for: "term-keys-{id}", "aria-label": "{name}. {screen.text()}",
                for (r, cells) in grid.into_iter().enumerate() {
                    div { key: "{r}", class: "term-row",
                        for (i, c) in cells.iter().enumerate() {
                            {
                                let (names, exact) = look(c);
                                rsx! { span { key: "{i}", class: "{names}", style: "{exact}", "{c.text}" } }
                            }
                        }
                        // An empty row still has a line's height.
                        if cells.is_empty() { "\u{a0}" }
                    }
                }
            }
            if !dead {
                textarea { class: "term-keys", id: "term-keys-{id}", "aria-label": "{name}. Type here; Shift and Tab leaves it.", rows: "1",
                    "autocomplete": "off", "autocapitalize": "off", "spellcheck": "false", "autocorrect": "off",
                    onkeydown: move |e: KeyboardEvent| {
                        if e.is_composing() {
                            return;
                        }
                        let m = e.modifiers();
                        let typed = Typed { key: e.key().to_string(), ctrl: m.ctrl(), alt: m.alt(), meta: m.meta(), shift: m.shift() };
                        if let Some(bytes) = keys(&typed) {
                            e.prevent_default();
                            on_type.call(bytes);
                        }
                    },
                    oncompositionstart: move |_| composing.set(true),
                    oncompositionend: move |e: CompositionEvent| {
                        composing.set(false);
                        send_field(e.data().data());
                    },
                    oninput: move |e: FormEvent| {
                        if !composing() {
                            send_field(e.value());
                        }
                    },
                }
            }
            p { class: "term-foot", role: "status",
                span { class: if dead { "term-state is-dead" } else { "term-state" }, if dead { "■ " } else { "● " } "{standing(&screen)}" }
                span { class: "term-size", "{screen.cols}×{screen.rows}" }
            }
        }
    }
}
