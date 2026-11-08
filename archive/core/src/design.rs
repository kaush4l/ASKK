//! The design rules, enforced by structure (docs/design-rules.md). One token file — `design/tokens.json` — is the
//! single source of every spacing, type, radius, motion, colour, glass and background value. View trees and page
//! trees name scale steps only (gap 0–6, text xs–xl, tone names, size names, radius steps …): a raw value (px, rem,
//! hex, rgb(), a font name, a duration) anywhere in a tree is refused here, and the frontend maps steps → tokens.

use std::sync::OnceLock;

use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value, json};

/// The token file, compiled in.
pub const TOKENS_JSON: &str = include_str!("../../design/tokens.json");

pub fn tokens() -> &'static Value {
    static T: OnceLock<Value> = OnceLock::new();
    T.get_or_init(|| serde_json::from_str(TOKENS_JSON).expect("design/tokens.json parses"))
}

fn steps(group: &str) -> Vec<String> {
    tokens()[group].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default()
}

pub const TONES: [&str; 6] = ["neutral", "ok", "warn", "error", "busy", "accent"];
pub const TEXT: [&str; 5] = ["xs", "sm", "md", "lg", "xl"];
pub const CARD: [&str; 4] = ["icon", "small", "medium", "large"];
pub const EDGES: [&str; 4] = ["curve", "straight", "step", "none"];
/// The scale every gap / pad names: 0 … 6 (`--space-0` … `--space-6`).
pub const SPACE_MAX: i64 = 6;
/// A background field's place: `[x, y]`, each 0 … 8 (eighths of the page).
pub const PLACE_MAX: i64 = 8;

/// Token groups whose values are lengths, and the other typed groups.
const LENGTH_GROUPS: [&str; 12] = ["widget", "letter", "space", "text", "radius", "width", "control", "icon", "line", "field", "background", "breakpoint"];
const COLOR_MODES: [&str; 2] = ["light", "dark"];

// ── raw values ─────────────────────────────────────────────────────────────

const FONT_NAMES: [&str; 14] =
    ["serif", "sans-serif", "monospace", "system-ui", "ui-monospace", "arial", "helvetica", "georgia", "menlo", "amarante", "times", "courier", "inter", "roboto"];
const UNITS: [&str; 13] = ["px", "rem", "em", "vh", "vw", "vmax", "vmin", "dvh", "svh", "ch", "pt", "ms", "s"];

