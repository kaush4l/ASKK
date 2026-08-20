//! WHAT A MODULE'S LOGIC IS HANDED. `dispatch.rs` owns the routing and
//! CONSTRUCTS one of these per invocation; this file is only its shape.
//!
//! The line between them is the one ADR-006 draws: this file is the SHAPE of a
//! module's capability context — what may be granted, and what every built-in
//! may read — and `dispatch.rs` is the one place that decides, from a
//! manifest's grants, which of it is `Some`. A field's doc comment is where the
//! reason it exists lives; the dispatcher only fills them in.

use kernel::{EventKind, Request, Response, Timestamp};

/// A KV view scoped to one prefix (ADR-006: the handle physically cannot
/// form a key outside its slice). No G4 module is granted Kv yet; the
/// projection-read/write-behind design lands with the first one.
pub struct KvHandle {
    prefix: String,
}

impl KvHandle {
    /// Read one key under the module's prefix (the prefix is prepended here,
    /// not by the caller — callers never spell absolute keys).
    pub fn get(&self, key: &str) -> Option<String> {
        let _ = key;
        todo!("G5: first Kv-granted module")
    }

    /// Stage a write under the prefix; it leaves as an Effect.
    pub fn put(&mut self, key: &str, value: &str) {
        let _ = (key, value);
        todo!("G5: first Kv-granted module")
    }
}

/// The capability context a module's logic receives (§6 `ctx`). Ungranted =
/// `None` = absent, not present-but-refused (ADR-006). Constructed per
/// invocation from the module's effective grants; never stored.
pub struct Ctx {
    /// The handler asked for this agent's conversation to be WIPED. A flag and
    /// not an action, for `emit`'s reason: the window lives on `App` and a
    /// handler holds a projection of it, so the route records the intent and
    /// the dispatcher carries it out (`clear::wipe`).
    pub wipe: bool,
    pub kv: Option<KvHandle>,
    /// Injected time, if granted (I7: even built-ins never read a real clock).
    pub clock: Option<Timestamp>,
    /// Emit events, if granted. PROVISIONAL (G4 discovery): a buffer the
    /// dispatcher drains, not the frozen closure — a closure borrowing App
    /// while the handler also runs against App cannot satisfy the borrow
    /// checker without interior mutability this is simpler than. Also
    /// widened from Custom-only to `EventKind`: the chat module's whole job
    /// is emitting `UserMessage`, which is not a Custom fact.
    pub emit: Option<Vec<EventKind>>,
    /// PROVISIONAL (G4): read-only projections handed to every built-in — the
    /// event kinds so far (views are projections of the log, I8). Becomes a
    /// real capability/section story at G5.
    pub recent: Vec<EventKind>,
    /// Each `recent` entry's injected timestamp (I7), by the same index — a log
    /// a person reads needs the time the fact happened, and `EventKind` has none.
    pub at: Vec<i64>,
    /// Commands the runtime is awaiting right now (`App::running`, R2-8).
    pub running: Vec<String>,
    /// Workspace calls handed to the port and not yet answered (`App::calling`,
    /// R11-4). Oldest first: the workspace runs one at a time, so the head is
    /// the one everything else is queued behind.
    pub calling: Vec<crate::trace::inflight::Inflight>,
    /// What a Stop could do to the call in flight, asked of the engine this
    /// build was composed with (R11-1). A fact like `durable` and stated for
    /// the same reason: one engine really kills a command and the other can
    /// only stop waiting for it, and one button label cannot mean both.
    pub interrupt: kernel::Interrupt,
    /// Agents with an utterance ACCEPTED but not yet pumped — `roster::accepted`'s
    /// window, widened to every agent. It lives in memory only, so a replayed
    /// log has none of it: that is exactly what tells a turn something is
    /// driving from a turn a reload abandoned (12 walk, `chat::fold::driven`).
    pub queued: Vec<String>,
    /// The loaded agent specs (increment 03) — a projection like `recent`.
    pub agents: Vec<agent::AgentSpec>,
    /// The agent files that would not parse — shown, never swallowed.
    pub agent_problems: Vec<String>,
    /// WHAT EACH `model:` KEY REALLY CALLS TODAY: `(the key an agent file asks
    /// for, the catalogue entry that answers it, the model id it sends)`, asked
    /// of `ModelPort::resolves`. Keyed by the KEY and not by the agent, because
    /// that is what the resolution depends on — six agents saying `local` are
    /// one question, and this is rebuilt on every request.
    ///
    /// Empty when the port cannot say (every host test, by default). The card
    /// then prints the file's own words and no model id, which is the one thing
    /// it must not invent.
    pub resolved_models: Vec<(String, String, String)>,
    /// Which of `agents` were AUTHORED IN THIS BROWSER rather than shipped in
    /// `public/agents/`, and BY WHOM — empty for the person at the keyboard,
    /// otherwise the agent that called `write_agent` (increment 11, 11b). A
    /// model can write an agent that runs with real capabilities, so who wrote
    /// one is a fact the page states rather than a difference to infer.
    pub authored: Vec<(String, String)>,
    /// What every agent is doing (increment 06) — a projection like `recent`,
    /// cloned so a handler cannot move a status by writing to it.
    pub board: Vec<agent::AgentRow>,
    /// WHICH agent this process is (increment 07). A conversation-shaped fact
    /// with no name on it belongs to this one; `/chat` projects one agent's
    /// history and defaults to it.
    pub me: String,
    /// What THIS process's agent actually holds — its window (increment 08).
    /// A projection like `board`: the pane can say how much of the
    /// conversation the model still sees, which after a compaction is not the
    /// same thing as how much of it is on screen.
    pub window: Vec<String>,
    /// The shared space this process's agent works in, as last read from the
    /// store (increment 09) — a projection like `board`, so the inspector
    /// cannot show facts the agent's own prompt does not have.
    pub space: Option<agent::Space>,
    /// Whether what the agent writes in its workspace folder is still there
    /// after a reload — `WorkspacePort::durable`, asked of the engine this
    /// build was composed with (increment 18). Two projections state it in
    /// prose, and the sentence has to follow the engine: container2wasm's
    /// filesystem is memory, and a product that keeps promising IndexedDB
    /// after the owner switches engines is lying in the one place a person
    /// checks before trusting it with a file.
    pub durable: bool,
    /// How many of `recent` were replayed from storage rather than appended by
    /// this page. Everything below it happened on an earlier load, in a Linux
    /// that was rebuilt since — and possibly on the OTHER engine, which is why
    /// the scrollback marks those rows instead of showing their output as
    /// current (R10-5).
    pub booted: usize,
    /// Whether this CONTEXT owns the log it is projecting (`log::writership`).
    /// A projection like `board`: the conversation has to say why it will not
    /// take a turn, and the reason is a fact in the log, not a flag the adapter
    /// reached in and set.
    pub writership: crate::log::writership::Writership,
}

/// A tier-0 built-in's logic. A plain fn pointer, not a trait object: no
/// state may hide in a built-in (state lives in the log/store like everyone
/// else's — I9), and fn pointers keep the dispatch table one flat array.
pub type BuiltinHandler = fn(&Request, &mut Ctx) -> Response;
