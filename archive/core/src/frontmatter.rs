//! The YAML subset an `.md` file's frontmatter is written in:
//! `key: value`, lists `[a, b]`, inline maps `{a: 1}`, numbers, bools, null, quoted strings.

use anyhow::{Result, bail};
use serde_json::{Map, Value, json};

/// One `.md` file: its frontmatter and its markdown body.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Doc {
    pub meta: Map<String, Value>,
    pub body: String,
}

pub fn parse(text: &str) -> Result<Doc> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    if lines.clone().next().map(str::trim_end) != Some("---") {
        return Ok(Doc { meta: Map::new(), body: text.trim().to_string() });
    }
    lines.next();
    let mut meta = Map::new();
    let mut closed = false;
    let mut n = 1;
    for line in lines.by_ref() {
        n += 1;
        if line.trim_end() == "---" {
            closed = true;
            break;
        }
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((key, value)) = t.split_once(':') else {
            bail!("frontmatter line {n}: expected `key: value`, got `{t}`");
        };
        let key = key.trim();
        if key.is_empty() {
            bail!("frontmatter line {n}: empty key");
        }
        meta.insert(key.to_string(), value_of(value)?);
    }
    if !closed {
        bail!("frontmatter is not closed with `---`");
    }
    let body: Vec<&str> = lines.collect();
    Ok(Doc { meta, body: body.join("\n").trim().to_string() })
}

/// One value of the subset.
pub fn value_of(s: &str) -> Result<Value> {
    let s = s.trim();
    if s.is_empty() || s == "null" || s == "~" {
        return Ok(Value::Null);
    }
    if let Some(inner) = s.strip_prefix('[') {
        let Some(inner) = inner.strip_suffix(']') else { bail!("unclosed list `{s}`") };
        return Ok(Value::Array(split_top(inner)?.iter().map(|p| value_of(p)).collect::<Result<_>>()?));
    }
    if let Some(inner) = s.strip_prefix('{') {
        let Some(inner) = inner.strip_suffix('}') else { bail!("unclosed map `{s}`") };
        let mut map = Map::new();
        for part in split_top(inner)? {
            let Some((k, v)) = part.split_once(':') else { bail!("map entry `{part}` needs `key: value`") };
            map.insert(unquote(k.trim()).to_string(), value_of(v)?);
        }
        return Ok(Value::Object(map));
    }
    if (s.starts_with('"') && s.ends_with('"') || s.starts_with('\'') && s.ends_with('\'')) && s.len() >= 2 {
        return Ok(json!(&s[1..s.len() - 1]));
    }
    match s {
        "true" => return Ok(json!(true)),
        "false" => return Ok(json!(false)),
        _ => {}
    }
    if let Ok(i) = s.parse::<i64>() {
        return Ok(json!(i));
    }
    if let Ok(f) = s.parse::<f64>()
        && f.is_finite()
    {
        return Ok(json!(f));
    }
    Ok(json!(s))
}

fn unquote(s: &str) -> &str {
    if s.len() >= 2 && (s.starts_with('"') && s.ends_with('"') || s.starts_with('\'') && s.ends_with('\'')) {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Split on commas outside brackets and quotes; empty input → no parts.
fn split_top(s: &str) -> Result<Vec<String>> {
    let mut parts = vec![];
    let (mut depth, mut quote, mut cur) = (0i32, None::<char>, String::new());
    for ch in s.chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(ch),
            (None, '[' | '{') => depth += 1,
            (None, ']' | '}') => depth -= 1,
            (None, ',') if depth == 0 => {
                parts.push(std::mem::take(&mut cur).trim().to_string());
                continue;
            }
            _ => {}
        }
        if depth < 0 {
            bail!("unbalanced brackets in `{s}`");
        }
        cur.push(ch);
    }
    if depth != 0 || quote.is_some() {
        bail!("unbalanced brackets or quotes in `{s}`");
    }
    if !cur.trim().is_empty() || !parts.is_empty() {
        parts.push(cur.trim().to_string());
    }
    Ok(parts)
}

/// Write a value back so `value_of` reads the same value.
pub fn render_value(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => {
            let plain = !s.is_empty()
                && !s.contains([',', ':', '[', ']', '{', '}', '#', '"', '\''])
                && s.trim() == s
                && matches!(value_of(s), Ok(Value::String(ref r)) if r == s);
            if plain { s.clone() } else { format!("\"{}\"", s.replace('"', "'")) }
        }
        Value::Array(a) => format!("[{}]", a.iter().map(render_value).collect::<Vec<_>>().join(", ")),
        Value::Object(m) => format!(
            "{{{}}}",
            m.iter().map(|(k, v)| format!("{k}: {}", render_value(v))).collect::<Vec<_>>().join(", ")
        ),
    }
}

/// A whole `.md` file: title, kind, order first, then the rest by name.
pub fn render(doc: &Doc) -> String {
    let mut out = String::from("---\n");
    let first = ["title", "kind", "order"];
    for k in first {
        if let Some(v) = doc.meta.get(k) {
            out.push_str(&format!("{k}: {}\n", render_value(v)));
        }
    }
    for (k, v) in &doc.meta {
        if !first.contains(&k.as_str()) {
            out.push_str(&format!("{k}: {}\n", render_value(v)));
        }
    }
    out.push_str("---\n");
    if !doc.body.is_empty() {
        out.push_str(&doc.body);
        out.push('\n');
    }
    out
}
