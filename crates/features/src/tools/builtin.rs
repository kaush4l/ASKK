//! Builtin tools — plain `RustTool`s with honest JSON schemas. There is no
//! `now` tool: the current time is a standing sheet section injected at
//! assembly (`Element::Clock`), not something the model must fetch.

use askk_core::{Effect, ToolResult, ToolSpec};
use serde_json::{json, Value};

use super::registry::{RegistryError, RustTool, ToolRegistry};

/// The `ToolCtx` slice `state_note` appends to — declared, explicit (ADR-005).
pub const NOTES_SLICE: &str = "notes";

/// Registers every builtin.
pub fn register_builtins(reg: &mut ToolRegistry) -> Result<(), RegistryError> {
    reg.register(calc())?;
    reg.register(state_note())?;
    Ok(())
}

/// Test stub, NOT part of the production roster (context diet: a tool the
/// model never needs is a tool spec it never pays for). Fixtures opt in.
pub fn register_echo(reg: &mut ToolRegistry) -> Result<(), RegistryError> {
    reg.register(echo())
}

fn echo() -> std::rc::Rc<dyn askk_core::Tool> {
    RustTool::shared(
        ToolSpec {
            name: "echo".into(),
            description: "Repeats the given text back verbatim.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Text to repeat." }
                },
                "required": ["text"]
            }),
            effect: Effect::Pure,
        },
        |args, _ctx| match args.get("text").and_then(Value::as_str) {
            Some(text) => ToolResult::ok(text),
            None => ToolResult::err("echo: missing string field 'text'"),
        },
    )
}

fn calc() -> std::rc::Rc<dyn askk_core::Tool> {
    RustTool::shared(
        ToolSpec {
            name: "calc".into(),
            description: "Applies +, -, * or / to two numbers.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "op": { "type": "string", "enum": ["+", "-", "*", "/"] },
                    "a": { "type": "number" },
                    "b": { "type": "number" }
                },
                "required": ["op", "a", "b"]
            }),
            effect: Effect::Pure,
        },
        |args, _ctx| {
            let (Some(a), Some(b)) = (
                args.get("a").and_then(Value::as_f64),
                args.get("b").and_then(Value::as_f64),
            ) else {
                return ToolResult::err("calc: 'a' and 'b' must be numbers");
            };
            let out = match args.get("op").and_then(Value::as_str) {
                Some("+") => a + b,
                Some("-") => a - b,
                Some("*") => a * b,
                Some("/") if b == 0.0 => return ToolResult::err("calc: division by zero"),
                Some("/") => a / b,
                other => {
                    return ToolResult::err(format!("calc: unknown op {other:?}"));
                }
            };
            ToolResult::ok(out.to_string())
        },
    )
}

fn state_note() -> std::rc::Rc<dyn askk_core::Tool> {
    RustTool::shared(
        ToolSpec {
            name: "state_note".into(),
            description: "Appends a note to the run's notes state slice.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "note": { "type": "string", "description": "Note to record." }
                },
                "required": ["note"]
            }),
            effect: Effect::Mutating,
        },
        |args, ctx| {
            let Some(note) = args.get("note").and_then(Value::as_str) else {
                return ToolResult::err("state_note: missing string field 'note'");
            };
            if ctx.dry_run {
                return ToolResult::ok(format!("would append note: {note}"));
            }
            let mut list = ctx
                .slice(NOTES_SLICE)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            list.push(json!(note));
            let total = list.len();
            ctx.set_slice(NOTES_SLICE, Value::Array(list));
            ToolResult::ok(format!("noted ({total} total)"))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::super::testutil::block_on;
    use super::*;
    use askk_core::{Tool, ToolCtx};
    use std::rc::Rc;

    fn builtins() -> ToolRegistry {
        let mut reg = ToolRegistry::new();
        register_builtins(&mut reg).unwrap();
        register_echo(&mut reg).unwrap();
        reg
    }

    fn call(tool: &Rc<dyn Tool>, args: Value) -> ToolResult {
        block_on(tool.call(args, &mut ToolCtx::default()))
    }

    #[test]
    fn all_builtins_register_and_resolve() {
        let reg = builtins();
        let names: Vec<String> = ["echo", "calc", "state_note"]
            .iter()
            .map(|n| n.to_string())
            .collect();
        let set = reg.build_tool_set(&names).unwrap();
        assert_eq!(set.len(), 3);
        // Effects are honest: only state_note routes through the action gate.
        assert_eq!(
            set.get("state_note").unwrap().spec().effect,
            Effect::Mutating
        );
        for name in ["echo", "calc"] {
            assert_eq!(set.get(name).unwrap().spec().effect, Effect::Pure);
        }
    }

    #[test]
    fn echo_is_opt_in_not_a_production_builtin() {
        let mut reg = ToolRegistry::new();
        register_builtins(&mut reg).unwrap();
        assert!(reg.get("echo").is_none());
        register_echo(&mut reg).unwrap();
        assert!(reg.get("echo").is_some());
    }

    #[test]
    fn echo_repeats_and_rejects_missing_text() {
        let out = call(&echo(), json!({"text": "hi"}));
        assert!(out.ok);
        assert_eq!(out.content, "hi");
        let out = call(&echo(), json!({}));
        assert!(!out.ok);
        assert!(out.content.contains("text"));
    }

    #[test]
    fn calc_covers_all_four_ops() {
        let tool = calc();
        for (op, a, b, want) in [
            ("+", 6, 1, "7"),
            ("-", 6, 1, "5"),
            ("*", 3, 2, "6"),
            ("/", 6, 2, "3"),
        ] {
            let out = call(&tool, json!({"op": op, "a": a, "b": b}));
            assert!(out.ok, "op {op} failed: {}", out.content);
            assert_eq!(out.content, want, "op {op}");
        }
        let out = call(&tool, json!({"op": "/", "a": 1, "b": 2}));
        assert_eq!(out.content, "0.5");
    }

    #[test]
    fn calc_division_by_zero_is_ok_false() {
        let out = call(&calc(), json!({"op": "/", "a": 1, "b": 0}));
        assert!(!out.ok);
        assert!(out.content.contains("division by zero"));
    }

    #[test]
    fn calc_rejects_bad_args_without_panicking() {
        let tool = calc();
        assert!(!call(&tool, json!({"op": "+", "a": "x", "b": 2})).ok);
        assert!(!call(&tool, json!({"op": "%", "a": 1, "b": 2})).ok);
        assert!(!call(&tool, json!({})).ok);
    }

    #[test]
    fn state_note_appends_to_the_notes_slice() {
        let tool = state_note();
        let mut ctx = ToolCtx::default();
        let out = block_on(tool.call(json!({"note": "first"}), &mut ctx));
        assert!(out.ok);
        assert_eq!(out.content, "noted (1 total)");
        let out = block_on(tool.call(json!({"note": "second"}), &mut ctx));
        assert_eq!(out.content, "noted (2 total)");
        assert_eq!(ctx.slice(NOTES_SLICE), Some(&json!(["first", "second"])));
        assert!(!block_on(tool.call(json!({}), &mut ctx)).ok);
    }

    #[test]
    fn state_note_dry_run_describes_and_touches_nothing() {
        let tool = state_note();
        let mut ctx = ToolCtx::default();
        ctx.dry_run = true;
        let out = block_on(tool.call(json!({"note": "ghost"}), &mut ctx));
        assert!(out.ok);
        assert!(out.content.contains("would append"));
        assert!(ctx.slice(NOTES_SLICE).is_none());
    }
}
