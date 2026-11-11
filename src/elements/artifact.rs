//! # artifact (live)
//! Context management by snapshot. Config `read: {tool, args}`: before every step the engine runs
//! it and the result becomes this artifact's content, so the prompt always shows the *current*
//! state of the thing the last tool call changed (instant feedback). State: `content`, `version`
//! (bumps when the content changes).
use crate::core::{read, value, Call, Component, Event, Spec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Live snapshot: re-reads `read` before each step; prompt shows the latest content and version.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    read: Option<Call>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default)]
    content: String,
    #[serde(default)]
    version: u64,
}

pub struct Artifact {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(Artifact { name: s.name, cfg: read(&s.config)?, st: read(&s.state)? }))
}

impl Component for Artifact {
    fn kind(&self) -> &'static str { "artifact" }
    fn category(&self) -> &'static str { "live" }
    fn icon(&self) -> &'static str { "eye" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::World }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn view(&self) -> crate::core::node::Node {
        let src = self.cfg.read.as_ref().map(|c| format!("reads {}", c.tool)).unwrap_or_else(|| "static".into());
        super::tile(&self.name, "artifact", [format!("v{} · {src}", self.st.version), self.st.content.chars().take(160).collect()])
    }
    fn on(&mut self, ev: &Event) {
        if let Event::Snapshot { name, content } = ev {
            if *name == self.name && *content != self.st.content {
                self.st.content = content.clone();
                self.st.version += 1;
            }
        }
    }
    fn prompt(&self) -> Option<String> {
        (!self.st.content.is_empty()).then(|| format!("(live, v{})\n{}", self.st.version, self.st.content))
    }
    fn refresh(&self) -> Option<Call> {
        self.cfg.read.clone()
    }
}

#[cfg(test)]
mod tests {
    use crate::core::held::Held;
    use super::*;
    use crate::core::engine::tests::{file, reply, spec, Scripted};
    use crate::core::{tool, Engine};
    use serde_json::json;
    use std::sync::{atomic::{AtomicU32, Ordering}, Arc};

    #[tokio::test]
    async fn prompt_shows_the_state_after_the_previous_call() {
        let n = Arc::new(AtomicU32::new(0));
        let (a, b) = (n.clone(), n.clone());
        let bump = tool("bump", "add one", Value::Null, move |_| Ok(json!(a.fetch_add(1, Ordering::SeqCst) + 1)));
        let peek = tool("peek", "read counter", Value::Null, move |_| Ok(json!(format!("counter={}", b.load(Ordering::SeqCst)))));
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"bump"}]}"#, r#"{"answer":"ok"}"#]);
        let specs = vec![
            spec("tools", "tools", json!({"use": ["bump", "peek"]})),
            spec("artifact", "counter", json!({"read": {"tool": "peek"}})),
            reply(),
        ];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], vec![bump, peek], infer.clone()).unwrap();
        e.run("go").await.unwrap();
        let p = infer.prompts.held();
        assert!(p[0].contains("(live, v1)\ncounter=0"));
        assert!(p[1].contains("(live, v2)\ncounter=1"), "{}", p[1]);
    }
}
