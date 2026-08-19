//! ONE OPEN FILE: what it is called, what is in it, and — when it is a document
//! rather than a record — the one control that writes it back. Split from
//! `files.rs`, which owns the folder and its watcher, so both hold the 200-line
//! rule (I12).
//!
//! A LOG IS NOT A DOCUMENT (R11-12). Pressing a process row opens
//! `.harness/proc/<name>/log` — the captured output of something that may still
//! be printing into it — and it opened in a live `<textarea>` under `Save to
//! the workspace`, so a keystroke and a press would overwrite a running
//! process's record with whatever the box happened to hold. It is a machine
//! record, it is the evidence the Processes pane points at, and nothing in this
//! product needs to type into it. It opens read-only, and says so.

use dioxus::prelude::*;

use crate::ui::Button;

/// Whether this path is a machine record rather than a document. The process
/// folder is `core::process::DIR`'s shape and this is the one place the UI has
/// to know it — the same string `procrows.rs` builds a log's path from.
pub(crate) fn is_record(path: &str) -> bool {
    let p = path.trim_start_matches("./");
    p.starts_with(".harness/proc/") || p.contains("/.harness/proc/")
}

/// The editor, in its two modes. `save` is called with the path and the bytes.
#[component]
pub(crate) fn FileEdit(
    /// The open file's path, as the listing named it.
    open: String,
    /// What the box holds — the draft when there is one, the file's own bytes
    /// as the listing last read them otherwise.
    text: String,
    dirty: bool,
    on_input: EventHandler<String>,
    on_discard: EventHandler<()>,
    on_save: EventHandler<(String, String)>,
) -> Element {
    let record = is_record(&open);
    let (verb, aria) = match record {
        true => ("Reading", format!("Reading {open}")),
        false => ("Editing", format!("Editing {open}")),
    };
    rsx! {
        div { class: "file-edit",
            // WHICH FILE, VISIBLY (R5-9). The only thing naming the file was
            // `aria-label="Editing colors.md"`, which nobody is shown; a critic
            // overwrote notes.md and learned which file it was afterwards.
            h3 { class: "file-open",
                span { class: "file-open-what", "{verb}" }
                "{open}"
            }
            textarea {
                id: "file-editor",
                class: "file-editor",
                aria_label: "{aria}",
                spellcheck: "false",
                readonly: record,
                value: "{text}",
                oninput: move |e: FormEvent| on_input.call(e.value()),
            }
            div { class: "file-actions",
                if record {
                    p { class: "file-state", role: "status",
                        "Read-only — this is a process's captured output, written by whatever \
                         is running, not a file to edit."
                    }
                } else {
                    // A BUTTON IS A VERB (R5-15). At rest this read `Saved` and
                    // was disabled — a primary action whose label was a
                    // condition, so the control that commits a person's own
                    // writing described the past instead of the act. One label,
                    // always; the state is the line beside it.
                    Button {
                        variant: "primary",
                        disabled: !dirty,
                        onclick: {
                            let (path, body) = (open.clone(), text.clone());
                            move |_| on_save.call((path.clone(), body.clone()))
                        },
                        "Save to the folder"
                    }
                    if dirty {
                        Button {
                            variant: "secondary",
                            onclick: move |_| on_discard.call(()),
                            "Discard"
                        }
                        p { class: "file-state dirty", role: "status", "Unsaved changes" }
                    } else {
                        // THERE IS NO DISK (26 walk). This read "Saved — this is
                        // what is on disk", which was true of the engine that
                        // kept files and was removed on 2026-08-18. The one
                        // screen where a person commits their own writing may
                        // not tell them it is safe: the save landed, and where
                        // it landed forgets. Stated once, plainly, and no
                        // louder than the rest of the pane.
                        p { class: "file-state", role: "status",
                            "Saved to the folder — it is in this page's Linux, and goes when \
                             the page reloads."
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_process_log_is_a_record_and_a_note_is_not() {
        assert!(super::is_record(".harness/proc/ticker/log"));
        assert!(super::is_record("./.harness/proc/ticker/log"));
        assert!(super::is_record("/root/spaces/research/.harness/proc/web/log"));
        assert!(!super::is_record("notes.md"));
        assert!(!super::is_record("artifacts/report.html"));
    }
}
