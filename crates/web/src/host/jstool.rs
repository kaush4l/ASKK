//! Custom JS tools that live ALONGSIDE the agents (`assets/agents/*.js`,
//! listed in `manifest.json`'s `tools`). Each file is plain browser JS that
//! registers itself on `window.askkTools[name]` with an MCP-shaped card:
//!
//! ```js
//! window.askkTools = window.askkTools || {};
//! window.askkTools["fetch_url"] = {
//!   description: "Fetch a URL and return its text.",
//!   inputSchema: { type: "object", properties: { url: { type: "string" } },
//!                  required: ["url"] },
//!   async call(args) { /* args = the tool arguments object */ return "..."; }
//! };
//! ```
//!
//! The Rust side evals the file once (so it self-registers), reads the card,
//! and wraps it as a `dyn Tool` — the agent calls it exactly like a native
//! tool. Host builds skip this (JS tools need a DOM); it is wasm-only.

#[cfg(target_arch = "wasm32")]
pub use imp::register_js_tool;

/// Host builds have no DOM to eval JS in, so a baked tool becomes an inert
/// stub registered under its NAME — enough for config validation and the
/// host smoke run; a call returns "wasm-only".
#[cfg(not(target_arch = "wasm32"))]
pub fn register_js_tool(reg: &mut askk_runtime::tools::ToolRegistry, name: &str, _source: &str) {
    use std::rc::Rc;

    use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
    use askk_runtime::state::LocalBoxFuture;
    use serde_json::Value;

    struct HostStub(ToolSpec);
    impl Tool for HostStub {
        fn spec(&self) -> &ToolSpec {
            &self.0
        }
        fn call<'a>(&'a self, _a: Value, _c: &'a mut ToolCtx) -> LocalBoxFuture<'a, ToolResult> {
            Box::pin(async { ToolResult::err("js tools are wasm-only (need a browser DOM)") })
        }
    }
    let name = name.strip_suffix(".js").unwrap_or(name).to_string();
    let spec = ToolSpec {
        name: name.clone(),
        description: format!("Custom JS tool '{name}' (browser only)."),
        input_schema: serde_json::json!({ "type": "object" }),
        effect: Effect::Pure,
    };
    let _ = reg.register(Rc::new(HostStub(spec)));
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use std::rc::Rc;

    use askk_core::{Effect, Tool, ToolCtx, ToolResult, ToolSpec};
    use askk_runtime::state::LocalBoxFuture;
    use askk_runtime::tools::ToolRegistry;
    use js_sys::{Function, Promise, Reflect};
    use serde_json::Value;
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    /// File name ("fetch_url.js") → tool name ("fetch_url").
    fn tool_name(file: &str) -> String {
        file.strip_suffix(".js").unwrap_or(file).to_string()
    }

    fn tools_registry() -> Option<JsValue> {
        let window: JsValue = web_sys::window()?.into();
        Reflect::get(&window, &JsValue::from_str("askkTools")).ok()
    }

    fn descriptor(name: &str) -> Option<JsValue> {
        let reg = tools_registry()?;
        let d = Reflect::get(&reg, &JsValue::from_str(name)).ok()?;
        (!d.is_undefined() && !d.is_null()).then_some(d)
    }

    /// Eval the source (self-registers on `window.askkTools`), read the card,
    /// wrap it as a `dyn Tool`. A malformed file is skipped, not fatal.
    pub fn register_js_tool(reg: &mut ToolRegistry, file: &str, source: &str) {
        if js_sys::eval(source).is_err() {
            return;
        }
        let name = tool_name(file);
        let Some(desc) = descriptor(&name) else {
            return;
        };
        let description = Reflect::get(&desc, &JsValue::from_str("description"))
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_else(|| format!("Custom tool '{name}'."));
        let input_schema = Reflect::get(&desc, &JsValue::from_str("inputSchema"))
            .ok()
            .and_then(|v| js_sys::JSON::stringify(&v).ok())
            .and_then(|s| s.as_string())
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| serde_json::json!({ "type": "object" }));
        let spec = ToolSpec {
            name: name.clone(),
            description,
            input_schema,
            effect: Effect::Pure,
        };
        let _ = reg.register(Rc::new(JsTool { spec, name }));
    }

    struct JsTool {
        spec: ToolSpec,
        name: String,
    }

    impl Tool for JsTool {
        fn spec(&self) -> &ToolSpec {
            &self.spec
        }

        fn call<'a>(
            &'a self,
            args: Value,
            _ctx: &'a mut ToolCtx,
        ) -> LocalBoxFuture<'a, ToolResult> {
            Box::pin(async move {
                let Some(desc) = descriptor(&self.name) else {
                    return ToolResult::err(format!("js tool '{}' is not registered", self.name));
                };
                let func: Function = match Reflect::get(&desc, &JsValue::from_str("call"))
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok())
                {
                    Some(f) => f,
                    None => {
                        return ToolResult::err(format!("js tool '{}' has no call()", self.name))
                    }
                };
                // Pass the arguments as a live JS object (parse the JSON).
                let arg = js_sys::JSON::parse(&args.to_string()).unwrap_or(JsValue::UNDEFINED);
                let out = match Reflect::apply(&func, &desc, &js_sys::Array::of1(&arg)) {
                    Ok(v) => v,
                    Err(e) => return ToolResult::err(format!("js tool '{}': {e:?}", self.name)),
                };
                let value = match out.dyn_into::<Promise>() {
                    Ok(p) => match JsFuture::from(p).await {
                        Ok(v) => v,
                        Err(e) => {
                            return ToolResult::err(format!("js tool '{}': {e:?}", self.name))
                        }
                    },
                    Err(v) => v,
                };
                // String result passes through; anything else is JSON-encoded.
                let text = value.as_string().unwrap_or_else(|| {
                    js_sys::JSON::stringify(&value)
                        .ok()
                        .and_then(|s| s.as_string())
                        .unwrap_or_default()
                });
                ToolResult::ok(text)
            })
        }
    }
}