/// What raw value a string carries (a length, a colour, a duration, a font name), if any.
pub fn raw_value(s: &str) -> Option<&'static str> {
    let l = s.to_ascii_lowercase();
    for f in ["rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "oklab(", "color-mix(", "var(--", "calc("] {
        if l.contains(f) {
            return Some("a CSS colour or expression");
        }
    }
    let b = l.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'#' {
            let n = b[i + 1..].iter().take_while(|c| c.is_ascii_hexdigit()).count();
            if [3, 4, 6, 8].contains(&n) && b.get(i + 1 + n).is_none_or(|c| !c.is_ascii_alphanumeric()) {
                return Some("a hex colour");
            }
        }
        if b[i].is_ascii_digit() && (i == 0 || !b[i - 1].is_ascii_alphabetic()) {
            let mut j = i;
            while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'.') {
                j += 1;
            }
            if b.get(j) == Some(&b'%') {
                return Some("a percentage");
            }
            let k = b[j..].iter().take_while(|c| c.is_ascii_alphabetic()).count();
            let unit = &l[j..j + k];
            if k > 0 && UNITS.contains(&unit) {
                return Some(if unit == "ms" || unit == "s" { "a duration" } else { "a length" });
            }
            i = j.max(i + 1);
            continue;
        }
        i += 1;
    }
    let words: Vec<&str> = l.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')).filter(|w| !w.is_empty()).collect();
    if words.iter().any(|w| FONT_NAMES.contains(w)) && (l.contains(',') || words.len() == 1) {
        return Some("a font name");
    }
    None
}

// ── trees ──────────────────────────────────────────────────────────────────

/// Props whose value is content (what an object says), never a style: free text.
const CONTENT: [&str; 17] = ["scene", "default", "placeholder", "columns", "value", "label", "title", "question", "name", "action", "target", "of", "source", "image", "now", "args", "rows"];
/// Prop names that would carry a raw style: never allowed in a tree.
const FORBIDDEN: [&str; 12] = ["style", "class", "color", "background-color", "font", "font-family", "width", "height", "px", "duration", "margin", "padding"];

fn one_of(path: &str, key: &str, v: &Value, allowed: &[&str], what: &str) -> Result<()> {
    match v.as_str() {
        Some(s) if allowed.contains(&s) => Ok(()),
        _ => bail!("{path}: {key} {v} is not {what} (one of {})", allowed.join(", ")),
    }
}

fn one_of_owned(path: &str, key: &str, v: &Value, allowed: &[String], what: &str) -> Result<()> {
    let a: Vec<&str> = allowed.iter().map(String::as_str).collect();
    one_of(path, key, v, &a, what)
}

fn step(path: &str, key: &str, v: &Value, max: i64) -> Result<()> {
    match v.as_i64() {
        Some(n) if (0..=max).contains(&n) && v.as_f64() == Some(n as f64) => Ok(()),
        _ => bail!("{path}: {key} {v} is not a scale step (a whole number 0–{max})"),
    }
}

/// Colour names a tree may use: the tones and the colour tokens (`wall-a` …).
fn color_names() -> Vec<String> {
    let mut v: Vec<String> = TONES.iter().map(|s| s.to_string()).collect();
    v.extend(steps("light"));
    v
}

fn scan_strings(path: &str, key: &str, v: &Value) -> Result<()> {
    match v {
        Value::String(s) => match raw_value(s) {
            Some(what) => bail!("{path}: {key} \"{s}\" is {what}; trees name scale steps and tokens only (docs/design-rules.md)"),
            None => Ok(()),
        },
        Value::Array(a) => a.iter().try_for_each(|x| scan_strings(path, key, x)),
        Value::Object(m) => m.iter().try_for_each(|(k, x)| scan_strings(path, &format!("{key}.{k}"), x)),
        _ => Ok(()),
    }
}

fn check_background(path: &str, b: &Value) -> Result<()> {
    let Some(m) = b.as_object() else {
        return if b.is_null() { Ok(()) } else { bail!("{path}: background must be a map") };
    };
    for (k, v) in m {
        match k.as_str() {
            "image" => {}
            "wash" | "ripples" => {
                if !v.is_boolean() {
                    bail!("{path}: background.{k} must be true or false");
                }
            }
            "fit" => one_of(path, "background.fit", v, &["cover", "contain"], "a fit")?,
            "tint" => {
                if !v.is_null() {
                    one_of_owned(path, "background.tint", v, &color_names(), "a colour token")?
                }
            }
            "blur" | "dim" => step(path, &format!("background.{k}"), v, SPACE_MAX)?,
            "fields" => {
                let Some(fs) = v.as_array() else { bail!("{path}: background.fields must be a list") };
                for (i, f) in fs.iter().enumerate() {
                    let p = format!("{path}.background.fields[{i}]");
                    let Some(fm) = f.as_object() else { bail!("{p}: a field is a map {{at, size, color, hard}}") };
                    for (fk, fv) in fm {
                        match fk.as_str() {
                            "at" => match fv.as_array().map(Vec::as_slice) {
                                Some([x, y]) => {
                                    step(&p, "at[0]", x, PLACE_MAX)?;
                                    step(&p, "at[1]", y, PLACE_MAX)?
                                }
                                _ => bail!("{p}: at {fv} is not a place [x, y] (each 0–{PLACE_MAX})"),
                            },
                            "size" => one_of_owned(&p, "size", fv, &steps("field"), "a field size")?,
                            "color" => one_of_owned(&p, "color", fv, &color_names(), "a colour token")?,
                            "hard" => {
                                if !fv.is_boolean() {
                                    bail!("{p}: hard must be true or false");
                                }
                            }
                            other => bail!("{p}: unknown field prop {other}"),
                        }
                    }
                }
            }
            other => bail!("{path}: unknown background prop {other}"),
        }
    }
    Ok(())
}

fn check_props(path: &str, c: &str, props: &Map<String, Value>) -> Result<()> {
    for (k, v) in props {
        if FORBIDDEN.contains(&k.as_str()) {
            bail!("{path}: prop {k} carries a raw style; use the primitive's scale props (docs/design-rules.md)");
        }
        match (c, k.as_str()) {
            (_, "gap" | "pad") => step(path, k, v, SPACE_MAX)?,
            (_, "tone" | "light") => {
                if !v.is_null() {
                    one_of(path, k, v, &TONES, "a tone")?
                }
            }
            (_, "radius") => one_of_owned(path, k, v, &steps("radius"), "a radius step")?,
            ("Text", "size") => one_of(path, k, v, &TEXT, "a text size")?,
            ("CardGrid", "size") => {
                if v != "auto" {
                    one_of(path, k, v, &CARD, "a card size or auto")?
                }
            }
            (_, "size" | "at") if c != "Page" => one_of(path, k, v, &CARD, "a card size")?,
            ("Grid" | "CardGrid", "min" | "max") => one_of_owned(path, k, v, &steps("width"), "a width step")?,
            ("Stack", "dir") => one_of(path, k, v, &["row", "col"], "a direction")?,
            ("Stack", "align") => one_of(path, k, v, &["start", "center", "end", "between"], "an alignment")?,
            ("Field", "kind") => one_of(path, k, v, &["text", "number"], "a field kind")?,
            ("Canvas", "edges") => one_of(path, k, v, &EDGES, "an edge style")?,
            ("Canvas", "grid" | "minimap") | ("Composer", "phases") => {
                if !v.is_boolean() {
                    bail!("{path}: {k} must be true or false");
                }
            }
            ("Canvas", "zoom") => {
                let ok = v.as_object().is_some_and(|m| m.iter().all(|(z, n)| CARD.contains(&z.as_str()) && n.as_f64().is_some_and(|f| f > 0.0 && f <= 10.0)));
                if !ok {
                    bail!("{path}: zoom must map card sizes to zoom ratios (0–10], e.g. {{icon: 0.35}}");
                }
            }
            ("Page" | "Background", "background") => check_background(path, v)?,
            ("Background", _) => {
                let mut one = Map::new();
                one.insert(k.clone(), v.clone());
                check_background(path, &Value::Object(one))?
            }
            (_, "icon") => check_icon(v.as_str().unwrap_or("")).map_err(|e| anyhow!("{path}: {e}"))?,
            ("Avatar", "running" | "asks" | "failed") => {
                if !v.as_u64().is_some() {
                    bail!("{path}: {k} must be a count");
                }
            }
            (_, "children") => check_children(v).map_err(|e| anyhow!("{path}: {e}"))?,
            ("Card", "status") => {
                if let Some(m) = v.as_object() {
                    if let Some(l) = m.get("light") {
                        one_of(path, "status.light", l, &TONES, "a tone")?;
                    }
                }
            }
            (_, key) if CONTENT.contains(&key) => {}
            _ => scan_strings(path, k, v)?,
        }
    }
    Ok(())
}

fn walk(n: &Value, path: &str) -> Result<()> {
    let Some(m) = n.as_object() else { bail!("{path}: a node must be an object {{c, props, children}}") };
    let c = m.get("c").and_then(Value::as_str).ok_or_else(|| anyhow!("{path}: a node needs `c` (a primitive name)"))?;
    let here = format!("{path}/{c}");
    match m.get("props") {
        None => {}
        Some(Value::Object(p)) => check_props(&here, c, p)?,
        Some(_) => bail!("{here}: props must be a map"),
    }
    match m.get("children") {
        None => Ok(()),
        Some(Value::Array(k)) => k.iter().enumerate().try_for_each(|(i, x)| walk(x, &format!("{here}[{i}]"))),
        Some(_) => bail!("{here}: children must be a list"),
    }
}

/// A view tree or a page tree: structure plus the design rules (scale steps only, no raw values).
pub fn check_tree(tree: &Value) -> Result<()> {
    walk(tree, "")
}

// ── the theme ──────────────────────────────────────────────────────────────

fn is_length(s: &str) -> bool {
    let s = s.trim();
    let n = s.trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == '%');
    let unit = &s[n.len()..];
    !n.is_empty() && n.parse::<f64>().is_ok() && ["px", "rem", "em", "vmax", "vmin", "vh", "vw", "ch", "%"].contains(&unit)
}
fn is_color(s: &str) -> bool {
    let s = s.trim();
    let hex = s.strip_prefix('#').is_some_and(|h| [3, 4, 6, 8].contains(&h.len()) && h.chars().all(|c| c.is_ascii_hexdigit()));
    let func = ["rgb(", "hsl(", "oklch(", "oklab("].iter().any(|f| s.starts_with(f)) && s.ends_with(')')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || " .,%/()-".contains(c));
    hex || func
}

