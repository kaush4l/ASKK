//! # Talks: more than one conversation with one engine
//!
//! An engine holds one conversation at a time: what its elements remember of it (the turns,
//! the board, the phase, the open files). Another conversation is that memory put aside and
//! brought back. Which parts are the conversation is not named here: they are exactly the
//! elements whose state a clear empties ([`Event::Cleared`]), so a new kind that keeps a part
//! of the talk is put aside with it without anyone listing it.
//!
//! ```text
//! <engine>/talks.json        {current}: the conversation in the elements now
//! <engine>/talks/<id>.json   one conversation put aside: its title and the states of its parts
//! ```
//!
//! The conversation an engine had before there were several is the first (id 1). Notes, goal
//! and learning are not part of a conversation: they stay whichever is open. The runs stay
//! with the engine; a conversation shows those whose input is one of its turns.
use super::store::join;
use super::*;
use crate::core::held::Held;
use std::collections::BTreeMap;

/// Where the conversations put aside are kept, under the engine's key.
pub const TALKS: &str = "talks";

/// One conversation put aside.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    pub id: u64,
    pub title: String,
    pub turns: usize,
    /// Unix milliseconds when it was last the one open.
    pub at: u64,
    /// The state of each part, by element name.
    #[serde(default)]
    pub states: BTreeMap<String, Value>,
}

/// One conversation as a list shows it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TalkInfo {
    pub id: u64,
    pub title: String,
    pub turns: usize,
    pub at: u64,
    /// It is the one open now.
    pub current: bool,
    /// What the owner named it; empty: it goes by its title.
    #[serde(default)]
    pub name: String,
    /// Put away: not in the list, but kept and found by a search.
    #[serde(default)]
    pub archived: bool,
    /// Done with: listed under its own heading.
    #[serde(default)]
    pub settled: bool,
}

/// What the owner said about one conversation.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub settled: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Index {
    current: u64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    meta: BTreeMap<u64, Meta>,
}

/// One conversation a search found: where, and the words around what was looked for.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TalkHit {
    pub id: u64,
    pub title: String,
    /// The line it was found in, cut around the words; empty when only the title matched.
    pub said: String,
    pub current: bool,
    pub archived: bool,
}

/// `text` cut to about 90 letters around the first place `low` (small letters) is in it.
fn around(text: &str, low: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let at = lower.find(low)?;
    let chars: Vec<char> = text.chars().collect();
    let start = lower[..at].chars().count().saturating_sub(30);
    let piece: String = chars.iter().skip(start).take(90).collect();
    let piece = piece.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(format!("{}{piece}{}", if start > 0 { "…" } else { "" }, if start + 90 < chars.len() { "…" } else { "" }))
}

/// The id of the conversation an engine had before there were several.
pub const FIRST: u64 = 1;

