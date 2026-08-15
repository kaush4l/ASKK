//! INCREMENT 27 — THE REVIEWER'S CARD OFFERS ONLY WHAT IT CAN DO.
//!
//! The critic's card said, in its own description, that it cannot change, run
//! or start anything, and four lines down offered `Give critic a task`. A task
//! handed to an agent whose file names only `read_file`, `list_files` and
//! `find_files` is a run that can only end in a report about nothing, so the
//! door is gone and the sentence naming who really calls it stands in its
//! place. `Talk to` survives, because handing it finished work in chat is real.
//!
//! The branch is on `role:`, so these fixtures declare the role and never rely
//! on the name — an agent called `critic` holding no role keeps both doors, and
//! an agent holding the role loses one whatever it is called.

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

/// The defect itself: no task door, and in its place the sentence saying which
/// agent does the handing — read off the roster, so it names `builder` because
/// `builder`'s file names `judge`, not because anything hardcoded a pair.
#[test]
fn a_critic_card_offers_chat_and_names_its_caller_instead_of_a_task() {
    let page = listing(&[("builder", LEAD), ("judge", JUDGE)]);
    assert!(page.contains("Talk to judge"), "chat is still a real way in: {page}");
    assert!(
        !page.contains("Give judge a task"),
        "a reviewer with no write tools cannot be given a task: {page}"
    );
    assert!(
        page.contains(
            "The builder agent hands it work; there is no task to give it, because it only \
             reads and judges."
        ),
        "the door's slot says who calls it: {page}"
    );
}

/// …and the branch is the ROLE. Same name, no `role:`, both doors — which also
/// proves the assertion above is not passing on a name match.
#[test]
fn an_agent_named_critic_without_the_role_keeps_both_doors() {
    let plain = "---\nname: critic\ndescription: an ordinary agent\ntools: []\n---\nbody";
    let page = listing(&[("critic", plain)]);
    assert!(page.contains("Talk to critic"), "{page}");
    assert!(page.contains("Give critic a task"), "the role is what gates it: {page}");
    assert!(!page.contains("there is no task to give it"), "{page}");
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
    let caller = include_str!("../../../public/agents/builder/agent.md");
    let page = listing(&[("critic", shipped), ("builder", caller)]);
    assert!(page.contains("Talk to critic"), "{page}");
    assert!(!page.contains("Give critic a task"), "{page}");
    assert!(page.contains("The builder agent hands it work"), "{page}");
    assert!(
        !page.contains("Not for you"),
        "the description no longer denies the chat door beside it: {page}"
    );
}
