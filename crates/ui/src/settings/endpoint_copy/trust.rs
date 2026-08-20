//! THE TRUST MODEL, STATED WHERE KEYS ARE ENTERED (ADR-006) — and, since 28,
//! the one address a browser may refuse to call at all. Its own file because
//! the paragraph now has two engines in it and the file that chose it was full
//! (I12).

use dioxus::prelude::*;

/// IT SAID IT TWICE IN CAPITALS (R6-14). "stored against the ONE entry it was
/// typed for" was the only shouting in the product — a tic that reads like a
/// different author wrote this paragraph, in the one card where the tone has to
/// be steady because it is about a credential. The sentence carries itself.
///
/// ONE CLAIM ABOUT CHROME, AND IT IS THE TRUE ONE (R8-8). This said Chrome 142+
/// *blocks* a page from calling a local address while the failure that same
/// condition produces said it *asks permission*. Local Network Access ships as
/// a PERMISSION — the page prompts and the call goes through if it is granted;
/// a block is what a DENIAL produces. Both places now say the permission
/// (`core::failure::local_network` is the other).
///
/// …AND CHROME IS NOT THE ONLY ENGINE READING IT (28). Our own default entry is
/// `127.0.0.1`, so for anyone on the hosted page this paragraph describes the
/// first turn they will take. Saying only what Chrome does left a Safari reader
/// waiting for a prompt that is never coming, which is the same silence a
/// wrongly typed port produces. It is said BEFORE a turn is spent, not only in
/// the failure afterwards, which is the whole reason this note exists.
#[component]
pub(crate) fn TrustNote() -> Element {
    rsx! {
        p { class: "pending",
            "The endpoints above are a file this site serves; what you save here is stored in \
             this browser and layered on top of it. A key is stored against the one entry it \
             was typed for, never shown again, and attached only to calls to that entry's \
             endpoint — switching entries does not carry it across. But this is a browser: any \
             code on this page could read it, so use a scoped, credit-limited key. A provider \
             must send CORS headers."
        }
        p { class: "pending",
            "An address on this machine, such as 127.0.0.1, is a further matter — Local Network \
             Access. Chrome 142+ asks permission before a page served from the web may call one, \
             and the call goes through only if it is granted; Safari has never allowed it and \
             does not ask, so there this endpoint cannot work from the hosted page. Serve this \
             page from localhost and neither applies. A delegated sub-agent runs in a Worker, \
             which never has the user activation a permission prompt requires, so it cannot \
             answer one even after this page has."
        }
    }
}
