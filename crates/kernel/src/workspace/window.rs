//! A WINDOW ON A FILE, as one busybox command.
//!
//! Its own file for the reason `gate/cap.rs` is: `workspace.rs` is at the I12
//! ceiling and the argument below is prose, which takes room.
//!
//! **WHY NOT `dd` OR `sed -n`.** The plan that asked for this named both. This
//! guest has neither: `agent::environment::BINARIES` is the complete inventory
//! and the only applets it declares that can address a byte range are `tail
//! -c +N` and `head -c N`. A window built on an applet the guest does not have
//! is the I16 defect this increment exists to close, committed in its own first
//! line, so the range is cut with the two that are declared.
//!
//! **WHY THE SIZE IS `wc -c` AND NOT `.len()` ON WHAT CAME BACK.** The whole
//! point of a window is that the rest of the file never crosses the PTY. A size
//! measured by reading is a size that costs exactly what the window was meant to
//! save — and on a file bigger than the 180s watchdog can ship, it is a size
//! that never arrives at all.
//!
//! **WHY THE SENTENCE IS PRINTED BY THE SCRIPT.** The trailer states the range
//! against the file's true size, and the true size is `$n` — a value only the
//! guest has. Writing that sentence in Rust would be asserting a range from
//! numbers Rust merely ASKED for, next to bytes something else produced. The
//! command that performs the read is the one that describes it.
//!
//! **AND WHY IT NAMES THE HARNESS.** `core::workspace::gate::cap` settled this
//! for the output ceiling and the reason carries: everything else in that field
//! is bytes the guest printed, so a reader has no other way to tell a sentence
//! we wrote from a sentence a command wrote. An unattributed `[WINDOW: …]` is
//! also a line any file could contain — the trailer says whose act it was.

use crate::shell_quote;

/// The command that reads `path` from `offset` for `limit` bytes.
///
/// `offset == 0 && limit == 0` is THE WHOLE FILE and is byte-identical to the
/// `cat -- path` this port always ran, so every existing caller — the files
/// pane, `read_file` with no window asked for — is unchanged code running an
/// unchanged command. There is one reader; the window is a request, not a
/// second door.
pub fn read_script(path: &str, offset: usize, limit: usize) -> String {
    let p = shell_quote(path);
    if offset == 0 && limit == 0 {
        return format!("cat -- {p}");
    }
    // `tail -c +N` counts from ONE, so byte 0 is `+1`. `tr -d ' '` because
    // busybox pads `wc`'s number and the trailer would read `bytes  1234`.
    let from = offset + 1;
    let cut = match limit {
        0 => String::new(),
        n => format!(" | head -c {n}"),
    };
    format!(
        "n=$(wc -c < {p} | tr -d ' ') || exit $?; tail -c +{from} -- {p}{cut}; \
         printf '\\n[THE HARNESS READ A WINDOW OF THIS FILE: {asked}, out of a file that is \
         %s bytes in total. The gap is this product doing what you asked and not the file \
         ending — nothing outside that range is shown. Ask again with a different offset to \
         read the rest.]\\n' \"$n\"",
        asked = asked(offset, limit)
    )
}

/// What was ASKED FOR, in bytes, said as a request rather than as a result: on
/// a short file the window delivers less than it names, and a sentence claiming
/// otherwise would be the lie the whole file is here to avoid.
fn asked(offset: usize, limit: usize) -> String {
    match limit {
        0 => format!("this is everything from byte {offset} onwards"),
        n => format!("this is up to {n} bytes starting at byte {offset}"),
    }
}

#[cfg(test)]
mod tests {
    use super::read_script;

    /// No window asked for is the command this port always ran.
    #[test]
    fn the_whole_file_is_still_one_cat_and_nothing_else() {
        assert_eq!(read_script("notes.md", 0, 0), "cat -- 'notes.md'");
    }

    /// The window uses only applets `agent::environment::BINARIES` declares,
    /// counts `tail` from one, and states its own range beside the true size.
    #[test]
    fn a_window_is_cut_with_declared_applets_and_states_its_own_range() {
        let s = read_script("big.log", 1000, 500);
        assert!(s.contains("tail -c +1001 -- 'big.log'"), "{s}");
        assert!(s.contains("head -c 500"), "{s}");
        assert!(s.contains("wc -c < 'big.log'"), "size is measured, not read: {s}");
        assert!(s.contains("up to 500 bytes starting at byte 1000"), "{s}");
        for absent in ["dd ", "sed "] {
            assert!(!s.contains(absent), "this guest has no {absent}: {s}");
        }
        // An offset with no limit runs to the end and says so.
        let tail = read_script("big.log", 1000, 0);
        assert!(!tail.contains("head -c"), "{tail}");
        assert!(tail.contains("everything from byte 1000 onwards"), "{tail}");
    }

    /// A path is quoted once, everywhere it appears in the script.
    #[test]
    fn a_path_cannot_escape_into_the_window_script() {
        let s = read_script("a'; rm -rf /", 1, 2);
        assert!(!s.contains("; rm -rf /;"), "{s}");
        assert_eq!(s.matches("'a'\\''; rm -rf /'").count(), 2, "{s}");
    }
}
