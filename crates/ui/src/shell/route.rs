//! The location hash IS the view (F13).
//!
//! Every view was served from one URL: a reload dumped you on the Dashboard
//! wherever you had been, nothing was linkable, and browser Back left the app
//! entirely. Three lines of binding fix all three — write the hash when the
//! view changes, read it at boot, follow `hashchange` — and that is the whole
//! of it. No router crate, no route table, no second source of truth: `View`
//! already owns the slug (`views::View::slug`), so this file only moves it in
//! and out of `window.location`.
//!
//! `#/chat`, and also plain `#chat`: the design system was linkable as
//! `#design-system` before this existed and a critic's bookmark must not break.

use dioxus::prelude::*;
use wasm_bindgen::prelude::*;

use crate::shell::views::View;

/// Who the page talks to when the address bar does not say (Python
/// `ThreadedAgent.entry`). One spelling, here, because both the initial
/// selection and this file's no-push-on-a-bare-load guard need it.
pub(crate) const DEFAULT_AGENT: &str = "main";

/// The path in the address bar, with the marker and the separator stripped:
/// `workspace/researcher`, or `workspace`, or nothing.
fn path() -> String {
    web_sys::window()
        .and_then(|w| w.location().hash().ok())
        .map(|h| h.trim_start_matches('#').trim_start_matches('/').to_string())
        .unwrap_or_default()
}

/// WHERE, and WHO IT IS ABOUT (R6-3). The selected agent used to live nowhere
/// but in memory: pick `researcher` on `#/workspace`, reload, and the hash
/// still said `#/workspace` while the strip had silently gone back to `main`.
/// Two adjacent selections on one screen persisting by two different rules —
/// and a link copied out of the address bar showed the next person a different
/// agent than the one on the sender's screen.
///
/// Bare `#/workspace` stays valid and means the default agent; a second
/// segment on a view that is not agent-scoped is ignored rather than an error,
/// because a truncated or hand-typed hash must land somewhere real.
fn parts() -> (String, Option<String>) {
    let at = path();
    match at.split_once('/') {
        Some((view, who)) if !who.is_empty() => (view.to_string(), Some(who.to_string())),
        _ => (at, None),
    }
}

/// Where the address bar says we are. Anything unrecognised is the Dashboard,
/// which is where the page lands anyway.
pub(crate) fn current() -> View {
    View::from_slug(&parts().0).unwrap_or(View::Dashboard)
}

/// …and who it says the view is about. `None` is "it did not say".
pub(crate) fn agent() -> Option<String> {
    parts().1
}

/// Put the view AND its subject in the address bar. Assigning the hash pushes a
/// history entry, which is exactly what makes Back and Forward move between
/// views — and now between agents, which is the same kind of move.
///
/// The agent rides only on the views that are ABOUT one (`View::scoped`).
/// Writing `#/settings/researcher` would put a subject on a screen with no
/// picker for it, and a person who then pressed Back would be undoing a
/// selection they could not see.
pub(crate) fn show(view: View, agent: &str) {
    let want = match view.scoped() {
        true => format!("{}/{agent}", view.slug()),
        false => view.slug().to_string(),
    };
    // ponytail: the one guard that matters — writing the hash we already have
    // would re-enter through `hashchange`.
    let at = path();
    if at == want {
        return;
    }
    let Some(w) = web_sys::window() else { return };
    // A BARE LOAD STILL GETS AN ADDRESS (R15-P2). `index.html` with no hash
    // rendered the Dashboard and left the address bar saying nothing, so the
    // first URL you could copy was the second view you opened — and Back from
    // the first press left the app. This used to return early to avoid pushing
    // an entry a person then has to press Back twice through; `replaceState`
    // writes the same address WITHOUT an entry, which is what a landing is.
    let bare = at.is_empty() && view == View::Dashboard && agent == DEFAULT_AGENT;
    if bare {
        if let Ok(history) = w.history() {
            let _ = history.replace_state_with_url(&JsValue::NULL, "", Some(&format!("#/{want}")));
        }
        return;
    }
    let _ = w.location().set_hash(&format!("/{want}"));
}