/// A theme is the token file's shape: the same groups and step names, each value of its group's type.
pub fn check_theme(theme: &Value) -> Result<()> {
    let Some(m) = theme.as_object() else { bail!("theme tokens must be an object") };
    let base = tokens().as_object().expect("tokens");
    for (g, v) in m {
        let Some(def) = base.get(g) else {
            bail!("theme: unknown token group {g} (one of {})", base.keys().cloned().collect::<Vec<_>>().join(", "))
        };
        let Some(vm) = v.as_object() else { bail!("theme: {g} must be a map of steps") };
        for (k, x) in vm {
            if def.get(k).is_none() {
                bail!("theme: {g}.{k} is not a step of {g} (one of {})", def.as_object().unwrap().keys().cloned().collect::<Vec<_>>().join(", "));
            }
            let Some(s) = x.as_str() else { bail!("theme: {g}.{k} must be a string") };
            if s.contains([';', '{', '}', '<', '>']) {
                bail!("theme: {g}.{k} holds a character a token may not");
            }
            let ok = if LENGTH_GROUPS.contains(&g.as_str()) {
                is_length(s)
            } else if g == "motion" {
                s.strip_suffix("ms").is_some_and(|n| n.parse::<u32>().is_ok_and(|n| n <= 2000))
            } else if g == "ease" {
                s.starts_with("cubic-bezier(") || ["ease", "ease-in", "ease-out", "ease-in-out", "linear"].contains(&s)
            } else if g == "font" {
                s.chars().all(|c| c.is_alphanumeric() || " ,\"'-".contains(c))
            } else if g == "glass" {
                if k == "blur" { is_length(s) } else { s.strip_suffix('%').is_some_and(|n| n.parse::<f64>().is_ok()) }
            } else if g == "span" {
                // columns and rows of a card size's footprint on the widget grid: "4 2"
                matches!(s.split_whitespace().map(|n| n.parse::<u8>().ok().filter(|n| (1..=8).contains(n))).collect::<Vec<_>>().as_slice(), [Some(_), Some(_)])
            } else if COLOR_MODES.contains(&g.as_str()) {
                is_color(s)
            } else {
                true
            };
            if !ok {
                bail!("theme: {g}.{k} \"{s}\" is not a valid {g} value");
            }
        }
    }
    Ok(())
}

