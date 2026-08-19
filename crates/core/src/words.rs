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

#[cfg(test)]
mod tests {
    use super::{listed, spanned};

    #[test]
    fn a_list_reads_as_a_sentence() {
        let of = |v: &[&str]| listed(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(of(&[]), "");
        assert_eq!(of(&["a"]), "a");
        assert_eq!(of(&["a", "b"]), "a and b");
        assert_eq!(of(&["a", "b", "c"]), "a, b and c");
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
}
