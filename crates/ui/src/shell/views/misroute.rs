//! AN ADDRESS THAT NAMES NO VIEW, AND THE PAGE SAYING SO (31-walk F4).
//!
//! `#/tools/main` is a fair guess at the Tool trace, which is `#/trace/main`.
//! It rewrote itself to `#/dashboard/main` in silence: a mistyped hash, or one
//! shared by somebody whose build spelled the view differently, landed you on a
//! screen you did not ask for and nothing on the page mentioned it. Correcting
//! the address is right — `route.rs` has done it since R7-16 — and doing it
//! without a word is what left the reader to notice, or not.
//!
//! NOT A NEW MECHANISM. This is the `.banner` the failed-turn pill already uses
//! (chrome.css), rendered from `statusbar.rs` because that component's output
//! is the header's own content and this file may not reach into the shell.
//!
//! The record lives beside `from_slug`, and not in the header, for one reason:
//! `from_slug` is the ONLY place that knows a slug matched no view, and it is
//! called from a cold load AND from `hashchange`, so both routes are covered by
//! recording it once, there.

use std::cell::RefCell;

use dioxus::prelude::*;

use crate::ui::Button;

thread_local! {
    /// The name the address bar gave that answered to no view. Not a `Signal`:
    /// it is written during `from_slug`, which runs inside a hook's initialiser
    /// on a cold load, and the header re-renders on the page's own heartbeat.
    static MISROUTED: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Record a slug that named no view. An EMPTY slug is a bare load — it named
/// nothing, so it mistook nothing, and `index.html` with no hash is the normal
/// way in.
pub(crate) fn note(slug: &str) {
    if slug.is_empty() {
        return;
    }
    MISROUTED.with(|m| *m.borrow_mut() = Some(slug.to_string()));
}

/// What the page says about it, in the page's own voice, or nothing. The
/// destination is NAMED rather than implied: the whole defect was that the
/// arrival was silent, so a sentence that only said "that was not a view" would
/// leave the same question standing.
pub(crate) fn said() -> Option<String> {
    MISROUTED.with(|m| m.borrow().clone()).map(|slug| {
        format!(
            "There is no view called “{slug}”, so this is the Dashboard and the address bar \
             has been corrected. The list behind Views, in the header, is every view there is."
        )
    })
}

/// The notice, ONCE: it is dismissable, and a dismissal is remembered against
/// the slug it was about, so a second wrong address later still speaks.
///
/// `hushed` is a FAILED TURN, and it wins. Both banners are rows of the chrome
/// and the chrome is already at 484px of a 780px phone against a floor of a
/// third of the viewport (`fold-probe.js`, CHROME): a second row does not fit,
/// and of the two, the one with a remedy in it is the one to keep. The address
/// has been corrected either way, and this notice waits — the slug is still
/// recorded, so it speaks as soon as the failure clears.
#[component]
pub(crate) fn Misroute(hushed: bool) -> Element {
    let mut done = use_signal(String::new);
    let Some(line) = said().filter(|_| !hushed) else { return rsx! {} };
    if *done.read() == line {
        return rsx! {};
    }
    let dismissed = line.clone();
    rsx! {
        // `pending`, NOT `problem`: a wrong address is not a failure, and the
        // red the failed-turn banner is painted in means a turn is lost.
        p { class: "banner pending", role: "status",
            span { class: "problem-line", "{line}" }
            Button {
                variant: "secondary",
                onclick: move |_| done.set(dismissed.clone()),
                "Got it"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::shell::views::View;

    /// The reported case, end to end: the slug that named no view lands on the
    /// Dashboard AND the page has something to say about it, naming both.
    #[test]
    fn a_slug_that_names_no_view_lands_on_the_dashboard_and_says_so() {
        let where_to = View::from_slug("tools").unwrap_or(View::Dashboard);
        assert!(where_to == View::Dashboard);
        let said = super::said().expect("an unknown slug is recorded");
        assert!(said.contains("tools"), "the typed name is not in it: {said}");
        assert!(said.contains("Dashboard"), "where it landed is not in it: {said}");
    }

    /// …and a real one is not accused of anything. `index.html` with no hash is
    /// the normal way in, and `#/trace` is a view.
    #[test]
    fn a_bare_load_and_a_real_view_say_nothing() {
        assert!(super::said().is_none(), "nothing has been mistyped yet");
        super::note("");
        assert!(super::said().is_none(), "a bare load named nothing");
        assert!(View::from_slug("trace").is_some());
        assert!(super::said().is_none(), "a real view is not a misroute");
        // …and the name this view shipped under is still a real one (F13).
        assert!(View::from_slug("workspace").is_some());
        assert!(super::said().is_none(), "the old spelling still resolves");
    }
}