/// The seeded theme: the token file itself.
pub fn default_theme() -> Value {
    tokens().clone()
}

/// An older flat theme (`radius: "10px"`, `face`, `blur` …) → the token shape, every missing step from the file.
pub fn migrate_theme(old: &Value) -> Value {
    let mut out = tokens().clone();
    let Some(m) = old.as_object() else { return out };
    let o = out.as_object_mut().unwrap();
    let mut put = |g: &str, k: &str, v: &Value| {
        if let (Some(s), Some(grp)) = (v.as_str(), o.get_mut(g).and_then(Value::as_object_mut))
            && grp.contains_key(k)
        {
            grp.insert(k.into(), json!(s));
        }
    };
    for (k, v) in m {
        match k.as_str() {
            "radius" if v.is_string() => put("radius", "md", v),
            "blur" => put("glass", "blur", v),
            "glass-alpha" => put("glass", "alpha", v),
            "card-alpha" => put("glass", "card", v),
            "face" => put("font", "face", v),
            "font" if v.is_string() => put("font", "body", v),
            "mono" => put("font", "mono", v),
            g => {
                if let Some(vm) = v.as_object() {
                    for (s, x) in vm {
                        put(g, s, x);
                    }
                }
            }
        }
    }
    if check_theme(&out).is_err() { tokens().clone() } else { out }
}

// ── migrating an older page tree ───────────────────────────────────────────

fn nearest(px: f64, group: &str, among: &[&str]) -> String {
    let t = tokens();
    among
        .iter()
        .filter_map(|k| t[group][*k].as_str().map(|v| (k, v)))
        .min_by(|a, b| {
            let d = |s: &str| (s.trim_end_matches(|c: char| c.is_ascii_alphabetic()).parse::<f64>().unwrap_or(0.0) - px).abs();
            d(a.1).total_cmp(&d(b.1))
        })
        .map(|(k, _)| k.to_string())
        .unwrap_or_else(|| "md".into())
}

fn num_in(s: &str) -> Vec<f64> {
    s.split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-')).filter_map(|x| x.parse().ok()).collect()
}

/// A tree written before the rules (raw px, %, vmax, hex) → the same tree in scale steps, nearest step each.
pub fn migrate_tree(n: &Value) -> Value {
    let mut n = n.clone();
    migrate_node(&mut n);
    n
}

