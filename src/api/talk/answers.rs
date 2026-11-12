//! Answers: the conversation, runs and attachments.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;
use crate::core::held::Held;

fn drawn(f: &crate::core::figure::Figure) -> Node {
    let mut f = f.clone();
    let filled = match f.from().cloned() {
        Some(from) => crate::core::tables::query(&from, crate::core::tables::MAX_ROWS).and_then(|v| crate::elements::whiteboard::table_of(&v)).and_then(|(c, r)| f.fill(&c, &r)),
        None => Ok(()),
    };
    let n = Node::figure(&f);
    match filled {
        Ok(()) => n,
        Err(e) => n.note(&format!("its data could not be read: {e}")),
    }
}

/// The chat's view of a conversation whose turns and drawings are `turns` and `shown`.
fn talk_of(e: &crate::core::Engine, turns: Vec<(String, String)>, shown: Vec<crate::core::figure::Shown>) -> Talk {
    let runs = e.runs();
    let port = crate::core::media::senses();
    let mut beats = beats(&turns, &runs, |raw| said(&e.parse(raw)), |id| Chip::of(id, port.sensed(id)));
    let figures: Vec<(u64, Node)> = shown.iter().map(|s| (s.run, drawn(&s.figure))).collect();
    for b in beats.iter_mut() {
        if let Some(id) = b.run.as_ref().map(|r| r.id) {
            b.figures = figures.iter().filter(|(run, _)| *run == id).map(|(_, n)| n.clone()).collect();
        }
    }
    let (activity, detail) = e.activity();
    Talk { beats, board: figures.into_iter().map(|(_, n)| n).collect(), runs: runs.iter().map(Run::outline).collect(), activity, detail }
}

/// Everything the chat shows for the engine at `path`.
pub async fn talk(path: String) -> Result<Talk, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    let (turns, shown) = {
        let els = e.elements.held();
        (els.iter().flat_map(|c| c.transcript()).collect::<Vec<_>>(), els.iter().flat_map(|c| c.figures()).collect::<Vec<_>>())
    };
    Ok(talk_of(&e, turns, shown))
}

/// A conversation of the engine at `path` that is put aside, to read, without bringing it back
/// (so it can be read while the engine works in the one open now). The open one's id gives
/// the open one.
pub async fn talk_saved(path: String, id: u64) -> Result<Talk, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    if id == e.current_talk() {
        return talk(path).await;
    }
    let parts = e.talk_parts(id).ok_or_else(|| say(format!("{path} has no conversation {id}")))?;
    let turns = parts.iter().flat_map(|c| c.transcript()).collect();
    let shown = parts.iter().flat_map(|c| c.figures()).collect();
    Ok(talk_of(&e, turns, shown))
}

/// One run in full: every stage with the texts it kept (the prompt, the reply, each result).
pub async fn engine_run(path: String, id: u64) -> Result<Run, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    e.runs().into_iter().find(|r| r.id == id).ok_or_else(|| say(format!("run {id} of {path} is no longer kept")))
}

/// The answer the engine at `path` is writing now, as far as it has come. Its key in the change
/// feed is `said/<engine key>`, marked as the pieces come.
pub async fn run_partial(path: String) -> Result<Arriving, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    let (h, said) = e.heard();
    Ok(Arriving { run: h.run, step: h.step, said, chars: h.text.chars().count() })
}

/// Every conversation of the engine at `path`: the open one first, then the others, last open first.
pub async fn talks(path: String) -> Result<Vec<TalkInfo>, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    Ok(e.talks())
}

/// Begin a new conversation with the engine at `path` (the open one is put aside); its id.
pub async fn talk_new(path: String) -> Result<u64, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    e.new_talk().map_err(say)
}

/// Bring back the conversation `id` of the engine at `path` (the open one is put aside).
pub async fn talk_open(path: String, id: u64) -> Result<(), String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    e.open_talk(id).map_err(say)
}

/// The last runs of an engine as outlines, oldest first.
pub async fn engine_runs(path: String) -> Result<Vec<Run>, String> {
    let e = crate::core::world::find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    Ok(e.runs().iter().map(Run::outline).collect())
}

/// The engines the chat offers as modes, top engines first.
pub async fn modes() -> Result<Vec<Mode>, String> {
    fn walk(e: &crate::core::Engine, out: &mut Vec<Mode>) {
        let f = e.file.held().clone();
        if !f.mode.trim().is_empty() {
            out.push(Mode { name: f.mode.trim().to_string(), path: e.path.clone(), icon: f.icon, about: f.description });
        }
        e.subs().iter().for_each(|s| walk(s, out));
    }
    let mut out = vec![];
    crate::core::world::world().engines.iter().for_each(|e| walk(e, &mut out));
    Ok(out)
}

