//! Parsing model text into tool calls (Python `core/tools.py::parse_batches`).
//! Layout carries the schedule: calls on one line are one batch and run
//! together; a newline starts a new batch that runs after it. Pure, host-tested.

/// One parsed call. `args_error` carries WHY the arguments could not be read;
/// a typed field rather than the Python's `__arg_error__` sentinel key, so a
/// call with unreadable arguments is unrepresentable as a call with none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub tool: String,
    pub args_json: String,
    pub args_error: Option<String>,
}

/// Group every `name({...})` in model text into batches to run in order. A
/// newline between two calls starts a new batch; anything else (a comma, a
/// space) keeps them in the current one — splitting on the GAPS between calls
/// rather than on lines keeps a call whose JSON spans several lines whole.
pub fn parse_batches(text: &str) -> Vec<Vec<Call>> {
    let mut batches: Vec<Vec<Call>> = Vec::new();
    let (mut at, mut previous_end) = (0usize, 0usize);
    while let Some((start, end, call)) = next_call(text, at) {
        match batches.last_mut() {
            Some(last) if !text[previous_end..start].contains('\n') => last.push(call),
            _ => batches.push(vec![call]),
        }
        (at, previous_end) = (end, end);
    }
    batches
}

/// Whether this text holds any call at all — the difference between a reply
/// that acts and a reply that answers.
pub fn has_calls(text: &str) -> bool {
    next_call(text, 0).is_some()
}

/// The tools this reply calls, in order, with a run of the same name folded
/// into `write_file ×3`.
///
/// The transcript's notice for a reply that acts said only "calling tools" —
/// sometimes twice consecutively — while the tool trace one column right named
/// the tool, its arguments and its outcome (R5-20). The main column was less
/// informative than the sidebar about its own subject, and the names were
/// already parsed here: `has_calls` above is the guard on exactly that arm.
pub fn named(text: &str) -> Vec<String> {
    let mut out: Vec<(String, usize)> = Vec::new();
    for call in parse_batches(text).into_iter().flatten() {
        match out.last_mut() {
            Some((name, n)) if *name == call.tool => *n += 1,
            _ => out.push((call.tool, 1)),
        }
    }
    out.into_iter()
        .map(|(name, n)| match n {
            1 => name,
            n => format!("{name} ×{n}"),
        })
        .collect()
}

/// THE CALL'S OWN CLOSING TEXT, INSIDE AN ARGUMENT (R13-2).
///
/// `write_file({"path": "budget.csv", "contents": "\"item,cost\\ncoffee,4.50\
/// \\nrent,1800\\ninternet,60\"})"})` is strictly valid JSON and this parser is
/// right to accept it: `args_error` is `None`, `path` decodes cleanly, and
/// `contents` decodes to the fifty bytes `"item,cost\ncoffee,4.50\nrent,1800\
/// ninternet,60"})` — a leading quote, literal backslash-n where the newlines
/// should be, and the call's own `"})` on the end. The model escaped its
/// argument one level too many and swallowed its own terminator; the file on
/// disk was one line, `wc -l` said 0, and the `awk` that was to sum it printed
/// nothing. Measured in a browser against gemma-4-12B, and the same signature
/// is on record for `exec` (`failed.rs`: `$ "wc -l primes.txt"})`).
///
/// Nothing here can know an argument is WRONG, and this does not guess. It
/// reports the one thing the arguments themselves show: a string value ending
/// in the three bytes that end a call. The trace already renders those bytes on
/// screen — this is only the page reading what it is already displaying, so a
/// row cannot print `"})` and stamp `ok` beside it.
pub fn swallowed_close(args_json: &str) -> bool {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str(args_json) else {
        return false;
    };
    map.values()
        .filter_map(serde_json::Value::as_str)
        .any(|value| value.trim_end().ends_with("\"})"))
}

/// The next `name({...})` or `name()` at or after `from`, as (start, end, call).
fn next_call(text: &str, from: usize) -> Option<(usize, usize, Call)> {
    let b = text.as_bytes();
    let mut i = from;
    while i < b.len() {
        if !is_ident_start(b[i]) || (i > 0 && is_ident(b[i - 1])) {
            i += 1;
            continue;
        }
        let start = i;
        let mut j = i + 1;
        while j < b.len() && is_ident(b[j]) {
            j += 1;
        }
        match call_at(text, start, j) {
            Some(found) => return Some(found),
            None => i = j.max(i + 1),
        }
    }
    None
}

/// Parse the `( … )` that must follow the identifier in `text[start..name_end]`.
fn call_at(text: &str, start: usize, name_end: usize) -> Option<(usize, usize, Call)> {
    let b = text.as_bytes();
    let mut k = skip_ws(b, name_end);
    if k >= b.len() || b[k] != b'(' {
        return None;
    }
    k = skip_ws(b, k + 1);
    let (args, mut end) = match b.get(k) {
        Some(b'{') => {
            let close = scan_object(text, k)?;
            (&text[k..close], close)
        }
        _ => ("{}", k),
    };
    end = skip_ws(b, end);
    if b.get(end) != Some(&b')') {
        return None;
    }
    Some((
        start,
        end + 1,
        Call {
            tool: text[start..name_end].to_string(),
            args_json: args.to_string(),
            args_error: serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(args)
                .err()
                .map(|e| e.to_string()),
        },
    ))
}

/// The end of the JSON object opening at `open`, string- and nesting-aware.
/// (The Python regex stopped at the first `}`; a nested object was refused as
/// unreadable. Refusing an argument a real MCP tool would send is a bug, and
/// the refusal machinery below is unchanged either way.)
fn scan_object(text: &str, open: usize) -> Option<usize> {
    let b = text.as_bytes();
    let (mut depth, mut in_string, mut escaped) = (0i32, false, false);
    for (i, c) in b.iter().enumerate().skip(open) {
        match (in_string, escaped, *c) {
            (true, true, _) => escaped = false,
            (true, false, b'\\') => escaped = true,
            (true, false, b'"') => in_string = false,
            (true, false, _) => {}
            (false, _, b'"') => in_string = true,
            (false, _, b'{') => depth += 1,
            (false, _, b'}') => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

pub(crate) fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

pub(crate) fn is_ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_'
}

pub(crate) fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}
