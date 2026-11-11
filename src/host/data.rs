//! # Data: the user's own files, read as tables (server only)
//!
//! The personal place (`core/places.rs`: `<home>/personal`) holds what the user drops in:
//! `.csv` / `.tsv` files, `.json` files that are a list of records, and plain text. Engines
//! read them through three shared tools and never write there:
//!
//! | tool | args | answers |
//! | --- | --- | --- |
//! | `data_list` | — | every file: its kind, and for a table its columns and row count |
//! | `data_read` | `{file, rows?}` | a table's columns (type, range) and first rows; a text file's text |
//! | `data_query` | `{file, columns?, where?, group?, agg?, sort?, limit?}` | `{columns, rows, total}` |
//!
//! `where` is `"column op value"` (or a list of them, all must hold) with `=`, `!=`, `>`, `>=`,
//! `<`, `<=`, `contains`. `group` names a column; `agg` says what to work out per group:
//! `{"amount": "sum"}` (`sum`, `mean`, `min`, `max`, `count`), or nothing for a count.
//! `sort` is a column, `-column` for largest first.
//!
//! A figure's `from` is the same arguments ([`query`]), so a plot shows exactly what a query
//! answers.
use crate::core::figure::{number, word};
use crate::core::{tool, Tool};
use serde_json::{json, Map, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

/// Rows a figure may take.
pub const MAX_ROWS: usize = crate::core::tables::MAX_ROWS;
/// Rows a tool call answers with unless it asks for more (the answer goes into the prompt).
const SHOWN_ROWS: usize = 50;
const MAX_FILES: usize = 200;
const MAX_TEXT: usize = 6000;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Table {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

pub fn root() -> PathBuf {
    crate::core::places::personal()
}

/// `file` as a path inside `root`; it may not leave it.
fn inside(root: &Path, file: &str) -> Result<PathBuf, String> {
    let rel = Path::new(file.trim());
    if file.trim().is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("'{file}' is not a file in the data folder (see data_list)"));
    }
    let p = root.join(rel);
    if !p.is_file() {
        return Err(format!("no data file '{file}' (see data_list)"));
    }
    Ok(p)
}

