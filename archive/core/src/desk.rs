//! The desk: the engines root folder's own settings. A model library (`<engines root>/models/<slug>.md`,
//! frontmatter `name: <the provider's model id>`, `config: {connector, base_url?, key_env?, context?}`;
//! older files with `title` / `config.id` still load, id → name) and
//! `<engines root>/desk.md` (`model: <slug>`, the desk default). Neither is an engine: the loader only
//! takes folders holding an `engine.md`.
//!
//! Which model an engine calls, first match wins: its own `kind: model` element (back-compat) →
//! its engine.md `model:` (a library slug, or an inline config map) → the desk default → the
//! built-in echo. Keys are never stored: a model names only `key_env`, the env var holding it.

use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value, json};

use crate::connector::ModelSpec;
use crate::engine::EngineNode;
use crate::{Store, frontmatter};

pub const DESK_FILE: &str = "engines/desk.md";
pub const MODELS_DIR: &str = "engines/models";
/// The fields a model config may hold (`id` only inline in engine.md / a `kind: model` element;
/// a library model carries its id as `name`).
pub const FIELDS: [&str; 5] = ["connector", "id", "base_url", "key_env", "context"];

/// One library model, as read from `models/<slug>.md`.
#[derive(Debug, Clone, PartialEq)]
pub struct LibModel {
    pub slug: String,
    /// The provider's model id (`default` with claude-cli: the CLI's own default, no `--model`).
    pub name: String,
    /// {connector, base_url?, key_env?, context?} — never `id`.
    pub config: Map<String, Value>,
}

impl LibModel {
    /// What a connector reads: the config, with `name` as the model id.
    pub fn spec(&self) -> ModelSpec {
        let mut s = ModelSpec::from_config(&self.config);
        s.id = if s.connector == "claude-cli" && self.name == "default" { String::new() } else { self.name.clone() };
        s
    }
}

/// A file name for a model name: lowercase letters, digits and dashes.
pub fn slug_of(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "model".into() } else { out }
}

/// The library, the default, the files that failed to read, and usage (calls, last, test) by slug.
#[derive(Debug, Clone, Default)]
pub struct Desk {
    pub default: Option<String>,
    pub models: Vec<LibModel>,
    pub errors: Vec<String>,
    /// `{slug: {calls, last, test}}`, kept in `state/desk-models.json` (no engine is named that).
    pub usage: Value,
}

pub const USAGE: (&str, &str) = ("state", "desk-models");

/// Where an engine's model came from.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Resolved {
    /// The library slug, when the model is one.
    pub slug: Option<String>,
    pub title: String,
    /// element | engine | desk | builtin
    pub source: &'static str,
    pub spec: ModelSpec,
    /// The `kind: model` element's id when source is `element`: calls are recorded there.
    pub element: Option<String>,
    /// Why a named model was skipped (an unknown slug, a bad inline map).
    pub warning: Option<String>,
}

impl Desk {
    pub fn find(&self, slug: &str) -> Option<&LibModel> {
        self.models.iter().find(|m| m.slug == slug)
    }
    pub fn name_of(&self, slug: &str) -> String {
        self.find(slug).map(|m| m.name.clone()).unwrap_or_else(|| slug.to_string())
    }
    /// Library names already saved for this connector and base_url (blank = none).
    pub fn names_for(&self, connector: &str, base_url: Option<&str>) -> Vec<String> {
        let norm = |u: Option<&str>| u.map(|u| u.trim().trim_end_matches('/').to_string()).filter(|u| !u.is_empty());
        let want = norm(base_url);
        self.models
            .iter()
            .filter(|m| m.config.get("connector").and_then(Value::as_str) == Some(connector) && norm(m.config.get("base_url").and_then(Value::as_str)) == want)
            .map(|m| m.name.clone())
            .collect()
    }
}

