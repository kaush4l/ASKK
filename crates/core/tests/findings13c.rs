//! Round 13c's P0: a Worker that cannot load this build's bundle wrote the
//! BROWSER'S exception into three agents' status and into the header's banner
//! — `Failed to fetch dynamically imported module: http://…/ui-f0314cbb.js`,
//! the one sentence in this product nobody wrote. The page's own boot fallback
//! already has the prose for exactly this condition; it only fires when the
//! shell itself fails, and here the shell was fine and only the agents broke.
//!
//! Pinned through the seam on the host (I3): `report_agent` is the one door
//! every lifecycle failure comes through, so this is where the host's words
//! stop being the sentence a person reads.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, report_agent, App, Ports};
use kernel::{Request, Status, Timestamp};

fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..10_000 {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
    panic!("future not ready under in-memory ports");
}

const AT: Timestamp = Timestamp(1_753_800_000_000);

/// What Chrome rejects a Worker's `import()` with when the module is gone.
const CHROME: &str = "Failed to fetch dynamically imported module: \
                      http://127.0.0.1:8901/ui-f0314cbb3e19a05b.js";

fn shipped() -> Vec<(String, String)> {
    ["main", "author", "researcher"]
        .iter()
        .map(|name| {
            (
                (*name).to_string(),
                format!("---\nname: {name}\ndescription: an agent\ntools: []\n---\nPROMPT"),
            )
        })
        .collect()
}

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(AT)),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, shipped());
    Rc::new(RefCell::new(app))
}

fn board(app: &Rc<RefCell<App>>) -> kernel::Response {
    handle(&mut app.borrow_mut(), Request::get("/board"))
}

fn header(res: &kernel::Response, name: &str) -> String {
    res.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// R13-P0-3. The card and the banner say what happened in this app's voice,
/// and the developer's exception string is not on the page at all.
#[test]
fn a_workers_stale_bundle_is_not_reported_as_a_javascript_exception() {
    let app = booted();
    report_agent(&mut app.borrow_mut(), "author", Status::Failed, CHROME);

    let res = board(&app);
    for raw in ["dynamically imported module", "ui-f0314cbb3e19a05b.js", "Failed to fetch"] {
        assert!(
            !res.body.contains(raw),
            "the card is printing the browser's own exception: {raw} in {}",
            res.body
        );
        assert!(
            !header(&res, "x-failed").contains(raw),
            "the banner is printing the browser's own exception: {raw}"
        );
    }
}

/// …and it is RECOGNISED, not merely hidden: the card names the condition and
/// carries the same remedy the boot fallback already offers for it.
#[test]
fn a_stale_bundle_wears_the_boot_screens_own_remedy() {
    let app = booted();
    report_agent(&mut app.borrow_mut(), "author", Status::Failed, CHROME);

    let said = header(&board(&app), "x-failed");
    assert!(
        said.contains("cache") && said.contains("Reload once"),
        "the remedy the #boot fallback gives for this exact case is missing: {said}"
    );
    // What the service worker actually does — `web/sw.js` `activate` deletes
    // every cache but the current build's — and nothing it does not do.
    assert!(
        said.contains("deletes every cache but its own"),
        "it must say what happens next, precisely: {said}"
    );
    assert!(
        said.contains("private window") && said.contains("clear this site's data"),
        "and what to do if the reload does not fix it: {said}"
    );
    // The card carries it too (HTML-escaped, so the assertion is on the run
    // of the sentence that has no apostrophe in it).
    assert!(
        board(&app).body.contains("Reload once: the page always fetches its shell"),
        "the card says the same thing"
    );
}

/// The same failure recognised through the two other browsers' wording, and a
/// URL-less message still typed rather than passed through raw.
#[test]
fn the_other_browsers_wording_is_the_same_failure() {
    for message in [
        "Importing a module script failed.",
        "error loading dynamically imported module",
    ] {
        let app = booted();
        report_agent(&mut app.borrow_mut(), "researcher", Status::Failed, message);
        let said = header(&board(&app), "x-failed");
        assert!(said.contains("Reload once"), "{message} → {said}");
    }
}

/// A lifecycle detail that is NOT a typed failure is this app's own sentence
/// already, and must survive untouched — the missing-bundle-links case writes
/// one, and turning it into "the turn failed" would lose the only thing it
/// knows.
#[test]
fn a_hand_written_lifecycle_sentence_is_left_alone() {
    let app = booted();
    let own = "this page's wasm bundle links were not found, so this agent could not be started";
    report_agent(&mut app.borrow_mut(), "author", Status::Failed, own);
    assert_eq!(header(&board(&app), "x-failed"), own);
}

/// And a Worker that reports a TYPED failure gets the remedy that failure
/// already had — the endpoint story is not re-litigated here, it is reached.
#[test]
fn a_typed_worker_failure_reaches_its_existing_remedy() {
    let app = booted();
    let payload = serde_json::to_string(&core::CoreError::Model(kernel::ModelError::Timeout {
        url: "http://127.0.0.1:8873/v1".into(),
        seconds: 120,
    }))
    .expect("a typed error serializes");
    report_agent(&mut app.borrow_mut(), "author", Status::Failed, &payload);

    let said = header(&board(&app), "x-failed");
    assert!(said.contains("2 minutes"), "the timeout's own words: {said}");
    assert!(!said.contains('{'), "and not its JSON: {said}");
}