fn ext(file: &str) -> String {
    Path::new(file).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Separated text as records: quotes hold separators and line breaks, `""` is a quote.
/// `personal/bindings.json`: the values that fill the holes in recipes, by engine path. None
/// written yet is an empty map.
pub fn bindings() -> Result<Map<String, Value>, String> {
    let p = crate::core::places::personal().join("bindings.json");
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("{}: {e}", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}

pub fn records(text: &str, sep: char) -> Vec<Vec<String>> {
    let (mut out, mut row, mut cell) = (vec![], vec![], String::new());
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == sep && !quoted => row.push(std::mem::take(&mut cell)),
            '\r' if !quoted => {}
            '\n' if !quoted => {
                row.push(std::mem::take(&mut cell));
                out.push(std::mem::take(&mut row));
            }
            c => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        out.push(row);
    }
    out.retain(|r| r.iter().any(|c| !c.trim().is_empty()));
    out
}

/// A cell as a value: a number when it reads as one, else its text.
fn cell(s: &str) -> Value {
    let t = s.trim();
    match t.parse::<f64>() {
        Ok(n) if n.is_finite() && !t.is_empty() => serde_json::Number::from_f64(n).map(|x| if n.fract() == 0.0 && n.abs() < 9e15 { json!(n as i64) } else { Value::Number(x) }).unwrap_or(Value::Null),
        _ => Value::String(t.to_string()),
    }
}

/// A file's text as a table, by its extension.
pub fn table(file: &str, text: &str) -> Result<Table, String> {
    match ext(file).as_str() {
        e @ ("csv" | "tsv") => {
            let mut recs = records(text, if e == "tsv" { '\t' } else { ',' }).into_iter();
            let columns: Vec<String> = recs.next().ok_or_else(|| format!("{file} is empty"))?.iter().map(|c| c.trim().to_string()).collect();
            let rows = recs.map(|r| (0..columns.len()).map(|i| r.get(i).map(|c| cell(c)).unwrap_or(Value::Null)).collect()).collect();
            Ok(Table { columns, rows })
        }
        "json" => {
            let v: Value = serde_json::from_str(text).map_err(|e| format!("{file}: {e}"))?;
            let list = v.as_array().ok_or_else(|| format!("{file} is not a list of records (data_read shows its text)"))?;
            let mut columns: Vec<String> = vec![];
            for o in list.iter().filter_map(|o| o.as_object()) {
                for k in o.keys().filter(|k| !columns.contains(k)).cloned().collect::<Vec<_>>() {
                    columns.push(k);
                }
            }
            if columns.is_empty() {
                return Err(format!("{file} holds no records (a list of objects is a table)"));
            }
            let flat = |v: &Value| if v.is_object() || v.is_array() { Value::String(v.to_string()) } else { v.clone() };
            let rows = list.iter().filter_map(|o| o.as_object()).map(|o| columns.iter().map(|c| o.get(c).map(flat).unwrap_or(Value::Null)).collect()).collect();
            Ok(Table { columns, rows })
        }
        _ => Err(format!("{file} is not a table (csv, tsv or a json list); data_read shows its text")),
    }
}

pub fn load(root: &Path, file: &str) -> Result<Table, String> {
    let p = inside(root, file)?;
    table(file, &std::fs::read_to_string(&p).map_err(|e| format!("{file}: {e}"))?)
}

/// `"amount >= 10"` → (`amount`, `>=`, `10`).
fn condition(c: &str) -> Result<(String, &'static str, String), String> {
    const OPS: [&str; 7] = [" contains ", ">=", "<=", "!=", "=", ">", "<"];
    let at = OPS.iter().filter_map(|op| c.find(op).map(|i| (i, *op))).min_by_key(|(i, op)| (*i, usize::MAX - op.len()));
    let (i, op) = at.ok_or_else(|| format!("where '{c}': write column, then one of = != > >= < <= contains, then a value"))?;
    let clean = |s: &str| s.trim().trim_matches(|q| q == '"' || q == '\'').to_string();
    Ok((clean(&c[..i]), op, clean(&c[i + op.len()..])))
}

fn holds(v: &Value, op: &str, want: &str) -> bool {
    let (a, b) = (number(v), want.parse::<f64>().ok());
    let text = word(v);
    match (op, a, b) {
        (" contains ", _, _) => text.to_lowercase().contains(&want.to_lowercase()),
        ("=", Some(a), Some(b)) => a == b,
        ("!=", Some(a), Some(b)) => a != b,
        (">", Some(a), Some(b)) => a > b,
        (">=", Some(a), Some(b)) => a >= b,
        ("<", Some(a), Some(b)) => a < b,
        ("<=", Some(a), Some(b)) => a <= b,
        ("=", _, _) => text == want,
        ("!=", _, _) => text != want,
        (">", _, _) => text.as_str() > want,
        (">=", _, _) => text.as_str() >= want,
        ("<", _, _) => text.as_str() < want,
        ("<=", _, _) => text.as_str() <= want,
        _ => false,
    }
}

fn names(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

fn num(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9e15 { json!(n as i64) } else { json!((n * 1e6).round() / 1e6) }
}

/// Answer a query over one table; at most `limit` rows (the query's own `limit`, else
/// `default_limit`), and `total` says how many there were.
pub fn query_table(file: &str, t: Table, args: &Value, default_limit: usize) -> Result<Value, String> {
    let at = |cols: &[String], name: &str| cols.iter().position(|c| c == name).ok_or_else(|| format!("no column '{name}' in {file} (columns: {})", cols.join(", ")));
    let Table { mut columns, mut rows } = t;
    for c in names(&args["where"]) {
        let (name, op, want) = condition(&c)?;
        let i = at(&columns, &name)?;
        rows.retain(|r| holds(&r[i], op, &want));
    }
    if let Some(g) = args["group"].as_str().filter(|g| !g.is_empty()) {
        let gi = at(&columns, g)?;
        let aggs: Vec<(usize, String, String)> = match &args["agg"] {
            Value::Object(m) => m.iter().map(|(c, f)| Ok((at(&columns, c)?, c.clone(), f.as_str().unwrap_or("sum").to_string()))).collect::<Result<_, String>>()?,
            _ => vec![],
        };
        if let Some((_, c, f)) = aggs.iter().find(|(_, _, f)| !["sum", "mean", "min", "max", "count"].contains(&f.as_str())) {
            return Err(format!("agg '{f}' for {c}: one of sum, mean, min, max, count"));
        }
        let mut groups: Vec<(String, Value, Vec<&Vec<Value>>)> = vec![];
        for r in &rows {
            let key = word(&r[gi]);
            match groups.iter_mut().find(|(k, _, _)| *k == key) {
                Some(g) => g.2.push(r),
                None => groups.push((key, r[gi].clone(), vec![r])),
            }
        }
        let out: Vec<Vec<Value>> = groups
            .iter()
            .map(|(_, key, rs)| {
                let mut row = vec![key.clone()];
                if aggs.is_empty() {
                    row.push(json!(rs.len()));
                }
                for (i, _, f) in &aggs {
                    let ns: Vec<f64> = rs.iter().filter_map(|r| number(&r[*i])).collect();
                    row.push(match f.as_str() {
                        "count" => json!(rs.len()),
                        _ if ns.is_empty() => Value::Null,
                        "sum" => num(ns.iter().sum()),
                        "mean" => num(ns.iter().sum::<f64>() / ns.len() as f64),
                        "min" => num(ns.iter().cloned().fold(f64::INFINITY, f64::min)),
                        _ => num(ns.iter().cloned().fold(f64::NEG_INFINITY, f64::max)),
                    });
                }
                row
            })
            .collect();
        columns = std::iter::once(g.to_string()).chain(if aggs.is_empty() { vec!["count".to_string()] } else { aggs.iter().map(|(_, c, _)| c.clone()).collect() }).collect();
        rows = out;
    } else {
        // What to keep: `columns`, else a plot's `x` and `y`, else everything.
        let mut keep = names(&args["columns"]);
        if keep.is_empty() {
            keep = names(&args["x"]).into_iter().chain(names(&args["y"])).collect();
        }
        if !keep.is_empty() {
            let idx: Vec<usize> = keep.iter().map(|c| at(&columns, c)).collect::<Result<_, _>>()?;
            rows = rows.into_iter().map(|r| idx.iter().map(|i| r[*i].clone()).collect()).collect();
            columns = keep;
        }
    }
    if let Some(s) = args["sort"].as_str().filter(|s| !s.is_empty()) {
        let (name, down) = match s.strip_prefix('-') {
            Some(n) => (n, true),
            None => (s, false),
        };
        let i = at(&columns, name.trim())?;
        rows.sort_by(|a, b| {
            let o = match (number(&a[i]), number(&b[i])) {
                (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
                _ => word(&a[i]).cmp(&word(&b[i])),
            };
            if down { o.reverse() } else { o }
        });
    }
    let total = rows.len();
    let limit = args["limit"].as_u64().map(|n| n as usize).unwrap_or(default_limit).clamp(1, MAX_ROWS);
    rows.truncate(limit);
    Ok(json!({"columns": columns, "rows": rows, "total": total}))
}

pub fn query(root: &Path, args: &Value, default_limit: usize) -> Result<Value, String> {
    let file = args["file"].as_str().ok_or("file missing (see data_list)")?;
    query_table(file, load(root, file)?, args, default_limit)
}

/// Every file under `root` (three folders deep), as paths relative to it.
fn files(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || out.len() >= MAX_FILES {
                continue;
            }
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if e.path().is_dir() {
                if depth < 3 {
                    walk(&e.path(), &path, depth + 1, out);
                }
            } else {
                out.push(path);
            }
        }
    }
    let mut out = vec![];
    walk(root, "", 1, &mut out);
    out
}

/// One column in a few words: its type and range.
fn describe(t: &Table, i: usize) -> String {
    let vals: Vec<&Value> = t.rows.iter().map(|r| &r[i]).filter(|v| !v.is_null() && v.as_str() != Some("")).collect();
    let nums: Vec<f64> = vals.iter().filter_map(|v| if v.is_number() { number(v) } else { None }).collect();
    if !vals.is_empty() && nums.len() == vals.len() {
        let (lo, hi) = nums.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), n| (l.min(*n), h.max(*n)));
        format!("number, {} to {}, mean {}", word(&num(lo)), word(&num(hi)), word(&num(nums.iter().sum::<f64>() / nums.len() as f64)))
    } else {
        let mut distinct: Vec<String> = vec![];
        for v in &vals {
            let w = word(v);
            if !distinct.contains(&w) {
                distinct.push(w);
            }
        }
        let first: Vec<&str> = distinct.iter().take(4).map(|s| s.as_str()).collect();
        format!("text, {} distinct ({}{})", distinct.len(), first.join(", "), if distinct.len() > 4 { ", …" } else { "" })
    }
}