/// Read the desk from the store. A broken model file is skipped and named in `errors`.
pub fn load(store: &dyn Store) -> Result<Desk> {
    let mut d = Desk::default();
    if let Some(text) = store.read_text(DESK_FILE)? {
        match frontmatter::parse(&text) {
            Ok(doc) => d.default = doc.meta.get("model").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from),
            Err(e) => d.errors.push(format!("{DESK_FILE}: {e:#}")),
        }
    }
    for slug in store.files(MODELS_DIR, "md")? {
        let file = format!("{MODELS_DIR}/{slug}.md");
        let Some(text) = store.read_text(&file)? else {
            continue;
        };
        match frontmatter::parse(&text) {
            Ok(doc) => {
                let mut config = doc.meta.get("config").and_then(Value::as_object).cloned().unwrap_or_default();
                // older files: `config.id` is the name; with neither, claude-cli means its default
                let old_id = config.remove("id").and_then(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from));
                let fallback = if config.get("connector").and_then(Value::as_str) == Some("claude-cli") { "default".to_string() } else { slug.clone() };
                let name = doc.meta.get("name").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from).or(old_id).unwrap_or(fallback);
                d.models.push(LibModel { name, config, slug })
            }
            Err(e) => d.errors.push(format!("{file}: {e:#}")),
        }
    }
    d.models.sort_by(|a, b| a.slug.cmp(&b.slug));
    d.usage = store.read(USAGE.0, USAGE.1)?.filter(Value::is_object).unwrap_or_else(|| json!({}));
    Ok(d)
}

/// A folder from before the desk existed (no desk.md, no models/): give it the seed's.
pub fn seed_missing(store: &dyn Store) -> Result<()> {
    if store.read_text(DESK_FILE)?.is_some() || !store.files(MODELS_DIR, "md")?.is_empty() {
        return Ok(());
    }
    for (path, text) in crate::seed::FILES.iter() {
        if *path == DESK_FILE || path.starts_with(&format!("{MODELS_DIR}/")) {
            store.write_text(path, text)?;
        }
    }
    Ok(())
}

pub fn builtin() -> Resolved {
    Resolved {
        slug: None,
        title: "Echo (built in)".into(),
        source: "builtin",
        spec: ModelSpec { connector: "echo".into(), id: "echo".into(), context: 12_000, ..Default::default() },
        element: None,
        warning: None,
    }
}

/// The model an engine calls (see the module doc for the order).
pub fn resolve(eng: &EngineNode, desk: &Desk) -> Resolved {
    if let Some(m) = crate::run::first(eng, "model") {
        return Resolved { slug: None, title: m.title.clone(), source: "element", spec: ModelSpec::from_config(&m.config), element: Some(m.id.clone()), warning: None };
    }
    let mut warning = None;
    match eng.obj.config.get("model") {
        Some(Value::String(s)) if !s.trim().is_empty() => match desk.find(s.trim()) {
            Some(m) => return library(m, "engine"),
            None => warning = Some(format!("engine.md names model {s}, which is not in the library; using the desk default")),
        },
        Some(Value::Object(c)) => match check_config(c, None) {
            Ok(c) => {
                return Resolved { slug: None, title: "inline".into(), source: "engine", spec: ModelSpec::from_config(&c), element: None, warning: None };
            }
            Err(e) => warning = Some(format!("engine.md model: {e:#}; using the desk default")),
        },
        _ => {}
    }
    let mut r = match desk.default.as_deref().and_then(|s| desk.find(s)) {
        Some(m) => library(m, "desk"),
        None => builtin(),
    };
    r.warning = warning;
    r
}

fn library(m: &LibModel, source: &'static str) -> Resolved {
    Resolved { slug: Some(m.slug.clone()), title: m.name.clone(), source, spec: m.spec(), element: None, warning: None }
}

/// Every engine below these nodes (any depth) that names `slug` in its engine.md `model:`.
pub fn referencing(nodes: &[EngineNode], slug: &str) -> Vec<String> {
    let mut out = vec![];
    for n in nodes {
        if n.obj.config.get("model").and_then(Value::as_str).map(str::trim) == Some(slug) {
            out.push(n.obj.id.clone());
        }
        out.extend(referencing(&n.children, slug));
    }
    out
}

/// Every engine (any depth) whose resolved model is the library model `slug`.
pub fn used_by(nodes: &[EngineNode], slug: &str) -> Vec<String> {
    let mut out = vec![];
    for n in nodes {
        if n.model.as_ref().and_then(|r| r.slug.as_deref()) == Some(slug) {
            out.push(n.obj.id.clone());
        }
        out.extend(used_by(&n.children, slug));
    }
    out
}

