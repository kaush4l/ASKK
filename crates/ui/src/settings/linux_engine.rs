//! WHICH Linux this page runs — a STATEMENT, not a setting — and the one thing
//! the deleted engine left behind in this browser.
//!
//! It was a select with two options — a third party's runtime or ours — and an
//! armed reload to apply the change. There is one engine now: the image this
//! project builds and serves itself. A select with one option is not a choice,
//! so the control is gone, and with it the saved-versus-running status line
//! and the reload that applied a switch. The stored `askk.engine` bit is gone
//! too, but deleting the code that wrote it does not delete it out of anyone's
//! browser: `adapters_web::drop_engine_setting` removes it on page load, and
//! is called from `main.rs` so a person who never opens Settings still gets it.
//!
//! WHAT DOES NOT GO IS THE SENTENCE ABOUT FILES. The picker's other job was to
//! tell a reader, before they trusted this thing with their work, whether what
//! they wrote survived a reload — and one option answered yes. Nothing answers
//! yes any more. Dropping the warning along with the control that carried it
//! would leave the product quieter about a promise it stopped keeping, so the
//! fact stays, in the place a reader already went to look for it, and it is
//! unconditional: no engine to switch to, no "unless you choose the other one".
//!
//! AND THE FOLDER THAT WAS ALREADY THERE (I11). The deleted engine kept every
//! write in an IndexedDB called `askk-workspace`. Nothing in this build can
//! read it; leaving it unmentioned would be a person's files disappearing with
//! no message, which is the failure I11 names. So the card asks the browser
//! whether that database is still there and, if it is, says so and offers to
//! remove it. This build does not remove it on its own — see
//! `adapters_web/src/leftovers.rs` for why that is a press and not a
//! migration.
//!
//! Otherwise it is COPY — no stored bit, no branch, no reload. The panes that
//! report on real files read `WorkspacePort::durable` through the core's own
//! projections; this card says the same thing in the place the choice used to
//! be.

use adapters_web::{Leftover, GUEST_MEMORY};
use dioxus::prelude::*;

use crate::ui::{Button, Card};

#[component]
pub fn LinuxEngine() -> Element {
    // `Unknown` until the browser answers, and `Unknown` renders nothing: a
    // card that flashed "your old folder is gone" for one frame would be
    // asserting the one thing it must never guess (I15).
    let mut found = use_signal(|| Leftover::Unknown);
    use_future(move || async move {
        found.set(adapters_web::workspace_leftover().await);
    });
    let mut removing = use_signal(|| false);
    // Another tab is holding the database open. NOT a failure and not an end
    // state: the browser finishes the delete by itself the moment that tab
    // closes, so the button keeps waiting and this only says why.
    let mut blocked = use_signal(|| false);
    // The browser refused outright. That IS an end state, and it used to be
    // rendered as nothing at all — the button simply came back.
    let mut failed = use_signal(|| false);

    rsx! {
        Card { title: "Linux engine", aria_label: "Linux engine", variant: "flat reading",
            p { class: "note",
                "The agent's shell runs in a Linux inside this tab: an Alpine container built \
                 with container2wasm, served by this site. Nothing about it is fetched from \
                 anybody else's servers, and there is no second engine to pick — that is the \
                 trade this product makes, and it pays for it in speed."
            }
            // THE ONE FACT THAT DECIDES WHETHER YOU CAN TRUST IT WITH YOUR
            // WORK, on its own line, in the one colour that means "this costs
            // you something" (R10-7).
            p { class: "warn",
                // The opening clause is `adapters_web::GUEST_MEMORY` verbatim, not a
                // second spelling of it: this is the sentence the model reads about
                // the same folder, and `tests/told.rs` fails if the two drift (I16).
                "It {GUEST_MEMORY}: everything written in this Linux is lost when the \
                 page reloads, including anything an agent is part-way through. There is no \
                 setting that changes that, so copy out anything you need to keep."
            }
            if found() == Leftover::Present {
                p { class: "warn",
                    "This browser still holds a database called askk-workspace, written by the \
                     engine this build removed. If you used this page before, your files from \
                     then are in there. Nothing here can open it — reading it needed the engine \
                     that wrote it — so it is taking up storage and giving nothing back. It is \
                     left alone until you say otherwise."
                }
                if blocked() {
                    p { class: "warn",
                        "Another tab still has that database open — almost certainly this site \
                         running in a window you left behind. The delete has not been cancelled \
                         and nothing has been lost: the browser is holding it until that tab \
                         lets go, and it finishes on its own the moment one does. Close the \
                         other tabs on this site and this will complete by itself."
                    }
                }
                if failed() {
                    p { class: "warn",
                        "The browser refused to delete it. Nothing was removed, so the database \
                         and everything in it are exactly as they were. Trying again is safe."
                    }
                }
                Button {
                    variant: "danger",
                    disabled: removing(),
                    onclick: move |_| async move {
                        // The rendered button carries the real `disabled`
                        // attribute, so the browser drops a second press —
                        // but the press and the first `await` are a frame
                        // apart, so the guard closes that frame too.
                        if removing() {
                            return;
                        }
                        removing.set(true);
                        blocked.set(false);
                        failed.set(false);
                        let gone = adapters_web::drop_workspace_leftover(move || blocked.set(true))
                            .await
                            .is_ok();
                        removing.set(false);
                        if gone {
                            blocked.set(false);
                            found.set(Leftover::Absent);
                        } else {
                            failed.set(true);
                        }
                    },
                    if removing() { "Deleting…" } else { "Delete the old workspace storage" }
                }
            }
        }
    }
}
