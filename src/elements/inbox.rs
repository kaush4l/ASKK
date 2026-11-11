//! # inbox
//! The engine's message box on the [`crate::core::board`]. Its prompt lists the new messages
//! (marked new until acknowledged); `post {to, text}` leaves a message in another engine's box
//! (or `user`) without waiting; `ack {reply?}` marks every new message as seen and, with `reply`,
//! answers each sender. Messages that arrive while the engine runs wait for its next run.
//!
//! ```json
//! {"kind": "inbox", "name": "inbox", "config": {}}
//! ```
use crate::core::board::{board, Act, Cause, Draft};
use crate::core::{tool, Component, Event, Spec, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

const DOC: &str = "Message box: new messages in the prompt; post {to, text} sends without waiting; ack {reply?} marks all new as seen (reply answers the newest); answer {id, text} replies to one message.";

pub struct Inbox {
    name: String,
    cfg: Value,
    /// The engine this box belongs to (from `Event::Bound`).
    path: String,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    Ok(Box::new(Inbox { name: s.name, cfg: if s.config.is_null() { json!({}) } else { s.config }, path: String::new() }))
}

impl Component for Inbox {
    fn kind(&self) -> &'static str { "inbox" }
    fn unique(&self) -> bool { true }
    fn receives(&self) -> bool { true }
    fn category(&self) -> &'static str { "action" }
    fn icon(&self) -> &'static str { "chat" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::Other }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { self.cfg.clone() }
    fn state(&self) -> Value { Value::Null }
    fn view(&self) -> crate::core::node::Node {
        let all = board().box_of(&self.path);
        let lines = all.iter().rev().take(5).map(|m| format!("{}#{} {}: {}", if m.seen { "" } else { "● " }, m.id, m.from, m.text.chars().take(80).collect::<String>()));
        super::tile(&self.name, "inbox", std::iter::once(format!("{} new", all.iter().filter(|m| !m.seen).count())).chain(lines))
    }
    fn on(&mut self, ev: &Event) {
        if let Event::Bound(p) = ev {
            self.path = p.clone();
        }
    }
    fn prompt(&self) -> Option<String> {
        let mut out = vec![];
        let others: Vec<String> = board().directory().into_iter().filter(|(p, _)| *p != self.path).map(|(p, d)| format!("- {p}: {d}")).collect();
        if !others.is_empty() {
            out.push(format!("Engines you can post to (or user):\n{}", others.join("\n")));
        }
        let new = board().new_for(&self.path);
        if !new.is_empty() {
            out.push("New messages (handle them, take notes, then call ack once; reply through ack or post):".to_string());
            out.extend(new.iter().map(|m| format!("- #{} {}", m.id, m.line())));
        }
        (!out.is_empty()).then(|| out.join("\n"))
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        if self.path.is_empty() {
            return vec![];
        }
        let me = self.path.clone();
        let me2 = me.clone();
        let me3 = me.clone();
        vec![
            tool("post", "leave a message in an engine's box (an engine path, or user); does not wait for an answer", json!({"to": "engine path or user", "text": "message"}), move |a| {
                let to = a["to"].as_str().ok_or("to missing")?;
                board().post(&me, to, a["text"].as_str().unwrap_or_default(), Cause::Engine).map(|id| json!(format!("posted #{id} to {to}")))
            }),
            tool("ack", "mark every new message as seen; with reply, answer the sender of the newest one (post to reach others)", json!({"reply": "optional text sent back to the senders"}), move |a| {
                let seen = board().ack(&me2);
                let reply = a["reply"].as_str().unwrap_or_default().trim().to_string();
                // The reply answers the newest message only: one reply to every sender sends the
                // same text to engines it was not meant for.
                let newest = seen.last();
                let senders: Vec<String> = newest.map(|m| m.from.clone()).into_iter().collect();
                if let (false, Some(m)) = (reply.is_empty(), newest) {
                    board().send(Draft::reply(&me2, &m.from, Act::Answer, m.id, &reply))?;
                }
                Ok(json!(format!("{} message(s) seen{}", seen.len(), if reply.is_empty() { String::new() } else { format!("; replied to {}", senders.join(", ")) })))
            }),
            tool("answer", "answer one message by its #id: the reply goes to that message's sender", json!({"id": "message number", "text": "the answer"}), move |a| {
                let id = a["id"].as_u64().or_else(|| a["id"].as_str().and_then(|s| s.trim_start_matches('#').parse().ok())).ok_or("id missing")?;
                let m = board().box_of(&me3).into_iter().find(|m| m.id == id).ok_or_else(|| format!("no message #{id} in this box"))?;
                board().send(Draft::reply(&me3, &m.from, Act::Answer, id, a["text"].as_str().unwrap_or_default())).map(|n| json!(format!("answered #{id} ({}) as #{n}", m.from)))
            }),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn new_messages_show_until_ack_and_ack_replies_to_senders() {
        let me = format!("inbox-test-{}", std::process::id());
        let mut i = new(Spec { kind: "inbox".into(), name: "inbox".into(), ..Default::default() }).unwrap();
        assert!(i.tools().is_empty(), "no box before it is bound");
        i.on(&Event::Bound(me.clone()));
        board().post("user", &me, "add a canvas", Cause::Person).unwrap();
        let p = i.prompt().unwrap();
        assert!(p.contains("from user: add a canvas"), "{p}");
        let tb = crate::core::Toolbox::new(i.tools());
        let r = tb.call("ack", json!({"reply": "on it"})).await.unwrap();
        assert!(r.as_str().unwrap().contains("1 message(s) seen; replied to user"), "{r}");
        assert!(i.prompt().is_none(), "seen messages leave the prompt");
        assert!(board().new_for("user").iter().any(|m| m.from == me && m.text == "on it"));
        tb.call("post", json!({"to": "user", "text": "done"})).await.unwrap();
        let id = board().post("user", &me, "which colour?", Cause::Person).unwrap();
        let r = tb.call("answer", json!({"id": id, "text": "blue"})).await.unwrap();
        assert!(r.as_str().unwrap().contains("(user)"), "{r}");
        assert!(board().new_for("user").iter().any(|m| m.from == me && m.text == "blue"));
        assert!(tb.call("answer", json!({"id": 999999, "text": "x"})).await.is_err());
        assert!(board().new_for("user").iter().any(|m| m.from == me && m.text == "done"));
    }
}
