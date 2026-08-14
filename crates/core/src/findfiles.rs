//! FINDING A FILE IN THE WORKSPACE — `find_files`, its one script and what it
//! says about a search that found nothing. Split from `observe.rs`, which asks
//! the machine what it IS, so both hold the 200-line rule (I12): two tools, two
//! files, one port (ADR-013).

use kernel::{shell_quote, Execution};

use crate::process::DIR;

/// Empty means every file: a content search still has to name something.
pub(crate) fn pattern(name: &str) -> String {
    match name.trim().is_empty() {
        true => "*".into(),
        false => name.trim().to_string(),
    }
}

/// `find` for the name, `grep` behind it for the contents. `.harness` is pruned
/// — the process records are ours, and a search for `*` returning a hundred log
/// lines has answered the wrong question. `-exec … +` rather than a pipe into
/// xargs: a file name with a space in it would be split by the pipe.
pub(crate) fn find_script(name: &str, text: &str) -> String {
    let (name, dir) = (shell_quote(name), shell_quote(&format!("./{DIR}")));
    let hunt = match text.is_empty() {
        true => " -print".to_string(),
        false => format!(" -exec grep -IHns -m1 -e {} {{}} +", shell_quote(text)),
    };
    format!("find . -path {dir} -prune -o -type f -name {name}{hunt} 2>/dev/null | head -n 60")
}

/// The hits, capped and tidied. A search that found nothing SAYS what it looked
/// for: "no matches" over an unstated query is a result nobody can act on.
pub(crate) fn found(name: &str, text: &str, ran: &Execution) -> Execution {
    let asked = match (name.is_empty(), text.is_empty()) {
        (false, false) => format!("files named {name} with a line containing '{text}'"),
        (false, true) => format!("files named {name}"),
        _ => format!("files with a line containing '{text}'"),
    };
    let hits: Vec<String> = ran
        .output
        .lines()
        .map(|l| l.trim_start_matches("./").trim_end().to_string())
        .filter(|l| !l.is_empty())
        .map(|l| match l.char_indices().nth(160) {
            Some((cut, _)) => format!("{}…", &l[..cut]),
            None => l,
        })
        .collect();
    let capped = match hits.len() >= 60 {
        true => " (capped at 60 — narrow the search)",
        false => "",
    };
    let output = match hits.len() {
        0 => format!("Nothing in this folder matches: {asked}."),
        n => format!("{n} match(es) for {asked}{capped}:\n{}", hits.join("\n")),
    };
    Execution { status: 0, output }
}

#[cfg(test)]
mod tests {
    use super::{find_script, found};
    use kernel::Execution;

    /// The search names what it looked for, whether or not it found anything.
    #[test]
    fn a_search_states_its_own_question() {
        let ran = |o: &str| Execution { status: 0, output: o.into() };
        let none = found("*.md", "", &ran(""));
        assert!(none.output.contains("files named *.md"), "{}", none.output);

        let some = found("", "TODO", &ran("./notes/a.md:3:TODO ship it\n"));
        assert!(some.output.starts_with("1 match(es)"), "{}", some.output);
        assert!(some.output.contains("notes/a.md:3:TODO ship it"), "{}", some.output);
        assert!(!some.output.contains("./notes"), "the ./ is noise: {}", some.output);
    }

    /// A file name with a space in it is ordinary; a pipe into xargs would
    /// split it, so the grep is an `-exec … +`.
    #[test]
    fn the_search_prunes_its_own_records_and_never_splits_a_name() {
        let script = find_script("*.md", "TODO");
        assert!(script.contains("-path './.harness/proc' -prune"), "{script}");
        assert!(script.contains("-exec grep -IHns -m1 -e 'TODO' {} +"), "{script}");
        assert!(!script.contains("xargs"), "{script}");
    }
}