fn now() -> u64 {
    web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// What a conversation is called: its first message, without who sent it or what was attached.
pub fn title_of(turns: &[(String, String)]) -> String {
    let first = turns.iter().find(|(role, _)| role == "user").map(|(_, t)| t.as_str()).unwrap_or_default();
    let text = match first.strip_prefix("from ").and_then(|r| r.split_once(": ")) {
        Some((who, rest)) if !who.contains(char::is_whitespace) => rest,
        _ => first,
    };
    let t = media::without_refs(text).split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > 60 { format!("{}…", t.chars().take(59).collect::<String>()) } else { t }
}

impl Engine {
    fn index_key(&self) -> String {
        join(&self.key, "talks.json")
    }

    fn talk_key(&self, id: u64) -> String {
        join(&self.key, &format!("{TALKS}/{id}.json"))
    }

    fn index(&self) -> Index {
        store::data().get(&self.index_key()).and_then(|s| serde_json::from_str::<Index>(&s).ok()).unwrap_or_default()
    }

    fn save_index(&self, i: &Index) -> Result<(), String> {
        store::data().put(&self.index_key(), &serde_json::to_string(i).map_err(|e| e.to_string())?)
    }

    /// The id of the conversation open now.
    pub fn current_talk(&self) -> u64 {
        Some(self.index().current).filter(|c| *c > 0).unwrap_or(FIRST)
    }

    /// Change what the owner said about the conversation `id` (rename, archive, settle).
    pub fn mark_talk(&self, id: u64, change: impl FnOnce(&mut Meta)) -> Result<(), String> {
        if !self.talks().iter().any(|t| t.id == id) {
            return Err(format!("{} has no conversation {id}", self.path));
        }
        let mut i = self.index();
        if i.current == 0 {
            i.current = FIRST;
        }
        change(i.meta.entry(id).or_default());
        i.meta.retain(|_, m| *m != Meta::default());
        self.save_index(&i)?;
        self.bump();
        Ok(())
    }

    /// Every conversation whose title, name or words hold `query` (small and capital letters
    /// alike), the open one first; archived ones too.
    pub fn search_talks(&self, query: &str) -> Vec<TalkHit> {
        let low = query.trim().to_lowercase();
        if low.is_empty() {
            return vec![];
        }
        let mut out = vec![];
        for t in self.talks() {
            let turns: Vec<(String, String)> = if t.current { self.transcript() } else { self.talk_parts(t.id).map(|p| p.iter().flat_map(|c| c.transcript()).collect()).unwrap_or_default() };
            let said = turns.iter().filter(|(role, _)| role == "user" || role == "model" || role == "summary").find_map(|(_, text)| around(text, &low));
            let named = t.title.to_lowercase().contains(&low) || t.name.to_lowercase().contains(&low);
            if named || said.is_some() {
                out.push(TalkHit { id: t.id, title: if t.name.is_empty() { t.title } else { t.name }, said: said.unwrap_or_default(), current: t.current, archived: t.archived });
            }
        }
        out
    }

    fn transcript(&self) -> Vec<(String, String)> {
        self.elements.held().iter().flat_map(|c| c.transcript()).collect()
    }

    /// The parts of the conversation open now: each element a clear would change, with its state.
    fn parts(&self) -> BTreeMap<String, Value> {
        let els = self.elements.held();
        let mut out = BTreeMap::new();
        for e in els.iter() {
            let s = e.spec();
            let Ok(mut fresh) = build(s.clone()) else { continue };
            fresh.on(&Event::Bound(self.path.clone()));
            fresh.on(&Event::Cleared);
            if fresh.state() != s.state {
                out.insert(s.name, s.state);
            }
        }
        out
    }

    /// Put the conversation open now aside (a conversation with nothing in it is not kept).
    fn put_aside(&self) -> Result<(), String> {
        let turns = self.transcript();
        if turns.is_empty() {
            return Ok(());
        }
        let id = self.current_talk();
        let saved = Saved { id, title: title_of(&turns), turns: turns.len(), at: now(), states: self.parts() };
        store::data().put(&self.talk_key(id), &serde_json::to_string(&saved).map_err(|e| e.to_string())?)
    }

    fn set_current(&self, id: u64) -> Result<(), String> {
        let mut i = self.index();
        i.current = id;
        self.save_index(&i)
    }

    /// Every conversation, the open one first, then the others, last open first.
    pub fn talks(&self) -> Vec<TalkInfo> {
        let current = self.current_talk();
        let turns = self.transcript();
        let meta = self.index().meta;
        let mut out = vec![TalkInfo { id: current, title: title_of(&turns), turns: turns.len(), at: now(), current: true, ..Default::default() }];
        let data = store::data();
        let mut others: Vec<TalkInfo> = data
            .list(&join(&self.key, TALKS))
            .into_iter()
            .filter(|f| !f.dir && f.name.ends_with(".json"))
            .filter_map(|f| data.get(&join(&self.key, &format!("{TALKS}/{}", f.name))))
            .filter_map(|s| serde_json::from_str::<Saved>(&s).ok())
            .filter(|s| s.id != current)
            .map(|s| TalkInfo { id: s.id, title: s.title, turns: s.turns, at: s.at, ..Default::default() })
            .collect();
        others.sort_by(|a, b| b.at.cmp(&a.at));
        out.extend(others);
        for t in out.iter_mut() {
            let m = meta.get(&t.id).cloned().unwrap_or_default();
            (t.name, t.archived, t.settled) = (m.name, m.archived, m.settled);
        }
        out
    }

    /// Begin a new conversation: the one open now is put aside. Refused while a run goes.
    /// Gives the new one's id (the open one's, when it is still empty).
    pub fn new_talk(&self) -> Result<u64, String> {
        // The turn is taken, so no run starts while the elements change.
        let _turn = self.turn.try_lock().ok_or("it is at work: stop it, or wait until it is done")?;
        if self.transcript().is_empty() {
            return Ok(self.current_talk());
        }
        self.put_aside()?;
        let id = now().max(self.current_talk() + 1);
        self.dispatch(&Event::Cleared);
        self.set_current(id)?;
        self.persist();
        Ok(id)
    }

    /// The conversation `id` as its parts would be, without bringing it back: read only, so it
    /// can be looked at while a run goes on in the one open now. `None`: there is no such one.
    pub fn talk_parts(&self, id: u64) -> Option<Vec<Box<dyn Component>>> {
        let saved: Saved = store::data().get(&self.talk_key(id)).and_then(|s| serde_json::from_str(&s).ok())?;
        let specs: Vec<Spec> = self.elements.held().iter().map(|e| e.spec()).collect();
        let parts = specs
            .into_iter()
            .filter_map(|mut spec| {
                // A part it does not name was empty when it was put aside.
                let state = saved.states.get(&spec.name).cloned();
                let mut e = build(spec.clone()).ok()?;
                e.on(&Event::Bound(self.path.clone()));
                e.on(&Event::Cleared);
                if let Some(state) = state {
                    spec.state = state;
                    e = build(spec).ok()?;
                    e.on(&Event::Bound(self.path.clone()));
                }
                Some(e)
            })
            .collect();
        Some(parts)
    }

    /// Bring back the conversation `id`; the one open now is put aside. Refused while a run goes.
    pub fn open_talk(&self, id: u64) -> Result<(), String> {
        let _turn = self.turn.try_lock().ok_or("it is at work: stop it, or wait until it is done")?;
        if id == self.current_talk() {
            return Ok(());
        }
        let data = store::data();
        let saved: Saved = data.get(&self.talk_key(id)).and_then(|s| serde_json::from_str(&s).ok()).ok_or_else(|| format!("there is no conversation {id}"))?;
        self.put_aside()?;
        self.dispatch(&Event::Cleared);
        {
            let mut els = self.elements.held();
            for (name, state) in saved.states {
                let Some(i) = els.iter().position(|e| e.name() == name) else { continue };
                let mut spec = els[i].spec();
                spec.state = state;
                let mut e = build(spec).map_err(|e| format!("{name}: {e}"))?;
                e.on(&Event::Bound(self.path.clone()));
                els[i] = e;
            }
        }
        data.remove(&self.talk_key(id))?;
        self.set_current(id)?;
        self.persist();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::engine::tests::{file, reply, spec, Scripted};

    #[tokio::test]
    async fn a_conversation_is_put_aside_and_brought_back() {
        let infer = Scripted::new(&["answer: four", "answer: blue", "answer: still four"]);
        let mut e = Engine::new(file("t"), "t".into(), vec![spec("history", "h", Value::Null), reply(), spec("notes", "learning", Value::Null)], vec![], vec![], infer).unwrap();
        e.key = "engines/talks-test".into();
        assert_eq!(e.current_talk(), FIRST, "the conversation from before is the first");
        e.run("from user: two and two? [media:m1]").await.unwrap();
        assert_eq!(e.talks()[0].title, "two and two?");
        let id = e.new_talk().unwrap();
        assert!(id > FIRST && e.transcript().is_empty(), "a new one begins empty");
        assert_eq!(e.new_talk().unwrap(), id, "an empty one is not put aside for another empty one");
        e.run("from user: the sky?").await.unwrap();
        let all = e.talks();
        assert_eq!(all.iter().map(|t| (t.title.as_str(), t.current)).collect::<Vec<_>>(), [("the sky?", true), ("two and two?", false)]);
        // Read while it is put aside, without bringing it back.
        let parts = e.talk_parts(FIRST).expect("the first is kept");
        let seen: Vec<(String, String)> = parts.iter().flat_map(|c| c.transcript()).collect();
        assert!(seen.iter().any(|(_, t)| t.contains("two and two")) && !seen.iter().any(|(_, t)| t.contains("sky")), "{seen:?}");
        assert!(e.transcript().iter().any(|(_, t)| t.contains("sky")), "the open one is untouched");
        assert!(e.talk_parts(999).is_none());
        e.open_talk(FIRST).unwrap();
        assert!(e.transcript().iter().any(|(_, t)| t.contains("two and two")), "the first is back: {:?}", e.transcript());
        assert!(!e.transcript().iter().any(|(_, t)| t.contains("sky")));
        assert_eq!(e.current_talk(), FIRST);
        e.run("from user: again?").await.unwrap();
        assert!(e.transcript().iter().any(|(_, t)| t.contains("two and two")), "it goes on where it was");
        assert_eq!(e.talks().len(), 2);
        assert!(e.open_talk(999).is_err());
        // Renamed, settled and archived; found by its title and by its words.
        let other = e.talks()[1].id;
        e.mark_talk(other, |m| { m.name = "Colours".into(); m.archived = true; }).unwrap();
        e.mark_talk(FIRST, |m| m.settled = true).unwrap();
        let all = e.talks();
        assert_eq!((all[1].name.as_str(), all[1].archived, all[0].settled), ("Colours", true, true));
        assert!(e.mark_talk(999, |m| m.settled = true).is_err());
        let hits = e.search_talks("SKY");
        assert_eq!(hits.iter().map(|h| (h.id, h.title.as_str(), h.archived)).collect::<Vec<_>>(), [(other, "Colours", true)]);
        assert!(hits[0].said.to_lowercase().contains("sky"), "{hits:?}");
        assert_eq!(e.search_talks("colours")[0].said, "", "found by its name only");
        assert!(e.search_talks("  ").is_empty() && e.search_talks("zebra").is_empty());
        e.mark_talk(other, |m| m.archived = false).unwrap();
        assert!(!e.talks()[1].archived, "undone");
    }
}
