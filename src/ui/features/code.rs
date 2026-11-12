//! # Code: a program's text as coloured pieces
//!
//! A block of code in an answer is cut into pieces, each with a kind ([`Ink`]): a keyword, a
//! string, a comment, a number, a name. A UI gives each kind a colour of its own choosing.
//!
//! This is not a parser, on purpose: a page is a download, and a real highlighter weighs
//! more than the rest of the app. One small reader covers the six languages an agent writes
//! most (Rust, JavaScript and TypeScript, Python, JSON, shell, a diff). It knows a language's
//! keywords, how its comments and strings begin and end, and nothing else. Any other
//! language comes back as one plain piece.
//!
//! The pieces put together again are always the text that came in ([`inked`] loses nothing).
// The tab's own page shows code as plain text and uses none of this yet.
#![cfg_attr(feature = "local", allow(dead_code))]

/// What a piece of code is, for a UI to colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    Plain,
    Keyword,
    /// A string or a character.
    Text,
    Comment,
    Number,
    /// A name that stands out: a function being called, a type, a key, a variable of a shell.
    Name,
    /// A line a diff adds, takes away, or says where it is.
    Added,
    Removed,
    Meta,
}

impl Ink {
    /// The kind as one lowercase word (a style's name).
    pub fn key(self) -> &'static str {
        match self {
            Ink::Plain => "plain",
            Ink::Keyword => "keyword",
            Ink::Text => "text",
            Ink::Comment => "comment",
            Ink::Number => "number",
            Ink::Name => "name",
            Ink::Added => "added",
            Ink::Removed => "removed",
            Ink::Meta => "meta",
        }
    }
}

/// What the reader knows about a language.
struct Lang {
    keywords: &'static [&'static str],
    /// What begins a comment that ends with its line.
    line: &'static [&'static str],
    /// What begins and ends a comment that may span lines.
    block: Option<(&'static str, &'static str)>,
    /// The marks a string is written between.
    quotes: &'static [&'static str],
    /// A string followed by `:` is a key (JSON).
    keys: bool,
    /// `$name` is a variable (shell).
    dollars: bool,
    /// `'a` alone is not a string (a Rust lifetime).
    ticks: bool,
}

const RUST: Lang = Lang {
    keywords: &["as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &["\""],
    keys: false,
    dollars: false,
    ticks: true,
};
const JS: Lang = Lang {
    keywords: &["abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch", "class", "const", "continue", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "number", "of", "private", "public", "readonly", "return", "static", "string", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while", "yield"],
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &["\"", "'", "`"],
    keys: false,
    dollars: false,
    ticks: false,
};
const PYTHON: Lang = Lang {
    keywords: &["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"],
    line: &["#"],
    block: None,
    quotes: &["\"\"\"", "'''", "\"", "'"],
    keys: false,
    dollars: false,
    ticks: false,
};
const JSON: Lang = Lang { keywords: &["true", "false", "null"], line: &["//"], block: Some(("/*", "*/")), quotes: &["\""], keys: true, dollars: false, ticks: false };
const SHELL: Lang = Lang {
    keywords: &["case", "cd", "do", "done", "elif", "else", "esac", "exit", "export", "fi", "for", "function", "if", "in", "local", "return", "set", "source", "then", "until", "while"],
    line: &["#"],
    block: None,
    quotes: &["\"", "'"],
    keys: false,
    dollars: true,
    ticks: false,
};

/// The languages this reader knows, by the word after a fence. `None` for any other.
fn language(tag: &str) -> Option<&'static Lang> {
    Some(match tag.trim().to_ascii_lowercase().as_str() {
        "rust" | "rs" => &RUST,
        "js" | "jsx" | "mjs" | "cjs" | "javascript" | "ts" | "tsx" | "typescript" => &JS,
        "py" | "python" => &PYTHON,
        "json" | "jsonc" | "json5" => &JSON,
        "sh" | "bash" | "zsh" | "shell" | "console" => &SHELL,
        _ => return None,
    })
}

/// The name a person reads for a fence's word (`rs` is Rust); the word itself when unknown.
pub fn named(tag: &str) -> String {
    match tag.trim().to_ascii_lowercase().as_str() {
        "rust" | "rs" => "Rust".into(),
        "js" | "jsx" | "mjs" | "cjs" | "javascript" => "JavaScript".into(),
        "ts" | "tsx" | "typescript" => "TypeScript".into(),
        "py" | "python" => "Python".into(),
        "json" | "jsonc" | "json5" => "JSON".into(),
        "sh" | "bash" | "zsh" | "shell" | "console" => "Shell".into(),
        "diff" | "patch" => "Diff".into(),
        "" => "Text".into(),
        other => other.to_string(),
    }
}