/// Every engine at work right now, depth first. Empty = nothing is running.
pub async fn busy() -> Result<Vec<Busy>, String> {
    fn walk(e: &crate::core::Engine, out: &mut Vec<Busy>) {
        let (activity, detail) = e.activity();
        if crate::core::engine::working(&activity) {
            let f = e.file.held().clone();
            let run = e.runs().pop().filter(|r| r.running()).map(|r| r.outline());
            out.push(Busy { path: e.path.clone(), name: f.name, icon: f.icon, activity, detail, run });
        }
        e.subs().iter().for_each(|s| walk(s, out));
    }
    let mut out = vec![];
    crate::core::world::world().engines.iter().for_each(|e| walk(e, &mut out));
    Ok(out)
}

fn engine(path: &str) -> Result<std::sync::Arc<crate::core::Engine>, String> {
    crate::core::world::find(path).ok_or_else(|| say(format!("no engine '{path}'")))
}

/// What the engine at `path` may do without asking, and the calls that wait for a yes now.
pub async fn engine_permit(path: String) -> Result<Permit, String> {
    let e = engine(&path)?;
    let mode = e.file.held().permit;
    Ok(Permit { mode: mode.word().into(), waiting: crate::core::permit::waiting(&path) })
}

/// Choose what the engine at `path` may do without asking: `ask`, `edits` or `all`. Kept in
/// its `engine.json`; the next step of a run in hand is already held to it.
pub async fn set_engine_permit(path: String, mode: String) -> Result<(), String> {
    let mode = crate::core::permit::Mode::parse(&mode)?;
    engine(&path)?.set_permit(mode);
    Ok(())
}

/// Answer a call that waits for a yes: `yes` runs it, no tells the engine it was refused.
pub async fn approve(path: String, id: u64, yes: bool) -> Result<(), String> {
    engine(&path)?;
    crate::core::permit::answer(&path, id, yes)
}

/// The model the engine at `path` names itself; empty: it follows the default.
pub async fn engine_model(path: String) -> Result<String, String> {
    Ok(engine(&path)?.file.held().model.clone())
}

/// Name `model` as the engine's own (written in its `engine.json`); empty: follow the default.
pub async fn set_engine_model(path: String, model: String) -> Result<(), String> {
    let e = engine(&path)?;
    let key = crate::core::manifest::manifest().models.clone();
    let known: Vec<String> = crate::core::store::data().get(&key).and_then(|t| serde_json::from_str::<crate::core::models::Models>(&t).ok()).map(|m| m.models.into_iter().map(|m| m.name).collect()).unwrap_or_default();
    e.set_model(&model, &known)
}

/// Replace the engine's goal (`/goal` in the composer).
pub async fn set_engine_goal(path: String, text: String) -> Result<(), String> {
    engine(&path)?.set_goal_text(&text)
}

/// Fold the conversation into a summary now (`/compact`); the summary.
pub async fn compact(path: String) -> Result<String, String> {
    engine(&path)?.compact().await
}

/// Send `text` into the run the engine at `path` has in hand: it lands at the run's next step.
/// An engine that is not at work gets it as a plain message instead (0 is given back then).
pub async fn steer(path: String, text: String) -> Result<u64, String> {
    let e = engine(&path)?;
    if text.trim().is_empty() {
        return Err(say("an empty steer"));
    }
    if !crate::core::engine::working(&e.activity().0) {
        crate::core::board::board().post("user", &path, &text, crate::core::board::Cause::Person).map_err(say)?;
        return Ok(0);
    }
    Ok(crate::core::steer::push(&path, &e.key, &text))
}

/// The steers of the engine at `path`: those that wait for its next step, and where the last landed.
pub async fn steers(path: String) -> Result<Vec<Steer>, String> {
    engine(&path)?;
    Ok(crate::core::steer::of(&path))
}

/// Go back to just before the `n`-th asking of the open conversation ("edit from here"); the
/// words asked there, without who sent them.
pub async fn rewind(path: String, n: usize) -> Result<String, String> {
    let raw = engine(&path)?.rewind(n)?;
    Ok(crate::core::media::without_refs(&sender(&raw).1))
}

/// Name the conversation `id` (empty: it goes by its first message again).
pub async fn talk_rename(path: String, id: u64, name: String) -> Result<(), String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
    engine(&path)?.mark_talk(id, |m| m.name = name)
}