/// WHERE THE EYE LANDS when the view changes (R2-1).
///
/// Two bugs, one cause: a scroll container the router never touched. Launch a
/// task, press "Watch it", and the conversation opened at `scrollTop = 0` with
/// the turn you had just started a thousand pixels below the fold — a critic
/// concluded the task had been lost and only disproved it by reading the DOM.
/// Go to Agents and the same container was still where the previous view had
/// left it, 300px down, mid-sentence.
///
/// So: every view starts at its own top, and the CONVERSATION starts at its
/// bottom, because the newest turn is the thing a person came to read.
/// `chat::state::show` already scrolls it on every projection — it cannot work while
/// the pane is `hidden`, which is exactly what the chat pane is on every other
/// view (`centre/mod.rs`: it stays mounted so its poller survives), so the arrival
/// has to do it again.
pub(crate) fn land(view: View) {
    spawn(async move {
        // The DOM catches up on the next frame; the same 30ms every other
        // scroll in this crate waits.
        let _ = adapters_web::sleep(30).await;
        // ALL THREE, unconditionally: which box scrolls moves with the
        // breakpoint (`main` below 1100, `.stage` above), and naming one gets
        // it wrong at the other width — the mistake `layout-probe.js` calls out
        // by name. `.rail` is here since R8-5: it is a scroller of its own above
        // 1100 and it kept the last view's offset, so arriving on Chat began
        // 107px down its first panel, with the heading cut off above.
        for selector in ["main", ".stage", ".rail"] {
            if let Some(el) = web_sys::window()
                .and_then(|w| w.document())
                .and_then(|d| d.query_selector(selector).ok().flatten())
            {
                el.set_scroll_top(0);
            }
        }
        if view == View::Chat {
            // WHOSE newest turn: the hash names the focused thread, and this
            // file is where that name already lives (THREADS.md §3).
            newest_turn(&agent().unwrap_or_else(|| DEFAULT_AGENT.to_string()));
        }
    });
}

/// The newest TURN, wherever the overflow actually is (R2-1).
///
/// `show_newest("chat-scroll")` is right below 1100px, where the conversation
/// is its own scroller. Above it the conversation is as tall as it likes and
/// `.stage` is the box that scrolls, so setting `chat-scroll.scrollTop` moved
/// nothing at all and the newest turn sat 800px below the fold — which is
/// exactly what "Watch it" landed a first-time reader on. Asking the message to
/// bring ITSELF into view scrolls whichever ancestor is the scrollport, at
/// every width, without this file knowing which one that is.
///
/// PER AGENT (THREADS.md §7). The thread list can have a second conversation in
/// the document, and `#chat-log` matched whichever was first — so scrolling the
/// newest turn scrolled somebody else's.
pub(crate) fn newest_turn(who: &str) {
    if let Some(last) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.query_selector(&format!("#chat-log-{who} > :last-child")).ok().flatten())
    {
        // `false` = align its BOTTOM with the bottom of the scrollport.
        last.scroll_into_view_with_bool(false);
    }
}

/// Follow Back, Forward, and a hash typed by hand — for BOTH halves, since the
/// agent is in the hash too (R6-3). Registered once, for the life of the page —
/// `forget` because there is nothing to unregister it from: the shell outlives
/// the document.
pub(crate) fn listen(mut view: Signal<View>, mut selected: Signal<String>) {
    let Some(w) = web_sys::window() else { return };
    let cb = Closure::<dyn FnMut()>::new(move || {
        let next = current();
        // A HASH THAT NAMES NOTHING IS CORRECTED (R7-16). `#/chat/nosuchagent`
        // rewrites itself to `#/chat/main` — the roster knows that name is not
        // real and says so in the address bar — while `#/wharrgarbl` rendered
        // the Dashboard and left the invalid URL standing: the same product
        // answering "that does not exist" two different ways. A cold load
        // already corrected itself, because the view signal changing writes the
        // hash; typing a bad hash into a page already ON the Dashboard changes
        // no signal, so nothing wrote it back. Here, where the bad hash arrives.
        if !path().is_empty() && View::from_slug(&parts().0).is_none() {
            show(next, &selected.peek().clone());
        }
        if *view.peek() != next {
            view.set(next);
        }
        // Only when the hash names one: a step Back onto `#/settings` is not a
        // decision to change agent, and silently retargeting five panels on the
        // way past a fleet view is the R4-10 mistake by another route.
        if let Some(who) = agent() {
            if *selected.peek() != who {
                selected.set(who);
            }
        }
    });
    let _ = w.add_event_listener_with_callback("hashchange", cb.as_ref().unchecked_ref());
    cb.forget();
}
