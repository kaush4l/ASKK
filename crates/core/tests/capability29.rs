//! INCREMENT 29 — WHAT AN AGENT'S TOOLS LET IT DO, ASKED EVERYWHERE.
//!
//! A walker pressed `Start agent` on the Dashboard for `critic` and watched the
//! turn fail. The Agents view had already taken that door away (27); the default
//! landing view still offered it, one click from the agent strip, over three
//! example tasks headed *"critic has a folder in Linux, so all three of these
//! work"* — of which two are impossible for an agent whose tools are
//! `read_file`, `list_files` and `find_files`, while the Commands view two views
//! along said *"critic has no shell"*.
//!
//! Three surfaces asked three different questions: the card asked the ROLE, the
//! launcher asked whether there was a FOLDER, the pane asked for `exec` by name.
//! `agents::card_sentences::can` is the one question, off the resolved toolbox, and these are
//! the shipped files it has to be right about — not fixtures, because the defect
//! was that the shipped roster and the shipped copy disagreed.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, App, Ports};
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

/// The eight agents this build ships, as they will really render.
const SHIPPED: [(&str, &str); 8] = [
    ("ask", include_str!("../../agent/tests/agents/ask.md")),
    ("author", include_str!("../../agent/tests/agents/author.md")),
    ("builder", include_str!("../../agent/tests/agents/builder.md")),
    ("critic", include_str!("../../agent/tests/agents/critic.md")),
    ("main", include_str!("../../../public/agents/main/agent.md")),
    ("researcher", include_str!("../../agent/tests/agents/researcher.md")),
    ("scout", include_str!("../../agent/tests/agents/scout.md")),
    ("summarizer", include_str!("../../agent/tests/agents/summarizer.md")),
];

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(
        &mut app,
        SHIPPED.iter().map(|(n, t)| (n.to_string(), t.to_string())).collect(),
    );
    Rc::new(RefCell::new(app))
}

fn listing(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/agents")).body
}

/// One card out of the listing: the sentence about a read-only agent appears on
/// more than one of them, so the whole page is not a subject.
fn card(page: &str, who: &str) -> String {
    let at = page.find(&format!("data-agent=\"{who}\"")).unwrap_or_else(|| panic!("no {who}"));
    let rest = &page[at..];
    rest.find("<div class=\"agent-card\"").map_or(rest, |end| &rest[..end]).to_string()
}

fn can(page: &str, who: &str) -> String {
    let card = card(page, who);
    let (_, rest) = card.split_once("data-can=\"").expect("every card carries data-can");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap()
}

/// THE TABLE ITSELF. Each answer is the agent's `tools:` list read back, and
/// each is a claim the Dashboard now acts on: `read` means no Start control at
/// all. `researcher` is `run` and that is not a slip — its file names NO tools,
/// which resolves to every built-in plus its space's workspace set, `exec`
/// included. Its card says "Not for you", which is an audience, not a capability;
/// this axis does not touch it (see the increment's report).
#[test]
fn every_shipped_agent_says_what_its_tools_let_it_do() {
    let page = listing(&booted());
    for (who, expected) in [
        ("main", "run"),
        ("builder", "run"),
        ("researcher", "run"),
        ("author", "change"),
        ("ask", "read"),
        ("critic", "read"),
        ("scout", "read"),
        ("summarizer", "read"),
    ] {
        assert_eq!(can(&page, who), expected, "{who}");
    }
}

/// THE DOOR FOLLOWS THE TABLE. Every read-only agent loses `Give X a task` —
/// `scout` is the one 27 missed, because it declares no `role:` — and every
/// agent that can act keeps it.
#[test]
fn only_an_agent_that_can_act_is_offered_a_task() {
    let page = listing(&booted());
    for who in ["ask", "critic", "scout", "summarizer"] {
        let card = card(&page, who);
        assert!(!card.contains(&format!("Give {who} a task")), "{who} cannot: {card}");
        assert!(card.contains(&format!("Talk to {who}")), "chat is still real: {card}");
        assert!(
            card.contains("there is no task to give it"),
            "the missing door is explained in words: {card}"
        );
        // …AND THE REASON IS THIS AGENT'S OWN (32): `summarizer` names no tool
        // at all, so "every tool it has reads" described an empty set.
        let empty = who == "summarizer";
        assert_eq!(
            card.contains("nothing to read with either"), empty,
            "a toolless agent says so and a read-only one does not: {card}"
        );
    }
    for who in ["main", "builder", "researcher", "author"] {
        let card = card(&page, who);
        assert!(card.contains(&format!("Give {who} a task")), "{who} can act: {card}");
    }
}

/// …AND WHO HANDS IT WORK IS READ OFF THE ROSTER, not guessed from the role.
/// `critic` is named in `builder`'s `tools:`; nothing names `scout`, so its
/// sentence sends the reader to the place it does take work rather than
/// inventing a caller.
#[test]
fn a_read_only_card_names_its_caller_or_names_chat() {
    let page = listing(&booted());
    assert!(card(&page, "critic").contains("The builder agent hands it work"), "critic");
    let scout = card(&page, "scout");
    assert!(
        scout.contains("Ask scout in chat — nothing on this roster hands it work"),
        "{scout}"
    );
}

/// THE COMMANDS VIEW STOPS CONTRADICTING ITSELF (brief item 6). It read
/// "critic has not run a shell command yet. It reports each one it runs…" four
/// lines above "critic has no shell": `yet` promises a first command from an
/// agent whose file names no tool that could run one.
#[test]
fn the_commands_pane_promises_no_first_command_to_an_agent_that_has_no_shell() {
    let app = booted();
    let res = handle(
        &mut app.borrow_mut(),
        Request::get("/terminal").with_header("x-agent", "critic"),
    );
    assert!(
        res.body.contains("critic runs no shell commands"),
        "the empty state says what it is: {}",
        res.body
    );
    assert!(
        !res.body.contains("has not run a shell command yet"),
        "no promise of a first one: {}",
        res.body
    );
    // The sentence where the box would be is unchanged and still true for a
    // reader — the two are now derived from one predicate, so they cannot part.
    let why = res.headers.iter().find(|(k, _)| k == "x-typeable-why").map(|(_, v)| v.clone());
    let why = why.unwrap_or_default();
    assert!(why.contains("critic has no shell"), "{why}");
}