/// Put the conversation `id` away (`archived`), or back in the list.
pub async fn talk_archive(path: String, id: u64, archived: bool) -> Result<(), String> {
    engine(&path)?.mark_talk(id, |m| m.archived = archived)
}

/// Mark the conversation `id` as done with (`settled`), or not.
pub async fn talk_settle(path: String, id: u64, settled: bool) -> Result<(), String> {
    engine(&path)?.mark_talk(id, |m| m.settled = settled)
}

/// Snooze the conversation `id` for `minutes`: out of the list until then; 0 wakes it now.
pub async fn talk_snooze(path: String, id: u64, minutes: u64) -> Result<(), String> {
    let until = crate::core::talks::snooze_until(minutes.min(60 * 24 * 365));
    engine(&path)?.mark_talk(id, |m| m.snooze = until)
}

/// Every conversation of the engine whose title or words hold `query`.
pub async fn talk_search(path: String, query: String) -> Result<Vec<TalkHit>, String> {
    Ok(engine(&path)?.search_talks(&query))
}

/// Start sending a file; returns the id its pieces go to.
#[cfg(feature = "server")]
pub async fn media_begin(name: String, mime: String) -> Result<String, String> {
    crate::core::world::world();
    crate::host::media::begin(&name, &mime).map_err(say)
}

/// The next piece of a file, as base64; returns its size so far.
#[cfg(feature = "server")]
pub async fn media_piece(id: String, data: String) -> Result<u64, String> {
    let bytes = crate::core::media::unb64(&data).map_err(say)?;
    crate::host::media::append(&id, &bytes).map_err(say)
}

/// The file is whole: sense it (this takes as long as hearing or taking frames takes).
#[cfg(feature = "server")]
pub async fn media_done(id: String) -> Result<Chip, String> {
    let s = crate::host::media::finish(&id).await.map_err(say)?;
    Ok(Chip::of(&id, Some(s)))
}

/// An attachment's first picture as a `data:` URL; empty when it has none.
#[cfg(feature = "server")]
pub async fn media_picture(id: String) -> Result<String, String> {
    Ok(crate::host::media::preview(&id).map(|(mime, bytes)| format!("data:{mime};base64,{}", crate::core::media::b64(&bytes))).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{Call, Reply};
    use serde_json::json;

    fn turn(role: &str, text: &str) -> (String, String) {
        (role.into(), text.into())
    }

    #[test]
    fn a_conversation_is_beats_each_tied_to_the_run_that_answered_it() {
        let turns = vec![turn("summary", "earlier: fractions"), turn("user", "from user: why? [media:img1]"), turn("model", "act"), turn("tool", "plot() → ok"), turn("model", "because"), turn("user", "from user: why? [media:img1]"), turn("model", "again")];
        let runs = vec![Run::new(1, "from user: why? [media:img1]", ""), Run::new(2, "an alert fired", ""), Run::new(3, "from user: why? [media:img1]", "")];
        let b = beats(&turns, &runs, |raw| if raw == "act" { vec![] } else { vec![raw.to_string()] }, |id| Chip::of(id, crate::core::media::senses().sensed(id)));
        assert_eq!(b.iter().map(|x| (x.from.as_str(), x.text.as_str())).collect::<Vec<_>>(), [("summary", "earlier: fractions"), ("user", "why?"), ("user", "why?")]);
        assert_eq!(b[1].replies, ["because"], "a reply that only calls tools is not a bubble");
        assert_eq!((b[1].run.as_ref().unwrap().id, b[2].run.as_ref().unwrap().id), (1, 3), "the same question twice: each its own run");
        assert_eq!((b[1].media[0].kind.as_str(), b[1].media[0].pictures), ("image", 1));
        assert!(b[0].run.is_none());
    }

    #[test]
    fn what_was_said_is_the_answer_and_what_went_back_through_the_box() {
        let call = |tool: &str, args| Call { tool: tool.into(), args };
        let r = Reply { calls: vec![call("ack", json!({"reply": " on it "})), call("post", json!({"to": "askk/dev", "text": "do x"})), call("post", json!({"to": "user", "text": "done"})), call("plot", json!({}))], answer: Some("done".into()), ..Default::default() };
        assert_eq!(said(&r), ["on it", "done"]);
        assert_eq!(sender("from askk/guru: hi: there"), ("askk/guru".into(), "hi: there".into()));
        assert_eq!(sender("from here on: go"), ("user".into(), "from here on: go".into()));
    }
}
