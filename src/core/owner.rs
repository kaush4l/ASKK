//! # Owner: what the owner sets on an engine from a window
//!
//! Each writes the engine's own files, as a hand edit would, and marks it changed:
//!
//! | what | where it is kept |
//! | --- | --- |
//! | its model ([`Engine::set_model`]) | `engine.json` `model` (empty: the default model) |
//! | what it may do without asking ([`Engine::set_permit`]) | `engine.json` `permit` |
//! | its goal ([`Engine::set_goal_text`]) | its goal element (`goal.md`), as `set_goal` would |
//! | folding the conversation now ([`Engine::compact`]) | its history keeps a summary, as a refocus does |
use super::*;
use crate::core::held::Held;

impl Engine {
    /// Name `model` as this engine's own (empty: follow the default). An unknown name is
    /// refused when the models are known.
    pub fn set_model(&self, model: &str, known: &[String]) -> Result<(), String> {
        let model = model.trim();
        if !model.is_empty() && !known.is_empty() && !known.iter().any(|m| m == model) {
            return Err(format!("no model '{model}' (the models are: {})", known.join(", ")));
        }
        self.file.held().model = model.to_string();
        self.persist();
        Ok(())
    }

    pub fn set_permit(&self, mode: permit::Mode) {
        self.file.held().permit = mode;
        self.persist();
    }

    /// Replace its goal, as its own `set_goal` tool would. Refused when it has no goal.
    pub fn set_goal_text(&self, text: &str) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("a goal needs words: /goal <what it is for>".into());
        }
        {
            let mut els = self.elements.held();
            let goal = els.iter_mut().find(|e| e.name() == boxes::GOAL).ok_or_else(|| format!("{} keeps no goal (it has no '{}' element)", self.path, boxes::GOAL))?;
            let tool = goal.tools().first().map(|t| t.name()).ok_or("its goal cannot be written")?;
            goal.on(&Event::Called { tool, args: serde_json::json!({"text": text}), result: "goal updated".into() });
        }
        self.persist();
        Ok(())
    }

    /// Go back to just before the `n`-th asking of the conversation (0: the first), forgetting
    /// what came after, so it can be asked again. Refused while it works. Gives the words that
    /// were asked there.
    pub fn rewind(&self, n: usize) -> Result<String, String> {
        let _turn = self.turn.try_lock().ok_or("it is at work: edit from here when it is done")?;
        let asked: Vec<String> = self.elements.held().iter().flat_map(|c| c.transcript()).filter(|(role, _)| role == "user").map(|(_, t)| t).collect();
        let at = asked.get(n).cloned().ok_or_else(|| format!("the conversation has {} askings, not {}", asked.len(), n + 1))?;
        self.dispatch(&Event::Rewound(n));
        self.persist();
        Ok(at)
    }

    /// Fold the conversation into a summary now, as a refocus near a full context does. Refused
    /// while it works, when the conversation is empty, and when it keeps nothing to fold.
    pub async fn compact(&self) -> Result<String, String> {
        let _turn = self.turn.try_lock().ok_or("it is at work: compact it when it is done")?;
        let before: Vec<(String, String)> = self.elements.held().iter().flat_map(|c| c.transcript()).collect();
        if before.is_empty() {
            return Err("nothing to compact: the conversation is empty".into());
        }
        let tools = self.toolbox();
        let how = self.elements.held().iter().find_map(|e| e.refocus()).unwrap_or_else(|| engine::REFOCUS.into());
        let model = self.file.held().model.clone();
        self.act("refocusing", "compacting");
        let summary = self.infer.complete(&model, format!("{how}\n\n{}", self.refocus_prompt(&tools, "")), self.sampling(Some("refocus"))).await;
        self.act("idle", "");
        let summary = summary?;
        self.dispatch(&Event::Folded(summary.clone()));
        let after: Vec<(String, String)> = self.elements.held().iter().flat_map(|c| c.transcript()).collect();
        if after == before {
            return Err("this engine keeps no history to fold".into());
        }
        self.persist();
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::engine::tests::{file, reply, spec, Scripted};
    use serde_json::json;

    #[tokio::test]
    async fn the_owner_sets_the_model_the_mode_and_the_goal_and_compacts() {
        let infer = Scripted::new(&["answer: four", "the gist: four"]);
        let goal = spec("notes", "goal", json!({"mode": "replace", "hint": "what it is for"}));
        let e = Engine::new(file("o"), "o".into(), vec![spec("history", "h", Value::Null), reply(), goal], vec![], vec![], infer).unwrap();
        assert!(e.set_model("nope", &["a".into()]).unwrap_err().contains("no model 'nope'"));
        e.set_model("a", &["a".into()]).unwrap();
        assert_eq!(e.file.held().model, "a");
        e.set_permit(permit::Mode::Ask);
        assert_eq!(e.file.held().permit, permit::Mode::Ask);
        e.set_goal_text("count well").unwrap();
        assert!(e.prompt(&e.toolbox(), "").contains("count well"));
        assert!(e.compact().await.unwrap_err().contains("empty"));
        e.run("from user: two and two?").await.unwrap();
        assert_eq!(e.compact().await.unwrap(), "the gist: four");
        assert_eq!(e.rewind(0).unwrap(), "from user: two and two?");
        assert!(!e.elements.held().iter().flat_map(|c| c.transcript()).any(|(role, _)| role == "user"), "what came after is forgotten");
        assert!(e.rewind(3).is_err());
        assert!(e.elements.held().iter().flat_map(|c| c.transcript()).any(|(role, t)| role == "summary" && t.contains("gist")));
    }
}