fn migrate_node(n: &mut Value) {
    let c = n["c"].as_str().unwrap_or("").to_string();
    if let Some(p) = n.get_mut("props").and_then(Value::as_object_mut) {
        for k in ["gap", "pad"] {
            if let Some(g) = p.get(k).and_then(Value::as_f64) {
                p.insert(k.into(), json!((g.round() as i64).clamp(0, SPACE_MAX)));
            }
        }
        if c == "Grid" || c == "CardGrid" {
            for k in ["min", "max"] {
                if let Some(px) = p.get(k).and_then(Value::as_f64) {
                    p.insert(k.into(), json!(nearest(px, "width", &["xs", "sm", "md", "lg", "xl", "wide", "page"])));
                }
            }
        }
        if let Some(b) = p.get_mut("background") {
            migrate_background(b);
        }
        if c == "Canvas" {
            p.entry("grid").or_insert(json!(true));
            p.entry("minimap").or_insert(json!(true));
            p.entry("edges").or_insert(json!("curve"));
        }
    }
    if let Some(k) = n.get_mut("children").and_then(Value::as_array_mut) {
        k.iter_mut().for_each(migrate_node);
    }
}

fn migrate_background(b: &mut Value) {
    let Some(m) = b.as_object_mut() else { return };
    if let Some(px) = m.get("blur").and_then(Value::as_f64) {
        let s = nearest(px, "space", &["0", "1", "2", "3", "4", "5", "6"]);
        m.insert("blur".into(), json!(s.parse::<i64>().unwrap_or(0)));
    }
    if let Some(d) = m.get("dim").and_then(Value::as_f64)
        && d.fract() != 0.0
    {
        m.insert("dim".into(), json!(((d * 10.0).round() as i64).clamp(0, SPACE_MAX)));
    }
    if m.get("tint").and_then(Value::as_str).is_some_and(|s| raw_value(s).is_some()) {
        m.insert("tint".into(), Value::Null);
    }
    if let Some(fs) = m.get_mut("fields").and_then(Value::as_array_mut) {
        for f in fs.iter_mut() {
            let Some(fm) = f.as_object_mut() else { continue };
            if let Some(s) = fm.get("at").and_then(Value::as_str) {
                let v = num_in(s);
                let at = |i: usize| ((v.get(i).copied().unwrap_or(50.0) / 12.5).round() as i64).clamp(0, PLACE_MAX);
                fm.insert("at".into(), json!([at(0), at(1)]));
            }
            if let Some(s) = fm.get("size").and_then(Value::as_str)
                && raw_value(s).is_some()
            {
                let v = num_in(s).first().copied().unwrap_or(26.0);
                fm.insert("size".into(), json!(nearest(v, "field", &["sm", "md", "lg", "xl"])));
            }
        }
    }
}

/// A container's presentation defaults for its children (contract §6 "Cascade"): `{size?, kinds?: {<kind>: {size}}}`,
/// each size a card size. Anything else is refused.
pub fn check_children(v: &Value) -> Result<()> {
    let Some(m) = v.as_object() else { bail!("children must be a map {{size?, kinds?}}") };
    for (k, x) in m {
        match k.as_str() {
            "size" => one_of("children", "size", x, &CARD, "a card size")?,
            "kinds" => {
                let Some(km) = x.as_object() else { bail!("children.kinds must map a kind to {{size}}") };
                for (kind, d) in km {
                    let Some(dm) = d.as_object() else { bail!("children.kinds.{kind} must be {{size}}") };
                    for (dk, dv) in dm {
                        if dk != "size" {
                            bail!("children.kinds.{kind}: unknown prop {dk} (only size)");
                        }
                        one_of("children", &format!("kinds.{kind}.size"), dv, &CARD, "a card size")?;
                    }
                }
            }
            other => bail!("children: unknown prop {other} (size, kinds)"),
        }
    }
    Ok(())
}

/// The size a container's defaults give a child of `kind`, if any (per kind first).
pub fn child_size<'a>(d: Option<&'a Value>, kind: &str) -> Option<&'a str> {
    let d = d?;
    d["kinds"][kind]["size"].as_str().or_else(|| d["size"].as_str())
}

/// An avatar icon: one emoji / grapheme (no letters, digits or spaces; at most a few code points, as a flag or a
/// ZWJ sequence takes), or an image in the page assets (`/ui/assets/<name>`).
pub fn check_icon(s: &str) -> Result<()> {
    if let Some(name) = s.strip_prefix("/ui/assets/") {
        if !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
            return Ok(());
        }
        bail!("icon {s}: an asset is /ui/assets/<file name>");
    }
    let n = s.chars().count();
    let plain = s.chars().any(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || "<>;{}\"'`".contains(c));
    if n == 0 || n > 10 || plain || !s.chars().any(|c| (c as u32) > 0x2000) {
        bail!("icon \"{s}\" must be one emoji (e.g. 🧭) or /ui/assets/<image>");
    }
    Ok(())
}
