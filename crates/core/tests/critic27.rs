//! INCREMENT 27 — THE REVIEWER'S CARD OFFERS ONLY WHAT IT CAN DO,
//! **corrected in 29**: the axis is the toolbox, not the role.
//!
//! The critic's card said, in its own description, that it cannot change, run
//! or start anything, and four lines down offered `Give critic a task`. A task
//! handed to an agent whose file names only `read_file`, `list_files` and
//! `find_files` is a run that can only end in a report about nothing, so the
//! door is gone and the sentence naming who really calls it stands in its
//! place. `Talk to` survives, because handing it finished work in chat is real.
//!
//! 27 branched on `role:`. That was the same class of mistake it was fixing —
//! `scout` declares no role, is read-only by the identical allowlist, and kept
//! the door — so the branch is now `agents::card_sentences::can`, read off the RESOLVED tools.
//! The fixtures below are what that costs the old tests: `role:` no longer
//! decides anything, so the pair that used to prove "role, not name" now proves
//! "tools, not name and not role" — same fixtures, one with tools that act and
//! one without.

use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, Ports};
use kernel::{Request, Timestamp};

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

fn listing(files: &[(&str, &str)]) -> String {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        files.iter().map(|(n, t)| (n.to_string(), t.to_string())).collect(),
    );
    handle(&mut app, Request::get("/agents")).body
}

const LEAD: &str =
    "---\nname: builder\ndescription: the lead\ntools: [judge]\n---\nbody";
const JUDGE: &str =
    "---\nname: judge\ndescription: says whether work stands\nrole: critic\n\
     tools: [read_file]\n---\nbody";

/// ONE CARD out of the listing. Every card is in one string, and since 29 more
/// than one card can carry the read-only sentence — `contains` over the whole
/// page would pass on somebody else's card.
fn card(page: &str, who: &str) -> String {
    let at = page.find(&format!("data-agent=\"{who}\"")).expect("a card for {who}");
    let rest = &page[at..];
    rest.find("<div class=\"agent-card\"").map_or(rest, |end| &rest[..end]).to_string()
}

/// The defect itself: no task door, and in its place the sentence saying which
/// agent does the handing — read off the roster, so it names `builder` because
/// `builder`'s file names `judge`, not because anything hardcoded a pair.
#[test]
fn a_critic_card_offers_chat_and_names_its_caller_instead_of_a_task() {
    let page = listing(&[("builder", LEAD), ("judge", JUDGE)]);
    let judge = card(&page, "judge");
    assert!(judge.contains("Talk to judge"), "chat is still a real way in: {judge}");
    assert!(
        !judge.contains("Give judge a task"),
        "a reviewer with no write tools cannot be given a task: {judge}"
    );
    assert!(
        judge.contains(
            "The builder agent hands it work; there is no task to give it, and nothing to \
             read with either — no tool it can use here."
        ),
        "the door's slot says who calls it, and why there is no task: {judge}"
    );
}

/// …and the branch is neither the name nor the role: it is the TOOLS. Two
/// agents both called `critic` — the one whose empty `tools:` resolves to every
/// built-in (`write_agent` among them) keeps both doors, and the one naming
/// three readers loses one even though it declares no role at all. Between them
/// they rule out every axis but the toolbox.
#[test]
fn what_the_tools_do_decides_the_door_not_the_name_and_not_the_role() {
    let acts = "---\nname: critic\ndescription: an ordinary agent\ntools: []\n---\nbody";
    let page = card(&listing(&[("critic", acts)]), "critic");
    assert!(page.contains("Talk to critic"), "{page}");
    assert!(page.contains("Give critic a task"), "it can write an agent: {page}");
    assert!(!page.contains("there is no task to give it"), "{page}");

    let reads = "---\nname: critic\ndescription: an ordinary agent\nspace: research\n\
                 tools: [read_file, list_files]\n---\nbody";
    let page = card(&listing(&[("critic", reads)]), "critic");
    assert!(!page.contains("Give critic a task"), "no role, and still no task: {page}");
    assert!(
        page.contains("Ask critic in chat — nothing on this roster hands it work"),
        "nobody calls it, so the sentence sends the reader where it does take work: {page}"
    );
}

/// Every other card is untouched: an ordinary agent still gets both doors and
/// no caller sentence.
#[test]
fn a_non_critic_card_still_carries_both_doors() {
    let page = listing(&[("builder", LEAD), ("judge", JUDGE)]);
    assert!(page.contains("Talk to builder"), "{page}");
    assert!(page.contains("Give builder a task"), "{page}");
}

/// The shipped file, as it will actually render. Its description must agree
/// with its buttons — it may not open by telling a reader the card is "not for
/// you" while offering them a way in.
#[test]
fn the_shipped_critic_card_agrees_with_its_own_buttons() {
    let shipped = include_str!("../../../public/agents/critic/agent.md");
    let caller = include_str!("../../agent/tests/agents/builder.md");
    let page = listing(&[("critic", shipped), ("builder", caller)]);
    assert!(page.contains("Talk to critic"), "{page}");
    assert!(!page.contains("Give critic a task"), "{page}");
    assert!(page.contains("The builder agent hands it work"), "{page}");
    assert!(
        !page.contains("Not for you"),
        "the description no longer denies the chat door beside it: {page}"
    );
}