/// Add a piece, joined to the piece before it when both are the same kind.
fn put(out: &mut Vec<(Ink, String)>, ink: Ink, text: &str) {
    if text.is_empty() {
        return;
    }
    match out.last_mut() {
        Some((last, t)) if *last == ink => t.push_str(text),
        _ => out.push((ink, text.to_string())),
    }
}

/// A diff, line by line.
fn diff(code: &str) -> Vec<(Ink, String)> {
    let mut out = vec![];
    for line in code.split_inclusive('\n') {
        let ink = match line {
            l if l.starts_with("+++") || l.starts_with("---") || l.starts_with("@@") || l.starts_with("diff ") || l.starts_with("index ") => Ink::Meta,
            l if l.starts_with('+') => Ink::Added,
            l if l.starts_with('-') => Ink::Removed,
            _ => Ink::Plain,
        };
        // Each line is a piece of its own, so a UI can colour the whole row.
        out.push((ink, line.to_string()));
    }
    out
}

/// How long the string that begins `rest` with the mark `q` is, its marks included. A string
/// of one line ends with its line when it is never closed.
fn string(rest: &str, q: &str) -> usize {
    let many = q.len() > 1 || q == "`";
    let mut i = q.len();
    while i < rest.len() {
        let tail = &rest[i..];
        if tail.starts_with('\\') {
            i += 1 + tail[1..].chars().next().map(char::len_utf8).unwrap_or(0);
        } else if tail.starts_with(q) {
            return i + q.len();
        } else if tail.starts_with('\n') && !many {
            return i;
        } else {
            i += tail.chars().next().map(char::len_utf8).unwrap_or(1);
        }
    }
    rest.len()
}

