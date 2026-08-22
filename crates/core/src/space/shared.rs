//! The shared half of a space: where its state actually lives, and the three
//! tools that write to it. `agent::space` decides; this file moves the bytes.
//!
//! The Python hands every agent naming `research` the same object. A Worker
//! has no shared memory (ADR-008), so the shared thing is a STORE both can
//! open: one database (`harness-spaces`), one key per fact and one key per
//! note, injected as `Ports::spaces` so this tests on the host (I3).
//!
//! Two consequences, both deliberate:
//!
//! - **One key per entry, so one mutation is one store operation.** There is
//!   no half of a single put, which is the property the Python's
//!   tmp-then-`replace` buys — and no read-modify-write of a whole document,
//!   which is how two Workers writing at once would lose one of the writes.
//! - **Read fresh before every call**, never cached, for the reason the clock
//!   is not cached: a peer may have written since the last turn.

use std::cell::RefCell;
use std::rc::Rc;

use agent::{Change, Space, NOTE_LIMIT};
use context::Args;
use kernel::{EventKind, KvStore, ToolId};

use crate::app::App;

fn prefix(name: &str) -> String {
    format!("space/{name}/")
}

/// Every fact and note of one space, newest notes last. A key that will not
/// read costs that entry and nothing else: the group can fill the space again,
/// and refusing the turn over it would cost the conversation instead.
pub(crate) async fn load(kv: &dyn KvStore, name: &str) -> Space {
    let mut space = match Space::named(name) {
        Some(space) => space,
        None => return Space::default(),
    };
    let at = prefix(name);
    let keys = kv.list_prefix(&at).await.unwrap_or_default();
    for key in keys {
        let Some(rest) = key.strip_prefix(&at) else {
            continue;
        };
        let Ok(Some(value)) = kv.get(&key).await else {
            continue;
        };
        match rest.split_once('/') {
            Some(("f", fact)) => space.facts.push((fact.to_string(), value)),
            Some(("n", _)) => space.notes.push(value),
            _ => {}
        }
    }
    // `list_prefix` comes back sorted, so facts are in key order and notes in
    // the order they were posted; the cap applies on READ as well as on write,
    // so a reader that arrives between a post and its trim still sees 20.
    space.trim();
    space
}

/// Re-read this agent's space. Called at the top of every `drive` pass, which
/// is what makes a peer's write visible without anyone being told to look.
pub(crate) async fn refresh(app: &Rc<RefCell<App>>) {
    let (kv, name) = {
        let a = app.borrow();
        (
            Rc::clone(&a.ports.spaces),
            a.agent.space.as_ref().map(|s| s.name.clone()),
        )
    };
    let Some(name) = name else { return };
    let space = load(kv.as_ref(), &name).await;
    // `agent::space` and nothing else. What the PROMPT shows is written by
    // `space::sense::SpaceSense` through the faculty port, from this same
    // field, one step later in `runtime::drive` — so the space has no private
    // path into the paper that a browser faculty would have to copy.
    app.borrow_mut().agent.space = Some(space);
}