/// The three data tools over `root`.
pub fn tools(root: PathBuf) -> Vec<Arc<dyn Tool>> {
    let (r1, r2, r3) = (root.clone(), root.clone(), root);
    vec![
        tool("data_list", "the user's own data files: each with its kind, and a table's columns and row count", Value::Null, move |_| {
            let list: Vec<String> = files(&r1)
                .into_iter()
                .map(|f| match load(&r1, &f) {
                    Ok(t) => format!("- {f}: table, {} rows, columns: {}", t.rows.len(), t.columns.join(", ")),
                    Err(_) => format!("- {f}: {}", if ["md", "txt", "log", "json"].contains(&ext(&f).as_str()) { "text" } else { "not readable as data" }),
                })
                .collect();
            Ok(json!(if list.is_empty() { format!("no data files yet (the user puts csv, json or text files in {})", r1.display()) } else { list.join("\n") }))
        }),
        tool("data_read", "look at one data file: a table's columns (type, range) and first rows, or a text file's text", json!({"file": "from data_list", "rows": "?how many first rows, default 8"}), move |a| {
            let file = a["file"].as_str().ok_or("file missing (see data_list)")?;
            match load(&r2, file) {
                Ok(t) => {
                    let n = a["rows"].as_u64().unwrap_or(8).min(100) as usize;
                    let cols: Vec<String> = t.columns.iter().enumerate().map(|(i, c)| format!("- {c}: {}", describe(&t, i))).collect();
                    let head: Vec<String> = t.rows.iter().take(n).map(|r| r.iter().map(word).collect::<Vec<_>>().join(" | ")).collect();
                    Ok(json!(format!("{file}: {} rows\ncolumns:\n{}\nfirst rows ({}):\n{}", t.rows.len(), cols.join("\n"), t.columns.join(" | "), head.join("\n"))))
                }
                Err(e) if e.contains("not a table") || e.contains("not a list") => {
                    let text = std::fs::read_to_string(inside(&r2, file)?).map_err(|e| format!("{file}: {e}"))?;
                    Ok(json!(if text.chars().count() > MAX_TEXT { format!("{}… (cut)", text.chars().take(MAX_TEXT).collect::<String>()) } else { text }))
                }
                Err(e) => Err(e),
            }
        }),
        tool(
            "data_query",
            "rows of a data file: pick columns, filter (where), group and work out sums or means (group + agg), sort, limit. A figure's from takes the same arguments",
            json!({"file": "from data_list", "columns": ["?names"], "where": "?\"column op value\" or a list; op is = != > >= < <= contains", "group": "?column", "agg": {"?column": "sum|mean|min|max|count"}, "sort": "?column, -column for largest first", "limit": "?rows, default 50"}),
            move |a| {
                let mut out = query(&r3, &a, SHOWN_ROWS)?;
                let (shown, total) = (out["rows"].as_array().map_or(0, Vec::len), out["total"].as_u64().unwrap_or(0) as usize);
                if shown < total {
                    out.as_object_mut().map(|o: &mut Map<String, Value>| o.insert("note".into(), json!(format!("first {shown} of {total} rows; a figure with this as its from shows up to {MAX_ROWS}"))));
                }
                Ok(out)
            },
        ),
    ]
}

