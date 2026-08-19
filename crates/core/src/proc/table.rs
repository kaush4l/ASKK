//! THE LISTING — every process in one table, and the durations in it.
//! `proc/watch.rs` is the neighbouring file that acts on ONE named process; this
//! one is about all of them at once.
//!
//! It is one file because it is one format read from two directions: the model
//! is handed this table, and the Processes pane reads its own rows back OUT of
//! the same string (`rows`). There is no second listing anywhere, which is why
//! the pane and the model cannot disagree about what is running — so the writer
//! and the reader of the format live together, where a column change breaks
//! both at once.

use kernel::shell_quote;

use crate::proc::convention::{DIR, STATE};

/// One tab-separated record per process: name, `state`'s word, pid, HOW LONG IT
/// RAN in seconds, command. `${st:-now}` makes a record with no start time read
/// as age zero rather than 1.7 billion seconds — inside `$(( ))` a bare name is a
/// variable, so the fallback resolves to `now - now`.
///
/// A PROCESS THAT HAS ENDED DOES NOT KEEP AGEING (R10-3). This was
/// `now - started` whatever the state, so a command that ran 46 seconds and
/// stopped read `2m30s`, then `9m21s`, then `14m26s` on successive looks. The
/// wrapper stamps `ended`, so a finished record has a fixed length; one with no
/// end and no life left reports `-1` (`ago` renders `?`).
pub(crate) fn list_script() -> String {
    format!(
        "{STATE}d={d}; [ -d \"$d\" ] || exit 0; now=$(date +%s); \
         for p in \"$d\"/*/; do [ -d \"$p\" ] || continue; n=$(basename \"$p\"); \
         pid=$(cat \"$p/pid\" 2>/dev/null); st=$(cat \"$p/started\" 2>/dev/null); \
         en=$(cat \"$p/ended\" 2>/dev/null); s=$(state \"$p\"); \
         case \"$s\" in running) a=$(( now - ${{st:-now}} ));; \
         *) a=$(( ${{en:-0}} - ${{st:-0}} )); [ -n \"$en\" ] || a=-1;; esac; \
         printf '%s\\t%s\\t%s\\t%s\\t%s\\n' \"$n\" \"$s\" \"${{pid:-?}}\" \
         \"$a\" \"$(tr '\\n' ' ' < \"$p/cmd\" 2>/dev/null)\"; done",
        d = shell_quote(DIR)
    )
}

/// The records as the one table both the model and the Processes pane read
/// (R8-8: one name for one event; `rows` below is how the pane reads it).
pub(crate) fn table(raw: &str) -> String {
    let rows: Vec<Vec<&str>> = raw
        .lines()
        .map(|line| line.split('\t').collect::<Vec<_>>())
        .filter(|fields| fields.len() == 5)
        .collect();
    if rows.is_empty() {
        return "No processes have been started here. start_process({\"name\": \
                \"web\", \"command\": \"…\"}) starts one."
            .into();
    }
    // EVERY COLUMN ENDS IN A SPACE. `{:<14}` does not pad a field already wider
    // than 14, so one long name ran into the next column.
    let mut out = format!("{:<13} {:<11} {:<6} {:<7} {}\n", "name", "state", "pid", "for", "command");
    for f in &rows {
        let age = f[3].parse::<i64>().map(ago).unwrap_or_else(|_| "?".into());
        out.push_str(&format!("{:<13} {:<11} {:<6} {:<7} {}\n", f[0], f[1], f[2], age, f[4].trim()));
    }
    // WHAT THE WORDS MEAN, once, where they are used.
    out.push_str(&format!(
        "\nOutput is in {DIR}/<name>/log. `for` is how long it RAN — still counting while it \
         runs, fixed once it ends, `?` when nothing recorded the end. exited(N) finished by \
         itself with that status; stopped was stopped from here; gone was started before this \
         page's Linux was rebuilt, so its record survived and it did not."
    ));
    out
}