/// Names that hold a secret, never accepted anywhere in a model action.
fn secret_name(k: &str) -> bool {
    let k = k.to_ascii_lowercase().replace('-', "_");
    ["key", "api_key", "apikey", "token", "access_token", "secret", "password", "auth", "authorization"].contains(&k.as_str())
}

/// A value that reads like a key or token rather than a name, id or URL.
pub fn looks_like_key(s: &str) -> bool {
    let s = s.trim();
    if env_name(s) {
        return false; // an env var NAME, which is what belongs here
    }
    let prefixes = ["sk-", "sk_", "xoxb-", "xoxp-", "ghp_", "gho_", "github_pat_", "AKIA", "AIza", "hf_", "Bearer "];
    if prefixes.iter().any(|p| s.starts_with(p)) && s.len() >= 12 {
        return true;
    }
    s.len() >= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && s.chars().any(|c| c.is_ascii_digit()) && s.chars().any(|c| c.is_ascii_alphabetic())
}

/// Refuse any arg named like a secret, and any string value that looks like a key, at any depth.
pub fn refuse_secrets(v: &Value) -> Result<()> {
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                if secret_name(k) {
                    bail!("`{k}` is refused: keys are never stored; name the env var that holds it in key_env");
                }
                refuse_secrets(x).map_err(|e| anyhow!("{k}: {e:#}"))?;
            }
        }
        Value::Array(a) => a.iter().try_for_each(refuse_secrets)?,
        Value::String(s) if looks_like_key(s) => {
            bail!("a value looks like a key; keys are never stored, only key_env (the env var's name)")
        }
        _ => {}
    }
    Ok(())
}

fn env_name(s: &str) -> bool {
    let mut c = s.chars();
    c.next().is_some_and(|f| f.is_ascii_uppercase() || f == '_') && c.all(|x| x.is_ascii_uppercase() || x.is_ascii_digit() || x == '_')
}

/// A model config as it may be saved: only FIELDS, a connector (one of `connectors` when given),
/// key_env an env var NAME, context a positive number, no secrets. Blank strings are dropped.
pub fn check_config(c: &Map<String, Value>, connectors: Option<&[String]>) -> Result<Map<String, Value>> {
    refuse_secrets(&Value::Object(c.clone()))?;
    let mut out = Map::new();
    for (k, v) in c {
        if !FIELDS.contains(&k.as_str()) {
            bail!("unknown model field {k} (allowed: {})", FIELDS.join(", "));
        }
        match (k.as_str(), v) {
            (_, Value::Null) => {}
            (_, Value::String(s)) if s.trim().is_empty() => {}
            ("context", Value::Number(n)) if n.as_f64().is_some_and(|x| x > 0.0) => {
                out.insert(k.clone(), v.clone());
            }
            ("context", Value::String(s)) => match s.trim().parse::<u64>() {
                Ok(n) if n > 0 => {
                    out.insert(k.clone(), json!(n));
                }
                _ => bail!("context must be a positive number of characters"),
            },
            ("context", _) => bail!("context must be a positive number of characters"),
            (_, Value::String(s)) => {
                out.insert(k.clone(), json!(s.trim()));
            }
            _ => bail!("model field {k} must be text"),
        }
    }
    let conn = out.get("connector").and_then(Value::as_str).ok_or_else(|| anyhow!("a model needs a connector"))?;
    if let Some(known) = connectors
        && !known.iter().any(|k| k == conn)
    {
        bail!("unknown connector {conn} (one of {})", known.join(", "));
    }
    if let Some(k) = out.get("key_env").and_then(Value::as_str)
        && !env_name(k)
    {
        bail!("key_env must be an environment variable NAME like ANTHROPIC_API_KEY, not a key");
    }
    Ok(out)
}

/// A library entry for GET /world.
pub fn world(desk: &Desk, engines: &[EngineNode], connectors: &[String]) -> Value {
    let models: Vec<Value> = desk
        .models
        .iter()
        .map(|m| {
            let u = &desk.usage[&m.slug];
            let mut v = json!({ "slug": m.slug, "name": m.name, "config": m.config, "used_by": used_by(engines, &m.slug), "calls": u["calls"].as_u64().unwrap_or(0) });
            for k in ["last", "test"] {
                if !u[k].is_null() {
                    v[k] = u[k].clone();
                }
            }
            v
        })
        .collect();
    json!({ "model": desk.default, "models": models, "connectors": connectors, "errors": desk.errors })
}