/// `code` cut into pieces by kind, for the language a fence names. The pieces joined again
/// are `code`.
pub fn inked(lang: &str, code: &str) -> Vec<(Ink, String)> {
    if matches!(lang.trim().to_ascii_lowercase().as_str(), "diff" | "patch") {
        return diff(code);
    }
    let Some(l) = language(lang) else {
        return vec![(Ink::Plain, code.to_string())];
    };
    let word = |c: char| c.is_alphanumeric() || c == '_';
    let mut out: Vec<(Ink, String)> = vec![];
    let mut i = 0;
    // Whether the last thing read was part of a word (so `a1` is one name, not a name and a number).
    let mut in_word = false;
    while i < code.len() {
        let rest = &code[i..];
        let Some(c) = rest.chars().next() else { break };
        let was_word = std::mem::replace(&mut in_word, false);
        // A shell's `#` begins a comment only at the start of a word (`$#` and `a#b` do not).
        let hash_ok = !l.dollars || !(was_word || code[..i].ends_with('$'));
        if let Some(start) = l.line.iter().find(|s| rest.starts_with(**s)).filter(|_| hash_ok) {
            let n = rest.find('\n').unwrap_or(rest.len()).max(start.len());
            put(&mut out, Ink::Comment, &rest[..n]);
            i += n;
        } else if let Some((open, close)) = l.block.filter(|(open, _)| rest.starts_with(open)) {
            let n = rest[open.len()..].find(close).map(|at| open.len() + at + close.len()).unwrap_or(rest.len());
            put(&mut out, Ink::Comment, &rest[..n]);
            i += n;
        } else if let Some(q) = l.quotes.iter().find(|q| rest.starts_with(**q)) {
            let n = string(rest, q);
            let key = l.keys && code[i + n..].trim_start().starts_with(':');
            put(&mut out, if key { Ink::Name } else { Ink::Text }, &rest[..n]);
            i += n;
        } else if l.ticks && c == '\'' {
            // 'x' or '\n' is a character; 'a alone is a lifetime and stays plain.
            let n = string(rest, "'");
            let inside = rest.get(1..n.saturating_sub(1)).unwrap_or_default();
            let is_char = n >= 3 && rest[..n].ends_with('\'') && (inside.chars().count() == 1 || inside.starts_with('\\'));
            let n = if is_char { n } else { 1 };
            put(&mut out, if is_char { Ink::Text } else { Ink::Plain }, &rest[..n]);
            i += n;
        } else if l.dollars && c == '$' && rest[1..].starts_with(|c: char| word(c) || c == '{') {
            let n = if rest[1..].starts_with('{') { rest.find('}').map(|at| at + 1).unwrap_or(rest.len()) } else { 1 + rest[1..].find(|c: char| !word(c)).unwrap_or(rest.len() - 1) };
            put(&mut out, Ink::Name, &rest[..n]);
            i += n;
        } else if c.is_ascii_digit() && !was_word {
            let n = rest.find(|c: char| !(word(c) || c == '.')).unwrap_or(rest.len());
            put(&mut out, Ink::Number, &rest[..n]);
            i += n;
        } else if word(c) || (c == '$' && !l.dollars) {
            let n = rest.find(|c: char| !(word(c) || c == '$')).unwrap_or(rest.len());
            let w = &rest[..n];
            let called = code[i + n..].starts_with('(') || code[i + n..].starts_with("!(");
            let ink = match () {
                _ if l.keywords.contains(&w) => Ink::Keyword,
                _ if called || (c.is_uppercase() && !l.dollars) => Ink::Name,
                _ => Ink::Plain,
            };
            put(&mut out, ink, w);
            in_word = true;
            i += n;
        } else {
            put(&mut out, Ink::Plain, &rest[..c.len_utf8()]);
            i += c.len_utf8();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pieces of one kind, in order.
    fn of(lang: &str, code: &str, ink: Ink) -> Vec<String> {
        inked(lang, code).into_iter().filter(|(i, _)| *i == ink).map(|(_, t)| t).collect()
    }

    #[test]
    fn the_pieces_put_together_are_the_text_that_came_in() {
        let samples = [
            ("rust", "fn main() {\n    let s: &'a str = \"hi \\\" there\"; // done\n    let c = '\\n'; /* open"),
            ("ts", "const f = async (x: number) => `a ${x} b\nc`; // é\n'unclosed"),
            ("python", "def f(x):\n    \"\"\"doc\nstring\"\"\"\n    return x # 1\n'''open"),
            ("json", "{\"a\": [1, 2.5, true, null], \"b\": \"c\\\"d\"}"),
            ("sh", "#!/bin/sh\nif [ \"$1\" = x ]; then echo ${HOME} $# 'q'; fi # end"),
            ("diff", "diff --git a b\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same"),
            ("cobol", "MOVE 1 TO X."),
            ("rust", ""),
            ("js", "日本語 = \"✓\""),
        ];
        for (lang, code) in samples {
            let back: String = inked(lang, code).into_iter().map(|(_, t)| t).collect();
            assert_eq!(back, code, "{lang}");
        }
        assert_eq!(inked("cobol", "MOVE 1"), [(Ink::Plain, "MOVE 1".to_string())], "an unknown language is one plain piece");
    }

    #[test]
    fn rust_has_keywords_strings_comments_numbers_and_names() {
        let code = "pub fn area(r: f64) -> f64 { // of a circle\n    let c = 'x'; let l: &'a str = \"π\";\n    Circle::new(r).area() * 3.14\n}";
        assert_eq!(of("rust", code, Ink::Keyword), ["pub", "fn", "let", "let"]);
        assert_eq!(of("rs", code, Ink::Comment), ["// of a circle"]);
        assert_eq!(of("rust", code, Ink::Text), ["'x'", "\"π\""], "a lifetime is not a string");
        assert_eq!(of("rust", code, Ink::Number), ["3.14"], "f64 is a name, not a number");
        assert_eq!(of("rust", code, Ink::Name), ["area", "Circle", "new", "area"]);
    }

    #[test]
    fn javascript_python_json_and_shell_each_read_their_own_way() {
        assert_eq!(of("ts", "const s = `a\nb`; /* x */ let t = 'c';", Ink::Text), ["`a\nb`", "'c'"], "a template spans lines");
        assert_eq!(of("js", "const s = 1; /* x\ny */", Ink::Comment), ["/* x\ny */"]);
        assert_eq!(of("python", "def f():\n    '''a\nb'''\n    return None # c", Ink::Keyword), ["def", "return", "None"]);
        assert_eq!(of("py", "x = '''a\nb''' # c", Ink::Text), ["'''a\nb'''"]);
        assert_eq!(of("json", "{\"k\": \"v\", \"n\": 2}", Ink::Name), ["\"k\"", "\"n\""], "a string before a colon is a key");
        assert_eq!(of("json", "{\"k\": \"v\", \"n\": 2}", Ink::Text), ["\"v\""]);
        assert_eq!(of("sh", "echo $HOME ${X} $# # note", Ink::Name), ["$HOME", "${X}"]);
        assert_eq!(of("bash", "echo $# a#b # note", Ink::Comment), ["# note"], "a # inside a word is not a comment");
        assert_eq!(of("sh", "if true; then exit 1; fi", Ink::Keyword), ["if", "then", "exit", "fi"]);
    }

    #[test]
    fn a_diff_is_coloured_by_line() {
        let d = inked("diff", "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same\n");
        let kinds: Vec<Ink> = d.iter().map(|(i, _)| *i).collect();
        assert_eq!(kinds, [Ink::Meta, Ink::Meta, Ink::Meta, Ink::Removed, Ink::Added, Ink::Plain]);
        assert_eq!((named("rs"), named("tsx"), named(""), named("zig")), ("Rust".to_string(), "TypeScript".to_string(), "Text".to_string(), "zig".to_string()));
    }
}
