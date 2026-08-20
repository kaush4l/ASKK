//! THE SENTENCE FRAGMENTS THE PANES SHARE. A pane says its own sentence, but a
//! run of names and a length of time are not that pane's opinion — they are
//! spelling, and spelling has one home. The Files pane and the Processes pane
//! both tell a person which things were here before the reload took them, and
//! both write the run the same way; the Observe block and the process table
//! both report how long something has been, and both write the duration the
//! same way. Here is where those two shapes are written.

/// A list a person reads: `a`, `a and b`, `a, b and c`.
pub(crate) fn listed(names: &[String]) -> String {
    match names.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// WHO HANDS THIS AGENT WORK, with the verb agreeing. The card said *"The
/// builder and the main agent hands it work"* the moment a second agent named
/// the critic — one caller had been the only case anybody had, so the singular
/// was welded into the sentence rather than chosen. `listed` above is the run
/// of names; this is the agreement, and it is here for that function's reason:
/// a plural is spelling, and spelling has one home. An empty run has no
/// sentence at all — "nobody hands it work" is a different claim, and the
/// caller that knows it is empty is the one that should make it.
pub(crate) fn handed_by(callers: &[&str]) -> String {
    let names = listed(&callers.iter().map(|c| c.to_string()).collect::<Vec<_>>());
    match callers.len() {
        1 => format!("The {names} agent hands it work"),
        _ => format!("The {names} agents hand it work"),
    }
}

/// A length of time a person and a model read the same way: `44s`, `3m12s`,
/// `1h06m`. Seconds only, and never a sign — a caller that has a reading it
/// cannot render (a `0` the guest could not answer, an end nothing recorded)
/// decides what to say about it BEFORE it gets here, because "there is no
/// reading" is a fact about that pane's data, not about how a duration is
/// spelled.
pub(crate) fn spanned(secs: i64) -> String {
    match secs {
        s if s < 60 => format!("{s}s"),
        s if s < 3600 => format!("{}m{:02}s", s / 60, s % 60),
        s => format!("{}h{:02}m", s / 3600, (s % 3600) / 60),
    }
}

/// A sentence CUT TO A GLANCE: whitespace flattened to single spaces, and an
/// ellipsis where it was cut. The caller passes the width because a row and a
/// pill have different room; the RULE — flatten, cut the tail, say you cut it
/// — is written once, here, with `listed` and `spanned`, because it is
/// spelling and spelling has one home.
///
/// It cuts the TAIL, where `trace::row::args` cuts the middle, and the two are
/// not the same rule wearing different numbers. That one shows a tool
/// argument, where how a value ENDS is the evidence (R14-P0-2); this one shows
/// a goal or an answer, which a person recognises from its first words and
/// reads in full somewhere else.
pub(crate) fn clipped(text: &str, at: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match flat.chars().count() > at {
        false => flat,
        true => format!("{}…", flat.chars().take(at).collect::<String>().trim_end()),
    }
}

#[cfg(test)]
mod tests {
    use super::{clipped, handed_by, listed, spanned};

    #[test]
    fn a_list_reads_as_a_sentence() {
        let of = |v: &[&str]| listed(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(of(&[]), "");
        assert_eq!(of(&["a"]), "a");
        assert_eq!(of(&["a", "b"]), "a and b");
        assert_eq!(of(&["a", "b", "c"]), "a, b and c");
    }

    /// One caller was the only case anybody had until a second agent named the
    /// critic, and the singular had been welded into the sentence.
    #[test]
    fn the_verb_agrees_with_the_number_of_callers() {
        let of = |v: &[&str]| handed_by(v);
        assert_eq!(of(&["builder"]), "The builder agent hands it work");
        assert_eq!(of(&["builder", "main"]), "The builder and main agents hand it work");
        assert_eq!(of(&["a", "b", "c"]), "The a, b and c agents hand it work");
    }

    #[test]
    fn a_duration_reads_the_same_wherever_it_is_printed() {
        assert_eq!(spanned(0), "0s");
        assert_eq!(spanned(23), "23s");
        assert_eq!(spanned(59), "59s");
        assert_eq!(spanned(60), "1m00s");
        assert_eq!(spanned(251), "4m11s");
        assert_eq!(spanned(3599), "59m59s");
        assert_eq!(spanned(3600), "1h00m");
        assert_eq!(spanned(4000), "1h06m");
    }

    #[test]
    fn a_long_sentence_is_cut_and_says_it_was() {
        assert_eq!(
            clipped("  one\n  two  ", 40),
            "one two",
            "flattened, not cut"
        );
        assert_eq!(
            clipped("abcdef", 6),
            "abcdef",
            "exactly the width is not cut"
        );
        assert_eq!(clipped("abcdefg", 6), "abcdef…");
        // The ellipsis never lands after a space it kept.
        assert_eq!(clipped("ab cdefg", 3), "ab…");
    }
}
