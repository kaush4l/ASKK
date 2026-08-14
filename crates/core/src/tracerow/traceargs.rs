//! WHAT A CALL WAS ASKED TO DO, as a person reads it. Split from `tracerow.rs`,
//! which owns the ROW — its time, its outcome word, its output block — so both
//! hold the 200-line rule (I12). A row's shape and an argument's rendering are
//! two subjects, and `inflight` wants only the second of them.

/// How much of one argument a row shows, at each END of it. Cut in the MIDDLE
/// and never at the tail: how a value ENDS is the evidence R14-P0-2 is about — a
/// write that swallowed this call's own closing delimiters — and a head-only cut
/// takes exactly the bytes that proved it off the screen.
const ARG_HEAD: usize = 40;
const ARG_TAIL: usize = 20;

/// ONE ARGUMENT, WITH ITS EDGES (R18-P2). Unquoted, a row read `write_file
/// contents=- Execute shell commands and manage files… path=notes.md` and
/// nothing said where `contents` ended; `contents= path=content.html` — an EMPTY
/// write — was indistinguishable from a value the row had not bothered to show.
/// So every value is quoted, whatever its type, `""` becomes a fact you can
/// read, and a control character becomes a space rather than taking the row
/// apart.
fn quoted(value: &str) -> String {
    let flat: String = value.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let len = flat.chars().count();
    if len <= ARG_HEAD + ARG_TAIL + 1 {
        return format!("\"{flat}\"");
    }
    let head: String = flat.chars().take(ARG_HEAD).collect();
    let tail: String = flat.chars().skip(len - ARG_TAIL).collect();
    format!("\"{head}…{tail}\"")
}

/// The arguments, as the person reading a log wants them. `exec` is the one
/// tool whose argument is itself a command line, so it is shown as one; any
/// other flat JSON object becomes `name="value"`, and anything else is passed
/// through verbatim — a trace that hides what was asked is not one.
pub(crate) fn said_args(tool: &str, args: &str) -> String {
    if tool == "exec" {
        return format!("$ {}", crate::scrollback::command_of(args));
    }
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(args) else {
        return format!("{tool}({args})");
    };
    let pairs: Vec<String> = map
        .iter()
        .map(|(k, v)| match v.as_str() {
            Some(text) => format!("{k}={}", quoted(text)),
            None => format!("{k}={}", quoted(&v.to_string())),
        })
        .collect();
    match pairs.is_empty() {
        true => format!("{tool}()"),
        false => format!("{tool} {}", pairs.join(" ")),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_command_reads_as_a_command_and_a_path_as_a_path() {
        let exec = super::said_args("exec", r#"{"command":"ls -la /"}"#);
        assert_eq!(exec, "$ ls -la /", "the JSON envelope is not the argument");
        let read = super::said_args("read_file", r#"{"path":"notes/today.md"}"#);
        assert_eq!(read, "read_file path=\"notes/today.md\"");
        // Not an object: shown as written rather than swallowed.
        assert_eq!(super::said_args("odd", "7"), "odd(7)");
    }

    #[test]
    fn a_value_has_edges_and_an_empty_one_is_visible() {
        let long = format!("START{}END", "x".repeat(200));
        let said = super::said_args("write_file", &format!(r#"{{"contents":"{long}","path":"a.md"}}"#));
        assert!(said.contains('…'), "a truncated value says so: {said}");
        // BOTH ENDS (R14-P0-2): how a value ends is the evidence.
        assert!(said.contains("\"START"), "the head is kept: {said}");
        assert!(said.contains("END\""), "the tail is kept: {said}");
        assert!(said.contains(" path=\"a.md\""), "the next key is still legible: {said}");
        let empty = super::said_args("write_file", r#"{"contents":"","path":"a.md"}"#);
        assert!(empty.contains("contents=\"\""), "an empty write reads as empty: {empty}");
        // A document in an argument does not take the row apart.
        let doc = super::said_args("write_file", r#"{"path":"a.md","contents":"one\ntwo"}"#);
        assert!(!doc.contains('\n'), "one call is one line: {doc}");
    }
}
