//! Answers: created components.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;

pub async fn list_components() -> Result<Vec<Spec>, String> {
    Ok(crate::core::node::list_in(&*crate::core::store::data(), &crate::core::manifest::manifest().components))
}

/// Runs the create_component tool with JSON args, exactly as an engine would.
pub async fn create_component(args: String) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(&args).map_err(|e| say(format!("bad args: {e}")))?;
    use crate::core::IntoTool;
    let tb = crate::core::Toolbox::new([crate::core::node::CreateComponent(crate::core::store::data(), crate::core::manifest::manifest().components.clone()).into_tool()]);
    tb.call("create_component", v).await.map(|v| crate::core::text(&v)).map_err(say)
}
