//! One agent's own log, and the property the Python guarantees about it:
//! **after a compaction the log mirrors the window exactly**.
//!
//! In the Python the log is `agents/<name>/log.txt`; every turn is appended on
//! a worker thread and compaction REWRITES the whole file, draining the writes
//! still in flight first — "an append scheduled before this call is a turn that
//! belongs in the file, and letting it land afterwards would put it below the
//! summary that already covers it". Here the file is a key range in IndexedDB
//! and the atomic tmp-then-replace is one transaction, but the property and its
//! ordering are the same, and this module is where both are decided — purely,
//! on the host, with no store in sight (I3).

/// One pending write, in the order it must reach the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LogOp {
    /// One new window entry, at its index.
    Append { index: usize, line: String },
    /// The whole window, replacing everything under the prefix — the atomic
    /// `_replace_log`. Queued BEHIND every append already waiting, which is
    /// the drain.
    Rewrite(Vec<String>),
}

/// How much of the window has been mirrored so far. Not the window itself: the
/// window lives in `AgentState`, and a second copy would be a second truth.
#[derive(Debug, Default)]
pub(crate) struct Logbook {
    written: usize,
    generation: u32,
}

impl Logbook {
    /// A log read back from the store at boot: already mirrored, nothing due.
    pub(crate) fn restored(entries: usize) -> Logbook {
        Logbook {
            written: entries,
            generation: 0,
        }
    }
}

/// The writes that bring the log level with the window, in order.
///
/// `generation` is the agent's compaction count. When it moves, everything the
/// log holds is stale and a `Rewrite` is due — and it is emitted LAST, after
/// the appends of the entries that preceded it, so an append can never land on
/// top of the rewrite that already covers it.
pub(crate) fn sync(book: &mut Logbook, window: &[String], generation: u32) -> Vec<LogOp> {
    let mut ops: Vec<LogOp> = window
        .iter()
        .enumerate()
        .skip(book.written)
        .map(|(index, line)| LogOp::Append {
            index,
            line: line.clone(),
        })
        .collect();
    book.written = window.len();
    if generation != book.generation {
        book.generation = generation;
        ops.push(LogOp::Rewrite(window.to_vec()));
    }
    ops
}

/// Where one agent's log lives. A prefix per agent, exactly as the Python gives
/// each agent its own folder — one agent's turns can never be read back into
/// another's window.
pub(crate) fn prefix(agent: &str) -> String {
    format!("log/{agent}/")
}

/// One entry's key. Zero-padded so the store's lexical key order IS the
/// conversation's order.
pub(crate) fn key(agent: &str, index: usize) -> String {
    format!("{}{index:08}", prefix(agent))
}
