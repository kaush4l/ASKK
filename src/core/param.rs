//! # param
//! What a kind may be configured with, and who each value belongs to.
//!
//! Every kind declares its config keys here, once. A key that is not declared is refused when
//! the element is built, so a misspelt knob is an error, never a value silently ignored.
//! Types are not repeated: each element's own `Cfg` already checks them when it is read.
//!
//! `share` says whose a value is. A recipe (the shareable form of an engine) may hold `Craft`
//! values; a `Personal` or `Secret` value belongs in the user's bindings. Today `share` is
//! declared and shown; refusing a personal literal in a recipe comes with bindings.
use crate::core::held::Shared;
use serde_json::{Map, Value};
use std::sync::RwLock;

/// Whose a value is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Share {
    /// How the element works; anyone may have it.
    Craft,
    /// About the user (an account, a path in their home, what they watch); never exported.
    Personal,
    /// A credential; only ever a reference, and never logged. No kind takes one yet.
    #[allow(dead_code)]
    Secret,
}

impl Share {
    pub fn as_str(self) -> &'static str {
        match self {
            Share::Craft => "craft",
            Share::Personal => "personal",
            Share::Secret => "secret",
        }
    }
}

/// One config key a kind reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Param {
    pub key: &'static str,
    pub share: Share,
    pub doc: &'static str,
}

pub const fn craft(key: &'static str, doc: &'static str) -> Param {
    Param { key, share: Share::Craft, doc }
}

pub const fn personal(key: &'static str, doc: &'static str) -> Param {
    Param { key, share: Share::Personal, doc }
}

/// Every key of `config` is one of `params`; null and `{}` are an empty config.
pub fn check(config: &Value, params: &[Param]) -> Result<(), String> {
    let map = match config {
        Value::Null => return Ok(()),
        Value::Object(m) => m,
        _ => return Err("config must be an object".into()),
    };
    for key in map.keys() {
        if !params.iter().any(|p| p.key == key) {
            let known: Vec<&str> = params.iter().map(|p| p.key).collect();
            return Err(if known.is_empty() {
                format!("unknown key '{key}': this kind takes no config")
            } else {
                format!("unknown key '{key}' (known: {})", known.join(", "))
            });
        }
    }
    Ok(())
}

/// Whether `v` holds a hole anywhere: `{"$": "name"}`.
pub fn has_holes(v: &Value) -> bool {
    match v {
        Value::Object(m) => hole(m).is_some() || m.values().any(has_holes),
        Value::Array(a) => a.iter().any(has_holes),
        _ => false,
    }
}

fn hole(m: &Map<String, Value>) -> Option<&str> {
    (m.len() == 1).then(|| m.get("$").and_then(Value::as_str)).flatten()
}

/// Fill every hole in `v` from `bound`; a hole with no value is an error naming it.
pub fn resolve(v: &Value, bound: &Map<String, Value>) -> Result<Value, String> {
    Ok(match v {
        Value::Object(m) => match hole(m) {
            Some(name) => bound.get(name).cloned().ok_or_else(|| format!("'{name}' is not bound (bind it in personal/bindings.json)"))?,
            None => Value::Object(m.iter().map(|(k, x)| Ok((k.clone(), resolve(x, bound)?))).collect::<Result<_, String>>()?),
        },
        Value::Array(a) => Value::Array(a.iter().map(|x| resolve(x, bound)).collect::<Result<_, _>>()?),
        other => other.clone(),
    })
}

/// The user's bindings: `{"<engine path>": {"<hole>": value}}`, read by the host from
/// `personal/bindings.json`. Empty until set.
static BINDINGS: RwLock<Option<Map<String, Value>>> = RwLock::new(None);

pub fn set_bindings(all: Map<String, Value>) {
    *BINDINGS.writing() = Some(all);
}

/// Tests share one process: each adds its own entries instead of replacing everyone's.
#[cfg(test)]
pub fn bind_for_test(entries: Value) {
    let mut b = BINDINGS.writing();
    let m = b.get_or_insert_with(Map::new);
    for (k, v) in entries.as_object().unwrap() {
        m.insert(k.clone(), v.clone());
    }
}

/// The values bound for the engine at `path`.
pub fn bound(path: &str) -> Map<String, Value> {
    BINDINGS.reading().as_ref().and_then(|b| b.get(path)).and_then(Value::as_object).cloned().unwrap_or_default()
}

/// The model a recipe names: `role:<name>` is whatever the user bound that role to
/// (`{"roles": {"reasoning": "<model>"}}` in bindings); any other name is itself. An unbound
/// role stays as written, so the model lookup fails naming it.
pub fn model(name: &str) -> String {
    match name.strip_prefix("role:") {
        Some(role) => bound("roles").get(role).and_then(Value::as_str).map(String::from).unwrap_or_else(|| name.to_string()),
        None => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const P: &[Param] = &[craft("max", "turns kept"), personal("root", "where it works")];

    #[test]
    fn an_unknown_key_is_refused_with_its_name() {
        let e = check(&json!({"max": 3, "mx": 4}), P).unwrap_err();
        assert!(e.contains("'mx'") && e.contains("max, root"), "{e}");
        assert!(check(&json!({"a": 1}), &[]).unwrap_err().contains("takes no config"));
    }

    #[test]
    fn a_hole_is_filled_from_bindings_or_named_when_unbound() {
        let recipe = json!({"every_ms": 60000, "source": {"tool": "quote", "args": {"symbol": {"$": "ticker"}}}});
        assert!(has_holes(&recipe) && !has_holes(&json!({"$": 1, "x": 2})));
        let b: Map<String, Value> = serde_json::from_value(json!({"ticker": "AAA"})).unwrap();
        assert_eq!(resolve(&recipe, &b).unwrap()["source"]["args"]["symbol"], "AAA");
        let e = resolve(&recipe, &Map::new()).unwrap_err();
        assert!(e.contains("'ticker'") && e.contains("bindings.json"), "{e}");
    }

    #[test]
    fn a_role_names_the_model_the_user_bound() {
        bind_for_test(json!({"roles": {"reasoning": "big-model"}}));
        assert_eq!(model("role:reasoning"), "big-model");
        assert_eq!(model("role:fast"), "role:fast", "unbound: left as written, so the lookup names it");
        assert_eq!(model("small-model"), "small-model");
    }

    #[test]
    fn declared_keys_and_empty_configs_pass() {
        assert!(check(&json!({"max": 3, "root": "/x"}), P).is_ok());
        assert!(check(&Value::Null, P).is_ok());
        assert!(check(&json!({}), &[]).is_ok());
        assert!(check(&json!([1]), P).is_err());
    }
}