/// The table's rows, read back as name, state, pid, `for`, command. The Processes
/// PANE draws a row per process and this table is the only record of a listing
/// there is, so it reads OUR format back rather than inventing a second one.
fn fields(line: &str) -> Option<[&str; 5]> {
    let mut out = [""; 5];
    let mut rest = line;
    for slot in out.iter_mut().take(4) {
        let word = rest.trim_start();
        let end = word.find(char::is_whitespace)?;
        *slot = &word[..end];
        rest = &word[end..];
    }
    out[4] = rest.trim();
    Some(out)
}

/// Every row: past the header line, up to the blank line the legend sits behind.
pub(crate) fn rows(table: &str) -> Vec<[&str; 5]> {
    table.lines().skip(1).take_while(|l| !l.trim().is_empty()).filter_map(fields).collect()
}

/// `for`, MOVED ON (R10-3). The pane re-reads this projection every heartbeat but
/// the workspace is only asked when the agent's state moves, so a RUNNING
/// process's age is its age at the listing plus the time since. `?` stays `?`.
pub(crate) fn moved_on(word: &str, plus: i64) -> String {
    match parse_secs(word) {
        Some(had) => ago(had + plus.max(0)),
        None => word.to_string(),
    }
}

/// The inverse of `ago` — a duration READ BACK off the table, over the three
/// shapes `words::spanned` writes.
fn parse_secs(word: &str) -> Option<i64> {
    if let Some(head) = word.strip_suffix('s') {
        return match head.split_once('m') {
            Some((m, s)) => Some(m.parse::<i64>().ok()? * 60 + s.parse::<i64>().ok()?),
            None => head.parse().ok(),
        };
    }
    let (h, m) = word.strip_suffix('m')?.split_once('h')?;
    Some(h.parse::<i64>().ok()? * 3600 + m.parse::<i64>().ok()? * 60)
}

/// A duration a person and a model read the same way — `words::spanned`, plus
/// the one reading this table has that the block in `observe` does not: a
/// record with no end recorded has no length, and says so.
fn ago(secs: i64) -> String {
    match secs < 0 {
        true => "?".into(),
        false => crate::words::spanned(secs),
    }
}

#[cfg(test)]
mod tests {
    use super::{ago, table};

    /// The table is OURS, not `ps` forwarded: fixed columns, a readable
    /// duration, and an empty workspace that says so in words.
    #[test]
    fn the_table_is_a_shape_we_produce() {
        assert!(table("").contains("No processes have been started"));
        let out = table(
            "web\trunning\t142\t192\tpython3 -m http.server 8000\nold\texited\t7\t4000\tmake\n",
        );
        assert!(out.lines().next().unwrap().starts_with("name"), "{out}");
        assert!(out.contains("3m12s") && out.contains("1h06m"), "{out}");
        assert!(out.contains("python3 -m http.server 8000"), "{out}");
        assert!(out.contains("gone was started before"), "the words are defined: {out}");
        assert_eq!(ago(0), "0s");
    }

    /// THE PANE READS THE SAME TABLE THE MODEL DOES (R10-1), and a running row's
    /// age moves while a finished one's does not (R10-3).
    #[test]
    fn the_rows_come_back_out_of_the_table_with_their_columns_intact() {
        let out = table(
            "web\trunning\t142\t192\tpython3 -m http.server 8000\n\
             a-very-long-name\texited(0)\t7\t-1\tmake all\n",
        );
        let rows = super::rows(&out);
        assert_eq!(rows.len(), 2, "{out}");
        assert_eq!(rows[0], ["web", "running", "142", "3m12s", "python3 -m http.server 8000"]);
        // A name wider than its column does not shift the row it is in.
        assert_eq!(rows[1][0], "a-very-long-name", "{out}");
        assert_eq!(rows[1][3], "?", "no recorded end is unknown, not a growing number");
        assert_eq!(rows[1][4], "make all");
        // The running one is 40 seconds older than the listing that saw it.
        assert_eq!(super::moved_on("3m12s", 40), "3m52s");
        assert_eq!(super::moved_on("59s", 2), "1m01s");
        assert_eq!(super::moved_on("1h06m", 60), "1h07m");
        assert_eq!(super::moved_on("?", 40), "?", "an unknown does not become a number");
    }
}