/// Run one of the space's tools. Reached through `tools::tool_entry`, which
/// routes every name `agent::is_space_tool` claims here. `None` means this
/// call was not run — a name that is not one of the three, or an agent with no
/// space at all — and the local table answers it (refusing it, in both cases).
///
/// The AUTHOR is this process's agent, taken here rather than from the call:
/// the Python closes over the name when it builds the tool, and a model asked
/// to write its own name into a note could write anyone's.
pub(crate) async fn run(
    app: &Rc<RefCell<App>>,
    tool: &ToolId,
    args_json: &str,
) -> Option<EventKind> {
    if !agent::is_space_tool(&tool.0) {
        return None;
    }
    refresh(app).await;
    let (kv, author, mut space, at, nonce) = {
        let a = app.borrow();
        let mut bytes = [0u8; 2];
        a.ports.rng.fill(&mut bytes);
        (
            Rc::clone(&a.ports.spaces),
            a.me().to_string(),
            a.agent.space.clone()?,
            a.ports.clock.now(),
            u16::from_be_bytes(bytes),
        )
    };
    // `key` is a NAME: it is the identity of a fact, matched against the keys
    // already in the space (`crates/agent/src/space.rs:78`). `value` and `note`
    // are TEXT: they are what the group is being told, so the reader hands them
    // over untouched and `Space` — the pure half — decides what normalising a
    // fact or a board note means, in one place, where it is tested.
    let args = Args::parse(args_json);
    let name = |k: &str| args.name(k).unwrap_or_default();
    let text = |k: &str| args.text(k).unwrap_or_default();
    let (said, change) = match tool.0.as_str() {
        "remember" => space.remember(name("key"), text("value")),
        "forget" => space.forget(name("key")),
        _ => space.post(&author, text("note")),
    };
    let stamp = format!("{:013}-{author}-{nonce:04x}", at.0);
    // A REFUSAL IS NOT A SUCCESS, and `ok` is the flag every projection colours
    // by. `Change::None` is the pure half saying it did nothing — *"Nothing
    // recorded: a fact needs a key."*, *"Nothing posted: the note was empty."*,
    // *"No fact called 'x'"* — and `write` answers `Ok(())` to it, correctly:
    // there was nothing to store and the STORE did not fail. Reading that
    // `Ok` as the CALL's outcome painted those three sentences green in the
    // Tool trace, which is the pane a person opens to find out what went
    // wrong. The prose was always right; only the flag was lying.
    //
    // The duplicate note — *"That note is already on the research board."* — is
    // here too, and deliberately: the board is unchanged and this call put
    // nothing on it. A row that says "nothing happened" in green is the same
    // lie in a milder form.
    let refused = change.is_none();
    let stored = write(kv.as_ref(), &space.name, change, &stamp).await;
    // What the tool just changed, in the state the tools read. The prompt
    // catches up at the top of the next `drive` pass, which is before the next
    // model call and therefore before anyone could read a stale one.
    app.borrow_mut().agent.space = Some(space);
    Some(EventKind::ToolInvoked {
        tool: tool.clone(),
        args: args_json.to_string(),
        ok: stored.is_ok() && !refused,
        output: match stored {
            Ok(()) => said,
            // The space is what the GROUP knows; a write nobody else can read
            // is not a fact the group has, so the agent is told plainly.
            Err(message) => format!("{said}\n(but the space could not be saved: {message})"),
        },
    })
}

/// Perform the one operation the mutation asked for. `Change::Note` is a put
/// under a time-ordered key and then a trim of anything past the cap — the
/// trim is a delete of keys that are already surplus, so two agents trimming
/// at once cannot remove a note either of them still needed.
async fn write(
    kv: &dyn KvStore,
    name: &str,
    change: Option<Change>,
    stamp: &str,
) -> Result<(), String> {
    let at_ = prefix(name);
    let fail = |e: kernel::StoreError| format!("{e:?}");
    match change {
        None => Ok(()),
        Some(Change::Fact { key, value }) => kv
            .put(&format!("{at_}f/{key}"), &value)
            .await
            .map_err(fail),
        Some(Change::Forget { key }) => kv.delete(&format!("{at_}f/{key}")).await.map_err(fail),
        Some(Change::Note { line }) => {
            // Time first so the keys sort into posting order, then the author
            // and two random bytes: two agents posting in the same millisecond
            // would otherwise write one key, and one of the notes would vanish
            // with nobody told (found by the racing-writes test).
            let key = format!("{at_}n/{stamp}");
            kv.put(&key, &line).await.map_err(fail)?;
            let notes = kv.list_prefix(&format!("{at_}n/")).await.map_err(fail)?;
            for stale in notes.iter().take(notes.len().saturating_sub(NOTE_LIMIT)) {
                kv.delete(stale).await.map_err(fail)?;
            }
            Ok(())
        }
    }
}