/// The user's data folder, as the core's [`crate::core::tables::Tables`] port.
pub struct Personal;

impl crate::core::tables::Tables for Personal {
    fn query(&self, q: &Value, limit: usize) -> Result<Value, String> {
        query(&root(), q, limit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Toolbox;

    const CSV: &str = "day,kind,amount,note\n2026-11-01,food,12.5,\"lunch, with tip\"\n2026-11-01,travel,40,bus\n2026-11-02,food,7,\"said \"\"hi\"\"\"\n2026-11-03,food,,nothing\n";

    fn t() -> Table {
        table("spend.csv", CSV).unwrap()
    }

    #[test]
    fn separated_text_is_read_with_quotes_and_typed_cells() {
        let t = t();
        assert_eq!(t.columns, ["day", "kind", "amount", "note"]);
        assert_eq!(t.rows[0], vec![json!("2026-11-01"), json!("food"), json!(12.5), json!("lunch, with tip")]);
        assert_eq!(t.rows[1][2], json!(40), "a whole number stays whole");
        assert_eq!(t.rows[2][3], json!("said \"hi\""));
        assert_eq!(t.rows[3][2], json!(""), "an empty cell is empty, not zero");
        let j = table("x.json", r#"[{"a": 1, "b": "x"}, {"a": 2, "c": [1]}]"#).unwrap();
        assert_eq!((j.columns.clone(), j.rows[1].clone()), (vec!["a".to_string(), "b".into(), "c".into()], vec![json!(2), Value::Null, json!("[1]")]));
        assert!(table("x.json", r#"{"a": 1}"#).unwrap_err().contains("not a list"));
        assert!(table("x.md", "# hi").unwrap_err().contains("not a table"));
    }

    #[test]
    fn a_query_filters_groups_sorts_and_limits() {
        let q = |args: Value| query_table("spend.csv", t(), &args, 50).unwrap();
        let food = q(json!({"where": "kind = food", "columns": ["day", "amount"]}));
        assert_eq!(food["columns"], json!(["day", "amount"]));
        assert_eq!(food["total"], 3);
        assert_eq!(q(json!({"where": ["kind = food", "amount > 10"]}))["total"], 1);
        assert_eq!(q(json!({"where": "note contains LUNCH"}))["total"], 1);
        let by = q(json!({"group": "kind", "agg": {"amount": "sum"}, "sort": "-amount"}));
        assert_eq!(by["columns"], json!(["kind", "amount"]));
        assert_eq!(by["rows"], json!([["travel", 40], ["food", 19.5]]), "largest first; a gap is not a number");
        assert_eq!(q(json!({"group": "day"}))["rows"], json!([["2026-11-01", 2], ["2026-11-02", 1], ["2026-11-03", 1]]), "no agg: a count, groups in the order met");
        let lim = q(json!({"sort": "amount", "limit": 2}));
        assert_eq!((lim["rows"].as_array().unwrap().len(), lim["total"].as_u64()), (2, Some(4)));
        // A plot's `from` is the same arguments: x and y pick the columns.
        assert_eq!(q(json!({"x": "day", "y": ["amount"]}))["columns"], json!(["day", "amount"]));
        let err = |args: Value| query_table("spend.csv", t(), &args, 50).unwrap_err();
        assert!(err(json!({"columns": ["nope"]})).contains("no column 'nope' in spend.csv (columns: day, kind, amount, note)"));
        assert!(err(json!({"where": "amount is big"})).contains("one of ="));
        assert!(err(json!({"group": "kind", "agg": {"amount": "median"}})).contains("one of sum"));
    }

    #[tokio::test]
    async fn the_tools_read_the_personal_place_and_never_leave_it() {
        let root = std::env::temp_dir().join(format!("askk-data-{}", std::process::id()));
        std::fs::create_dir_all(root.join("money")).unwrap();
        std::fs::write(root.join("money/spend.csv"), CSV).unwrap();
        std::fs::write(root.join("about.md"), "# me\nI like maps.").unwrap();
        let tb = Toolbox::new(tools(root.clone()));
        let list = tb.call("data_list", json!({})).await.unwrap();
        let list = list.as_str().unwrap();
        assert!(list.contains("- money/spend.csv: table, 4 rows, columns: day, kind, amount, note") && list.contains("- about.md: text"), "{list}");
        let read = tb.call("data_read", json!({"file": "money/spend.csv", "rows": 1})).await.unwrap();
        let read = read.as_str().unwrap();
        assert!(read.contains("- amount: number, 7 to 40, mean 19.8333") && read.contains("- kind: text, 2 distinct (food, travel)"), "{read}");
        assert!(read.ends_with("2026-11-01 | food | 12.5 | lunch, with tip"), "{read}");
        assert_eq!(tb.call("data_read", json!({"file": "about.md"})).await.unwrap(), json!("# me\nI like maps."));
        let q = tb.call("data_query", json!({"file": "money/spend.csv", "limit": 1})).await.unwrap();
        assert!(q["note"].as_str().unwrap().contains("first 1 of 4 rows"));
        for bad in ["../secret.csv", "/etc/hosts", "money/../../x.csv", ""] {
            assert!(tb.call("data_query", json!({"file": bad})).await.is_err(), "{bad} must be refused");
        }
        assert!(tb.call("data_read", json!({"file": "nope.csv"})).await.unwrap_err().contains("no data file"));
        let _ = std::fs::remove_dir_all(root);
    }
}
