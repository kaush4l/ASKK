//! # Engine
//! An engine is its elements. It is initialised from an [`EngineFile`] plus element [`Spec`]s,
//! and it is itself a [`Tool`] (name, description, `invoke(input)`), so engines nest: every
//! sub-engine appears in its parent's toolbox.
//!
//! One run: `Input` → per step (refresh live artifacts → prompt → model → `Reply` → parse →
//! run calls → `Called`) until a reply has no calls, gives an answer, or `max_steps` is hit.
//! State is saved through the `save` hook after every step, so a restart resumes.
use crate::core::held::Held;
use super::*;
use crate::core::node::{Node, Size};
use std::sync::Mutex;

fn default_steps() -> usize {
    8
}

/// `engine.json`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EngineFile {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Model name; empty = the default in models.json.
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_steps")]
    pub max_steps: usize,
    /// idle | running | stopped | interrupted | error: …
    #[serde(default)]
    pub status: String,
    /// Context window override in tokens; 0 = use the model's. At 90% the engine refocuses (folds history).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub context: usize,
    /// Emoji or icon name for its small view and card; empty = the engine icon.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    /// The stages this engine runs each step (see [`super::flow`]); left out = all of them.
    #[serde(default, skip_serializing_if = "super::flow::Flow::is_whole")]
    pub flow: super::flow::Flow,
    /// The conversation mode this engine is (`translator`, `guru`, …): the chat offers every
    /// engine that names one, under that name. Empty = not offered as a mode.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub mode: String,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

const REFOCUS: &str = "The context is nearly full. Summarise, in a few lines, the essentials needed to continue and the lessons learnt (what worked, what failed). Reply with the summary only.";

/// The input as shown at `step`: after the first step the model is reminded that its calls
/// for this request already ran (their results end the history), so it continues, not restarts.
pub fn continued(input: &str, step: usize) -> String {
    if step == 0 {
        input.into()
    } else {
        format!("{input}\n\n(step {}: your calls for this request and their results are the last lines of history; continue from there, do not repeat them)", step + 1)
    }
}

pub type Save = Arc<dyn Fn(&Engine) + Send + Sync>;

/// Whether an activity means the engine is at work right now. An engine that stopped or failed
/// is not idle, but it is not running either.
pub fn working(activity: &str) -> bool {
    matches!(activity, "thinking" | "calling" | "refocusing")
}

pub struct Engine {
    pub file: Mutex<EngineFile>,
    /// Slash path from the engines folder, e.g. `askk/designer`.
    pub path: String,
    pub elements: Mutex<Vec<Box<dyn Component>>>,
    /// The recipe config of each element built from holes, by name: what is saved, so a bound
    /// value never reaches the engine's files.
    pub recipes: std::collections::HashMap<String, Value>,
    /// Sub-engines; `create_engine` / `dismiss_engine` change them while running.
    pub subs: Mutex<Vec<Arc<Engine>>>,
    /// Shared tools; an engine uses one only if an element `selects` it.
    pub shared: Vec<Arc<dyn Tool>>,
    pub infer: Arc<dyn Infer>,
    pub save: Option<Save>,
    /// Set by `stop()`; checked before every step.
    pub stopping: std::sync::atomic::AtomicBool,
    /// Bumped on every save; the UI waits on it for live updates.
    pub version: std::sync::atomic::AtomicU64,
    /// What the engine is doing right now: (activity, detail). Activities: idle, thinking
    /// (waiting on the model), calling (tools running; detail = their names), refocusing,
    /// stopped, error. Every change bumps `version`, so views update live.
    pub activity: Mutex<(String, String)>,
    /// The stages of the current (or last) run, as entered (see [`super::flow`]).
    pub trace: Mutex<Vec<super::flow::Stage>>,
    /// The last runs, step by step, oldest first ([`super::run`]); the last one may be running.
    pub runs: Mutex<std::collections::VecDeque<super::run::Run>>,
    /// When the current run began, and when its open stage began.
    clock: Mutex<(web_time::Instant, web_time::Instant)>,
    /// The run record changed since it was last saved.
    pub logged: std::sync::atomic::AtomicBool,
    /// A run is in progress (see [`Engine::wake`]).
    pub busy: std::sync::atomic::AtomicBool,
    /// A wake arrived during a run: run again after it.
    pub pending: std::sync::atomic::AtomicBool,
    /// Held for the whole of a run: whoever asks for a run while one is going (a direct run,
    /// a wake, an alarm, a parent's call) waits its turn, so two runs never share the stages,
    /// the record or the elements.
    pub(crate) turn: futures::lock::Mutex<()>,
    /// An element reads the message box (`Component::receives`); fixed when built, read without locks.
    pub receives: bool,
    /// The engine's key: where it is stored and what it marks in [`super::changes`] when it
    /// changes (`engines/askk/market`; boot sets it, the path until then).
    pub key: String,
}

impl Engine {
    pub fn new(
        file: EngineFile,
        path: String,
        specs: Vec<Spec>,
        subs: Vec<Arc<Engine>>,
        shared: Vec<Arc<dyn Tool>>,
        infer: Arc<dyn Infer>,
    ) -> Result<Self, String> {
        file.flow.validate().map_err(|err| format!("flow: {err}"))?;
        let mut elements = specs.into_iter().map(build).collect::<Result<Vec<_>, _>>()?;
        for (i, e) in elements.iter().enumerate() {
            if let Some(o) = elements[..i].iter().find(|o| e.unique() && o.kind() == e.kind()) {
                return Err(format!("only one {} element per engine ('{}' and '{}')", e.kind(), o.name(), e.name()));
            }
        }
        let receives = elements.iter().any(|e| e.receives());
        for e in elements.iter_mut() {
            e.on(&Event::Bound(path.clone()));
        }
        let path_key = path.clone();
        Ok(Self {
            file: Mutex::new(file),
            path,
            elements: Mutex::new(elements),
            recipes: Default::default(),
            subs: Mutex::new(subs),
            shared,
            infer,
            save: None,
            stopping: Default::default(),
            version: Default::default(),
            activity: Mutex::new(("idle".into(), String::new())),
            trace: Default::default(),
            runs: Default::default(),
            clock: Mutex::new((web_time::Instant::now(), web_time::Instant::now())),
            logged: Default::default(),
            busy: Default::default(),
            pending: Default::default(),
            turn: Default::default(),
            receives,
            key: path_key,
        })
    }

    /// Something about this engine changed: bump its version and mark its key, so readers
    /// (the UI) pick it up on their next refresh.
    pub fn bump(&self) {
        self.version.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        super::changes::mark(&self.key);
    }

    pub fn name(&self) -> String {
        self.file.held().name.clone()
    }

    pub fn subs(&self) -> Vec<Arc<Engine>> {
        self.subs.held().clone()
    }

    /// Add a sub-engine (refused when one with the same path exists).
    pub fn add_sub(&self, e: Arc<Engine>) -> Result<(), String> {
        let mut subs = self.subs.held();
        if subs.iter().any(|s| s.path == e.path) {
            return Err(format!("engine '{}' exists", e.path));
        }
        subs.push(e);
        drop(subs);
        self.bump();
        Ok(())
    }

    /// Remove the direct sub-engine at `path`; returns it.
    pub fn remove_sub(&self, path: &str) -> Option<Arc<Engine>> {
        let mut subs = self.subs.held();
        let i = subs.iter().position(|s| s.path == path)?;
        let e = subs.remove(i);
        drop(subs);
        e.stop();
        self.bump();
        Some(e)
    }

    /// Run on new messages without blocking the caller. A wake during a run is queued: the
    /// engine runs once more after the current run (however many wakes arrived meanwhile).
    pub fn wake(self: &Arc<Self>) {
        use std::sync::atomic::Ordering::SeqCst;
        self.pending.store(true, SeqCst);
        if self.busy.swap(true, SeqCst) {
            return;
        }
        let e = self.clone();
        let started = super::tasks::spawn(Box::pin(async move {
            loop {
                while e.pending.swap(false, SeqCst) {
                    // The run's input is the new messages themselves, so history reads like the conversation.
                    let new = super::board::board().new_for(&e.path);
                    // A wake whose messages an earlier run already acked: nothing to do.
                    if new.is_empty() {
                        continue;
                    }
                    let input = { new.iter().map(super::board::Message::line).collect::<Vec<_>>().join("\n") };
                    match e.run(&input).await {
                        // Messages the run left unacked are answered with its final text, so a
                        // sender always hears back even when the model forgot to ack or answer.
                        Ok(out) => {
                            let ids: Vec<u64> = new.iter().map(|m| m.id).collect();
                            let left: Vec<_> = super::board::board().new_for(&e.path).into_iter().filter(|m| ids.contains(&m.id)).collect();
                            let text = out.to_string();
                            if !left.is_empty() && !text.trim().is_empty() {
                                super::board::board().ack_ids(&e.path, &left.iter().map(|m| m.id).collect::<Vec<_>>());
                                // One report per sender, on the last message it left, so the thread
                                // holds. Answers and reports get none: two engines would ping-pong.
                                let mut last: std::collections::BTreeMap<&str, u64> = Default::default();
                                for m in left.iter().filter(|m| !matches!(m.kind, super::board::Act::Report | super::board::Act::Answer)) {
                                    last.insert(&m.from, m.id);
                                }
                                for (t, about) in last {
                                    if let Err(err) = super::board::board().send(super::board::Draft::reply(&e.path, t, super::board::Act::Report, about, &text)) {
                                        eprintln!("askk: {}: report to {t}: {err}", e.path);
                                    }
                                }
                            }
                        }
                        Err(err) => eprintln!("askk: {}: {err}", e.path),
                    }
                }
                e.busy.store(false, SeqCst);
                // A wake that landed between the last check and clearing busy.
                if !e.pending.load(SeqCst) || e.busy.swap(true, SeqCst) {
                    break;
                }
            }
        }));
        if !started {
            // Nobody to run it: the messages stay new and are picked up at the next boot.
            self.busy.store(false, SeqCst);
            eprintln!("askk: {}: woken, but this build runs no background work (core/tasks.rs)", self.path);
        }
    }

    pub fn specs(&self) -> Vec<Spec> {
        self.elements.held().iter().map(|e| e.spec()).collect()
    }

    fn set_status(&self, s: &str) {
        self.file.held().status = s.into();
    }

    /// Ask a running engine to stop before its next step.
    pub fn stop(&self) {
        self.stopping.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Changes so far, this engine and its sub-engines (readers use [`super::changes`]).
    #[cfg(test)]
    pub fn total_version(&self) -> u64 {
        self.version.load(std::sync::atomic::Ordering::SeqCst) + self.subs().iter().map(|s| s.total_version()).sum::<u64>()
    }

    /// Set the live activity and wake watchers (not saved: it describes this process only).
    pub fn act(&self, activity: &str, detail: &str) {
        *self.activity.held() = (activity.into(), detail.into());
        self.bump();
    }

    pub fn activity(&self) -> (String, String) {
        self.activity.held().clone()
    }

    pub(crate) fn persist(&self) {
        self.bump();
        if let Some(save) = &self.save {
            save(self);
        }
    }

    pub fn dispatch(&self, ev: &Event) {
        for e in self.elements.held().iter_mut() {
            e.on(ev);
        }
    }

    /// Forget the conversation: history elements drop their turns; notes, goal and learning stay.
    pub fn clear_history(&self) {
        self.dispatch(&Event::Cleared);
        self.set_status("cleared");
        self.persist();
    }

    /// Tools usable now: selected shared tools + element tools + sub-engines, minus vetoes.
    pub fn toolbox(&self) -> Toolbox {
        let els = self.elements.held();
        let mut list: Vec<Arc<dyn Tool>> =
            self.shared.iter().filter(|t| els.iter().any(|e| e.selects(&t.name()))).cloned().collect();
        list.extend(els.iter().flat_map(|e| e.tools()));
        list.extend(self.subs().iter().map(|s| Arc::new(EngineTool(s.clone())) as Arc<dyn Tool>));
        list.retain(|t| els.iter().all(|e| e.allows(&t.name())));
        Toolbox::new(list).logged()
    }

    /// The prompt as ordered sections: elements by [`super::rank`] of their kind (then name),
    /// the toolbox at the `tools` rank, then the input, then the nudges (reply-format reminders). Same engine + input = same prompt.
    pub fn sections(&self, tools: &Toolbox, input: &str) -> Vec<Section> {
        let els = self.elements.held();
        let mut out: Vec<Section> = els
            .iter()
            .filter(|e| els.iter().all(|o| o.shows(e.name())))
            .filter_map(|e| e.prompt().map(|b| Section { name: e.name().into(), kind: e.kind().into(), slot: e.slot(), body: b.trim_end().into() }))
            .collect();
        if let Some(t) = tools.describe() {
            out.push(Section { name: super::TOOLBOX.into(), kind: super::TOOLBOX.into(), slot: super::Slot::Tools, body: t });
        }
        super::order(&mut out);
        out.push(Section { name: "input".into(), kind: "input".into(), slot: super::Slot::Input, body: input.into() });
        let nudges: Vec<String> = els.iter().filter_map(|e| e.nudge()).collect();
        if !nudges.is_empty() {
            out.push(Section { name: "nudge".into(), kind: "nudge".into(), slot: super::Slot::Input, body: nudges.join("\n") });
        }
        out
    }

    /// The refocus prompt: only what the summary needs ([`super::REFOCUS_SLOTS`]: purpose,
    /// knowledge, position, conversation, input); tools, the reply format and the world are left out.
    pub fn refocus_prompt(&self, tools: &Toolbox, input: &str) -> String {
        let keep: Vec<Section> = self.sections(tools, input).into_iter().filter(|s| s.slot != super::Slot::Input || s.kind == "input").filter(|s| super::REFOCUS_SLOTS.contains(&s.slot)).collect();
        super::render(&keep)
    }

    pub fn prompt(&self, tools: &Toolbox, input: &str) -> String {
        super::render(&self.sections(tools, input))
    }

    pub fn parse(&self, reply: &str) -> Reply {
        let els = self.elements.held();
        // No element reads replies (no reply format was asked for): the reply is the answer.
        els.iter().find_map(|e| e.parse(reply)).unwrap_or_else(|| Reply { answer: Some(reply.trim().to_string()), ..Default::default() })
    }

    /// Sampling from the first element that sets it, for `phase` (default: the current phase).
    pub fn sampling(&self, phase: Option<&str>) -> super::Sampling {
        let els = self.elements.held();
        let current = els.iter().find_map(|e| e.phase());
        let phase = phase.map(String::from).or(current);
        els.iter().find_map(|e| e.sampling(phase.as_deref())).unwrap_or_default()
    }

    /// Input budget in tokens: the engine's `context` override, else the model's (minus its reply cap).
    pub async fn budget(&self) -> usize {
        let (model, context) = {
            let f = self.file.held();
            (f.model.clone(), f.context)
        };
        if context > 0 { context } else { self.infer.context(&model).await }
    }

    /// Enter a stage of the run loop: the stage before it is closed with the time it took.
    fn at(&self, stage: super::flow::Stage) {
        {
            let mut t = self.trace.held();
            t.push(stage);
            debug_assert!(super::flow::follows(&t, &self.file.held().flow), "the run left its flow: {t:?}");
        }
        let (ms, total) = self.lap();
        self.record(|r| {
            r.enter(stage, ms);
            r.ms = total;
        });
        self.bump();
    }

    /// Milliseconds since the open stage began (its clock starts again), and since the run began.
    fn lap(&self) -> (u64, u64) {
        let mut c = self.clock.held();
        let now = web_time::Instant::now();
        let ms = now.duration_since(c.1).as_millis() as u64;
        c.1 = now;
        (ms, now.duration_since(c.0).as_millis() as u64)
    }

    /// Write into the record of the current run.
    fn record(&self, f: impl FnOnce(&mut super::run::Run)) {
        if let Some(r) = self.runs.held().back_mut() {
            f(r);
        }
        self.logged.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Say what the open stage did (one line, and the texts to read in full).
    fn note(&self, note: &str, detail: Vec<(String, String)>) {
        self.record(|r| r.note(note, detail));
    }

    /// The last runs, oldest first.
    pub fn runs(&self) -> Vec<super::run::Run> {
        self.runs.held().iter().cloned().collect()
    }

    /// The current run's record if it changed since it was last asked for (the save hook
    /// writes it).
    pub fn take_logged(&self) -> Option<super::run::Run> {
        self.logged.swap(false, std::sync::atomic::Ordering::SeqCst).then(|| self.runs.held().back().cloned()).flatten()
    }

    /// Open the record of a new run and tell the elements which run it is.
    fn begin(&self, input: &str, model: &str) -> u64 {
        let now = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let id = {
            let mut runs = self.runs.held();
            let id = now.max(runs.back().map_or(0, |r| r.id + 1));
            runs.push_back(super::run::Run::new(id, input, model));
            while runs.len() > super::run::KEEP {
                runs.pop_front();
            }
            id
        };
        let t = web_time::Instant::now();
        *self.clock.held() = (t, t);
        self.logged.store(true, std::sync::atomic::Ordering::SeqCst);
        self.dispatch(&Event::Started { run: id });
        id
    }

    /// Close the record of the current run with how it ended.
    fn end(&self, out: &Result<String, String>) {
        let status = self.file.held().status.clone();
        let (how, answer) = match out {
            Err(e) => ("error", e.clone()),
            Ok(_) if status == "stopped" => ("stopped", String::new()),
            Ok(a) if a.starts_with("stopped after ") => ("out of steps", a.clone()),
            Ok(a) => ("done", a.clone()),
        };
        let (ms, total) = self.lap();
        self.record(|r| {
            r.close(ms);
            r.status = how.into();
            r.answer = super::run::cut(&answer);
            r.ms = total;
        });
    }

    /// The stages of the current (or last) run, in the order they were entered.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn trace(&self) -> Vec<super::flow::Stage> {
        self.trace.held().clone()
    }

    /// One run: the loop described in [`super::flow`], with the stages this engine's `flow`
    /// lists. One at a time: a run asked for during another starts when that one has ended.
    pub async fn run(&self, input: &str) -> Result<String, String> {
        let _turn = self.turn.lock().await;
        let model = self.file.held().model.clone();
        self.begin(input, &model);
        let out = self.steps(input).await;
        if out.is_err() && self.file.held().status == "running" {
            let e = out.clone().unwrap_err();
            self.act("error", &e);
            self.set_status(&format!("error: {e}"));
        }
        self.end(&out);
        self.persist();
        out
    }

    /// The steps of one run (the record is opened and closed by [`Engine::run`]).
    async fn steps(&self, input: &str) -> Result<String, String> {
        use super::flow::Stage;
        use std::sync::atomic::Ordering;
        self.stopping.store(false, Ordering::SeqCst);
        self.set_status("running");
        self.trace.held().clear();
        self.at(Stage::Input);
        self.dispatch(&Event::Input(input.into()));
        // Saved before the first model call: a run cut off there (the process or the tab dies)
        // is on disk as `running`, and the next boot reads it back as `interrupted`.
        self.persist();
        let (model, steps, flow) = {
            let f = self.file.held();
            (f.model.clone(), f.max_steps, f.flow.clone())
        };
        let context = self.budget().await;
        for step in 0..steps {
            if self.stopping.swap(false, Ordering::SeqCst) {
                self.act("stopped", "");
                self.set_status("stopped");
                self.persist();
                return Ok("stopped".into());
            }
            let tools = self.toolbox();
            let (ms, _) = self.lap();
            self.record(|r| {
                r.close(ms);
                r.step(step + 1);
            });
            if flow.has(Stage::Refresh) {
                self.at(Stage::Refresh);
                let refresh: Vec<(String, Call)> = self
                    .elements
                    .lock()
                    .unwrap()
                    .iter()
                    .filter_map(|e| e.refresh().map(|c| (e.name().to_string(), c)))
                    .collect();
                let quiet = Toolbox(tools.0.clone(), None);
                let mut read = vec![];
                for (name, c) in refresh {
                    let content = match quiet.call(&c.tool, c.args).await {
                        Ok(v) => text(&v),
                        Err(e) => format!("error: {e}"),
                    };
                    read.push((name.clone(), content.clone()));
                    self.dispatch(&Event::Snapshot { name, content });
                }
                self.note(&if read.is_empty() { "nothing to re-read".to_string() } else { format!("re-read {}", read.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", ")) }, read);
            }
            self.at(Stage::Prompt);
            let shown = continued(input, step);
            let mut prompt = self.prompt(&tools, &shown);
            let outline = |e: &Engine| {
                let secs = e.sections(&tools, &shown);
                let lines: Vec<String> = secs.iter().map(|s| format!("{:>6}  {}{}", super::tokens(&s.body), s.name, if s.kind == s.name { String::new() } else { format!(" ({})", s.kind) })).collect();
                (secs.len(), format!("tokens  section\n{}", lines.join("\n")))
            };
            let (n, sections) = outline(self);
            self.note(&format!("{n} sections · ~{} tokens", super::tokens(&prompt)), vec![("sections".into(), sections), ("prompt".into(), prompt.clone())]);
            if flow.has(Stage::Observe) {
                self.at(Stage::Observe);
                if context > 0 {
                    // Observations only (refocus is the 90% rule): how full the budget is, and the history's share.
                    let history: usize = self.sections(&tools, "").iter().filter(|s| s.slot == super::Slot::Conversation).map(|s| super::tokens(&s.body)).sum();
                    let (full, hist) = (super::tokens(&prompt) as f64 / context as f64, history as f64 / context as f64);
                    self.dispatch(&Event::Observed { name: "prompt_share".into(), value: full });
                    self.dispatch(&Event::Observed { name: "history_share".into(), value: hist });
                    self.note(&format!("context {:.1}% full · history {:.1}% · refocus at 90%", full * 100.0, hist * 100.0), vec![]);
                } else {
                    self.note("context size unknown: nothing to measure against", vec![]);
                }
            }
            if flow.has(Stage::Refocus) && context > 0 && super::tokens(&prompt) * 10 >= context * 9 {
                self.at(Stage::Refocus);
                self.act("refocusing", "");
                let how = self.elements.held().iter().find_map(|e| e.refocus()).unwrap_or_else(|| REFOCUS.into());
                let summary = self.infer.complete(&model, format!("{how}\n\n{}", self.refocus_prompt(&tools, &shown)), self.sampling(Some("refocus"))).await?;
                self.note("history folded into a summary", vec![("instruction".into(), how), ("summary".into(), summary.clone())]);
                self.dispatch(&Event::Folded(summary));
                prompt = self.prompt(&tools, &shown);
            }
            self.at(Stage::Think);
            self.act("thinking", &format!("step {}", step + 1));
            let sampling = self.sampling(None);
            let media: Vec<super::media::Attachment> = self.elements.held().iter().flat_map(|e| e.media()).collect();
            let asked = format!(
                "{}{}{}",
                if model.is_empty() { "the default model".to_string() } else { model.clone() },
                match (sampling.temperature, sampling.top_p) {
                    (None, None) => String::new(),
                    (t, p) => format!(" · sampling {}", [t.map(|t| format!("temperature {t}")), p.map(|p| format!("top_p {p}"))].into_iter().flatten().collect::<Vec<_>>().join(", ")),
                },
                if media.is_empty() { String::new() } else { format!(" · shown {} image(s)", media.len()) }
            );
            let shown_media: Vec<(String, String)> = media.iter().map(|m| (format!("shown: {}", m.id), if m.label.is_empty() { m.mime.clone() } else { format!("{} ({})", m.label, m.mime) })).collect();
            self.note(&asked, shown_media);
            let reply = match self.stream(&model, prompt, sampling, media, step + 1).await {
                Ok(r) => r,
                Err(e) => {
                    self.note(&format!("{asked} · failed"), vec![("error".into(), e.clone())]);
                    self.act("error", &e);
                    self.set_status(&format!("error: {e}"));
                    self.persist();
                    return Err(e);
                }
            };
            self.note(&format!("{asked} · replied ~{} tokens", super::tokens(&reply)), vec![("reply".into(), reply.clone())]);
            self.at(Stage::Parse);
            self.dispatch(&Event::Reply(reply.clone()));
            let parsed = self.parse(&reply);
            {
                let mut d: Vec<(String, String)> = parsed.fields.clone();
                d.extend(parsed.calls.iter().map(|c| ("call".to_string(), super::tool::call_sig(&c.tool, &c.args))));
                d.extend(parsed.answer.iter().map(|a| ("answer".to_string(), a.clone())));
                let what = match (parsed.calls.len(), parsed.answer.is_some()) {
                    (0, true) => "an answer".to_string(),
                    (0, false) => "nothing to run and no answer".to_string(),
                    (n, false) => format!("{n} call(s)"),
                    (n, true) => format!("{n} call(s) and an answer"),
                };
                self.note(&format!("read as {what}{}", if parsed.fields.is_empty() { String::new() } else { format!(" · fields: {}", parsed.fields.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(", ")) }), d);
            }
            // An engine whose flow has no `act` never calls a tool: its first reply is its answer.
            let acts = flow.has(Stage::Act);
            if acts {
                self.at(Stage::Act);
                if !parsed.calls.is_empty() {
                    self.act("calling", &parsed.calls.iter().map(|c| c.tool.as_str()).collect::<Vec<_>>().join(", "));
                }
                // All calls of one reply start together; results are recorded in completion order.
                let calls: Vec<_> = parsed.calls.iter().map(|c| Box::pin(tools.call(&c.tool, c.args.clone()))).collect();
                if parsed.wait_any && !calls.is_empty() {
                    let _ = futures::future::select_all(calls).await;
                } else {
                    futures::future::join_all(calls).await;
                }
            }
            let done = tools.drain();
            if acts {
                let results: Vec<(String, String)> = done.iter().filter_map(|ev| match ev { Event::Called { tool, args, result } => Some((super::tool::call_sig(tool, args), result.clone())), _ => None }).collect();
                let failed = results.iter().filter(|(_, r)| r.starts_with("error")).count();
                self.note(&match (results.len(), failed) { (0, _) => "no tool was called".to_string(), (n, 0) => format!("{n} call(s) ran"), (n, f) => format!("{n} call(s) ran · {f} failed") }, results);
            }
            for ev in done {
                self.dispatch(&ev);
            }
            self.at(Stage::Save);
            self.note("state written", vec![]);
            self.persist();
            if !acts || parsed.calls.is_empty() || parsed.answer.is_some() {
                self.act("idle", "");
                self.set_status("idle");
                self.persist();
                return Ok(parsed.answer.unwrap_or(reply));
            }
        }
        self.act("idle", "");
        self.set_status("idle");
        self.persist();
        Ok(format!("stopped after {steps} steps"))
    }

    /// Everything this engine polls (alerts).
    pub fn watches(&self) -> Vec<Watch> {
        self.elements.held().iter().filter_map(|e| e.watch()).collect()
    }

    /// Feed an observation; returns the inputs to wake the engine with.
    pub fn observe(&self, name: &str, value: f64) -> Vec<String> {
        self.dispatch(&Event::Observed { name: name.into(), value });
        let wakes = self.elements.held().iter_mut().filter_map(|e| e.wake()).collect();
        self.persist();
        wakes
    }

    pub fn find(self: &Arc<Self>, path: &str) -> Option<Arc<Engine>> {
        if self.path == path {
            return Some(self.clone());
        }
        self.subs().iter().find_map(|s| s.find(path))
    }

    /// The engine at one of the three sizes, carrying its live activity.
    /// - small: its icon (emoji from `engine.json` `icon`) with the activity orb.
    /// - medium: a card: icon 2×2 with activity and the phase (or what it is doing), a row of
    ///   icons for the tools and live artifacts it holds, then its description (scrolls).
    /// - large: the state view: the card head, recent tool calls, live artifacts and alerts at
    ///   medium, every element at medium, sub-engines small.
    /// Elements of the `hidden` kinds are left out (layout config).
    pub fn render(&self, size: Size, hidden: &[String]) -> Node {
        let f = self.file.held().clone();
        let (act, detail) = self.activity();
        let n = Node::object("engine", &f.name, size, &act).icon(&f.icon);
        if size == Size::Small {
            return n;
        }
        let els = self.elements.held();
        let phase = els.iter().find_map(|e| e.indicator());
        let note = if !detail.is_empty() { detail } else { phase.unwrap_or_else(|| if f.status.is_empty() || f.status == "idle" { String::new() } else { f.status.clone() }) };
        // Bottom half of the card: what it can use, grouped by type. Element tools that only
        // edit its own notes (goal, focus, learning) or reply format are left out.
        let mut tool_names: Vec<String> = self.shared.iter().map(|t| t.name()).filter(|t| els.iter().any(|e| e.selects(t))).collect();
        tool_names.extend(els.iter().flat_map(|e| e.abilities()));
        let group = |items: Vec<(String, String)>| {
            let mut g: Vec<(String, String)> = vec![];
            for (icon, name) in items {
                match g.iter_mut().find(|(i, _)| *i == icon) {
                    Some((_, l)) => { l.push_str(", "); l.push_str(&name); }
                    None => g.push((icon, name)),
                }
            }
            g
        };
        let tools = group(tool_names.into_iter().map(|t| (crate::core::node::tool_icon(&t).to_string(), t)).collect());
        let live_names = group(els.iter().filter(|e| e.category() == "live").map(|e| (e.icon().to_string(), e.name().to_string())).collect());
        let subs: Vec<(String, String)> = self.subs().iter().map(|s| { let i = s.file.held().icon.clone(); (if i.is_empty() { "engine".into() } else { i }, s.name()) }).collect();
        let mut n = n.note(&note);
        let link = Node::new("link").label("Open").text(&format!("/e/{}", self.path));
        if size == Size::Medium {
            // Card: name (status), phase, short summary | tools | logs: recent call icons, then the last result.
            n = n.child(Node::new("summary").text(&summary(&els, &f.description)));
            // Log: each call with its parameters, then its result, newest last.
            let log: Vec<(String, String)> = els.iter().flat_map(|e| e.log()).collect();
            let calls: Vec<Node> = log[log.len().saturating_sub(5)..].iter().map(|(c, r)| Node::new("call").label(c).text(r)).collect();
            n = if calls.is_empty() { n.child(Node::new("muted").text("No tool calls yet")) } else { n.child(Node::new("calls").label("Log").children(calls)) };
            return n.child(link);
        }
        // Large = the expanded state view: artifacts first, then the run log, then what it holds.
        if !f.description.is_empty() {
            n = n.child(Node::new("summary").text(&summary(&els, &f.description)));
        }
        let live: Vec<Node> = els.iter().filter(|e| e.category() == "live" && !hidden.iter().any(|h| h == e.kind())).map(|e| e.render(Size::Medium)).collect();
        if !live.is_empty() {
            n = n.child(Node::new("heading").text("Artifacts")).child(Node::new("grid").children(live));
        }
        let calls: Vec<Node> = els.iter().flat_map(|e| e.log()).map(|(c, r)| Node::new("call").label(&c).text(&r)).collect();
        if !calls.is_empty() {
            n = n.child(Node::new("heading").text("Log")).child(Node::new("calls").label("Log").children(calls));
        }
        // What it holds, as words (names matter here, icons do not).
        for (label, items) in [("Tools", tools), ("Live", live_names), ("Engines", subs)] {
            if !items.is_empty() {
                let names: Vec<String> = items.into_iter().map(|(_, n)| n).collect();
                n = n.child(Node::new("muted").label(label).text(&format!("{label}: {}", names.join(", "))));
            }
        }
        let rest: Vec<Node> = els.iter().filter(|e| e.category() != "live" && !hidden.iter().any(|h| h == e.kind())).map(|e| e.render(Size::Medium)).collect();
        if !rest.is_empty() {
            n = n.child(Node::new("heading").text("Elements")).child(Node::new("grid").children(rest));
        }
        let subs = self.subs();
        if !subs.is_empty() {
            n = n.child(Node::new("heading").text("Sub-engines")).child(Node::new("grid").children(subs.iter().map(|s| s.render(Size::Medium, hidden)).collect()));
        }
        n
    }

}

/// The card's short summary: the first element summary (latest reply summary, else the refocus
/// summary), else the description. (How to summarise past transcripts better is still open.)
pub fn summary(els: &[Box<dyn super::Component>], description: &str) -> String {
    els.iter().find_map(|e| e.summary()).unwrap_or_else(|| description.to_string())
}

/// An engine as a tool: `{"input": "..."}` → its answer.
pub struct EngineTool(pub Arc<Engine>);

impl Tool for EngineTool {
    fn name(&self) -> String {
        self.0.name()
    }
    fn description(&self) -> String {
        let d = self.0.file.held().description.clone();
        if d.is_empty() { format!("the {} engine", self.0.name()) } else { d }
    }
    fn args(&self) -> Value {
        serde_json::json!({"input": "text"})
    }
    fn invoke(&self, args: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        let e = self.0.clone();
        let input = args["input"].as_str().map(String::from).unwrap_or_else(|| text(&args));
        Box::pin(async move { e.run(&input).await.map(Value::String) })
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;

    /// A fake runtime: replies from a list, records every prompt.
    pub struct Scripted {
        pub replies: Mutex<VecDeque<String>>,
        pub prompts: Mutex<Vec<String>>,
        pub samplings: Mutex<Vec<crate::core::Sampling>>,
    }

    impl Scripted {
        pub fn new(replies: &[&str]) -> Arc<Self> {
            Arc::new(Self { replies: Mutex::new(replies.iter().map(|s| s.to_string()).collect()), prompts: Mutex::default(), samplings: Mutex::default() })
        }
    }

    impl Infer for Scripted {
        fn complete(&self, _: &str, prompt: String, sampling: crate::core::Sampling) -> Fut<Result<String, String>> {
            self.prompts.held().push(prompt);
            self.samplings.held().push(sampling);
            let r = self.replies.held().pop_front().ok_or_else(|| "no more replies".to_string());
            Box::pin(async move { r })
        }
    }

    pub fn file(name: &str) -> EngineFile {
        EngineFile { name: name.into(), description: String::new(), model: String::new(), max_steps: 8, status: String::new(), context: 0, icon: String::new(), flow: Default::default(), mode: String::new() }
    }

    pub fn spec(kind: &str, name: &str, config: Value) -> Spec {
        Spec { kind: kind.into(), name: name.into(), config, state: Value::Null }
    }

    /// The reply-format element: an engine reads tool calls only when it has one.
    pub fn reply() -> Spec {
        spec("handoff", "handoff", json!({"nudge": "off"}))
    }

    pub fn add() -> Arc<dyn Tool> {
        tool("add", "sum", Value::Null, |a| Ok(json!(a["a"].as_f64().unwrap_or(0.0) + a["b"].as_f64().unwrap_or(0.0))))
    }

    #[test]
    fn a_second_singleton_element_is_refused() {
        let specs = vec![reply(), spec("handoff", "other", Value::Null)];
        let err = Engine::new(file("e"), "e".into(), specs, vec![], vec![], Scripted::new(&[])).err().unwrap();
        assert!(err.contains("only one handoff"), "{err}");
    }

    #[tokio::test]
    async fn engine_without_elements_shows_only_input() {
        let e = Engine::new(file("e"), "e".into(), vec![], vec![], vec![add()], Scripted::new(&["hi"])).unwrap();
        assert_eq!(e.prompt(&e.toolbox(), "x"), "## input\nx\n");
        assert_eq!(e.run("x").await.unwrap(), "hi");
    }

    #[test]
    fn prompt_runs_goal_learning_tools_format_phase_artifacts_history_input_then_nudge() {
        let specs = vec![
            spec("history", "history", Value::Null),
            spec("handoff", "handoff", Value::Null),
            spec("notes", "goal", json!({"hint": "g"})),
            spec("notes", "learning", json!({"hint": "l"})),
            spec("tools", "tools", json!({"use": ["add"]})),
        ];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], vec![add()], Scripted::new(&[])).unwrap();
        let names: Vec<String> = e.sections(&e.toolbox(), "x").into_iter().map(|s| s.name).collect();
        let at = |n: &str| names.iter().position(|x| x == n).unwrap_or_else(|| panic!("{n} missing: {names:?}"));
        assert!(at("goal") < at("learning") && at("learning") < at("tools") && at("tools") < at("handoff"), "{names:?}");
        assert!(at("handoff") < at("input"), "{names:?}");
        assert_eq!(names.last().unwrap(), "nudge", "the format reminder closes the prompt: {names:?}");
    }

    #[tokio::test]
    async fn selected_tools_are_called_until_an_answer() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"add","args":{"a":2,"b":3}}]}"#, r#"{"answer":"5"}"#]);
        let specs = vec![spec("tools", "tools", json!({"use": ["add"]})), spec("history", "history", Value::Null), reply()];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], vec![add()], infer.clone()).unwrap();
        assert_eq!(e.run("add").await.unwrap(), "5");
        let prompts = infer.prompts.held();
        assert!(prompts[0].contains("- add() — sum"));
        assert!(prompts[1].contains("add(a: 2, b: 3) → 5.0"), "{}", prompts[1]);
        assert!(prompts[0].ends_with("## input\nadd\n") && prompts[1].contains("(step 2: your calls"), "{}", prompts[1]);
        assert_eq!(e.file.held().status, "idle");
        // Two steps, each moving forward through the declared flow.
        use crate::core::flow::{follows, Flow, Stage};
        let trace = e.trace();
        assert!(follows(&trace, &Flow::default()), "{trace:?}");
        assert_eq!(trace.iter().filter(|s| **s == Stage::Think).count(), 2, "{trace:?}");
        assert_eq!(trace.last(), Some(&Stage::Save));
    }

    /// The loop is a value: an engine lists the stages it runs. Without `act` it never calls a
    /// tool, whatever the model writes; a flow the structure does not allow is refused at init.
    #[tokio::test]
    async fn an_engine_runs_only_the_stages_its_flow_lists() {
        use crate::core::flow::{Flow, Stage};
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"add","args":{"a":2,"b":3}}]}"#]);
        let specs = vec![spec("tools", "tools", json!({"use": ["add"]})), spec("history", "history", Value::Null), reply()];
        let mut f = file("e");
        f.flow = serde_json::from_value(json!(["prompt", "think", "parse", "save"])).unwrap();
        let e = Engine::new(f, "e".into(), specs, vec![], vec![add()], infer.clone()).unwrap_or_else(|e| panic!("{e}"));
        e.run("add").await.unwrap();
        assert_eq!(e.trace(), [Stage::Input, Stage::Prompt, Stage::Think, Stage::Parse, Stage::Save], "one step, no refresh, no act");
        assert_eq!(infer.prompts.held().len(), 1, "the reply's call was not made, so the model was not asked again");

        let refused = |flow: Value| {
            let mut f = file("e");
            f.flow = serde_json::from_value::<Flow>(flow).unwrap();
            Engine::new(f, "e".into(), vec![], vec![], vec![], Scripted::new(&[])).err().unwrap_or_default()
        };
        assert!(refused(json!(["think", "prompt", "parse", "save"])).contains("order"), "stages keep their order");
        assert!(refused(json!(["prompt", "parse", "save"])).contains("think"), "a loop without the model is not a loop");
        assert!(refused(json!(["prompt", "think", "think", "parse", "save"])).contains("order"), "no stage twice");
        assert!(serde_json::from_value::<Flow>(json!(["prompt", "dream"])).is_err(), "an unknown stage is not a stage");
    }

    /// A runtime that takes a moment to answer and counts how many calls are inside it at once.
    #[derive(Default)]
    struct Crowd {
        inside: Arc<std::sync::atomic::AtomicUsize>,
        most: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl Infer for Crowd {
        fn complete(&self, _: &str, _: String, _: crate::core::Sampling) -> Fut<Result<String, String>> {
            use std::sync::atomic::Ordering::SeqCst;
            let (inside, most) = (self.inside.clone(), self.most.clone());
            Box::pin(async move {
                most.fetch_max(inside.fetch_add(1, SeqCst) + 1, SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                inside.fetch_sub(1, SeqCst);
                Ok(r#"{"answer":"ok"}"#.to_string())
            })
        }
    }

    /// A run asked for while another is going (a direct run, a wake, an alarm, a parent's
    /// call) waits for it: two runs of one engine never interleave their stages.
    #[tokio::test]
    async fn one_engine_runs_one_run_at_a_time() {
        let infer = Arc::new(Crowd::default());
        let e = Arc::new(Engine::new(file("e"), "e".into(), vec![spec("history", "h", Value::Null), reply()], vec![], vec![], infer.clone()).unwrap());
        let (a, b) = (e.clone(), e.clone());
        let (x, y) = tokio::join!(tokio::spawn(async move { a.run("first").await }), tokio::spawn(async move { b.run("second").await }));
        assert_eq!(x.unwrap().unwrap(), "ok");
        assert_eq!(y.unwrap().unwrap(), "ok");
        assert_eq!(infer.most.load(std::sync::atomic::Ordering::SeqCst), 1, "the second run waited for the first");
        assert_eq!(e.runs().len(), 2, "both runs happened");
        assert!(e.runs().iter().all(|r| r.status == "done"), "and each closed its own record");
    }

    #[tokio::test]
    async fn an_engine_is_a_tool_of_its_parent() {
        let child = Arc::new(
            Engine::new(file("helper"), "p/helper".into(), vec![], vec![], vec![], Scripted::new(&["from child"])).unwrap(),
        );
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"helper","args":{"input":"go"}}]}"#, r#"{"answer":"done"}"#]);
        let parent =
            Engine::new(file("p"), "p".into(), vec![spec("history", "h", Value::Null), reply()], vec![child], vec![], infer.clone()).unwrap();
        assert!(parent.toolbox().names().contains(&"helper".to_string()));
        assert_eq!(parent.run("x").await.unwrap(), "done");
        assert!(infer.prompts.held()[1].contains("from child"));
    }

    #[tokio::test]
    async fn calls_made_inside_a_script_reach_the_components() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"keep"}]}"#, r#"{"answer":"ok"}"#]);
        let specs = vec![
            spec("state", "memory", Value::Null),
            spec("script", "keep", json!({"steps": [{"tool": "remember", "args": {"key": "k", "value": 7}}]})),
            reply(),
        ];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], vec![], infer.clone()).unwrap();
        e.run("x").await.unwrap();
        assert_eq!(e.specs()[0].state, json!({"k": 7}));
        assert!(infer.prompts.held()[1].contains("{\"k\":7}"));
    }

    struct Slow(&'static str, u64);
    impl Tool for Slow {
        fn name(&self) -> String { self.0.into() }
        fn description(&self) -> String { "waits".into() }
        fn invoke(&self, _: Value, _: Toolbox) -> Fut<Result<Value, String>> {
            let ms = self.1;
            Box::pin(async move {
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                Ok(json!(ms))
            })
        }
    }

    #[tokio::test]
    async fn calls_in_one_reply_run_concurrently_and_report_in_completion_order() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"slow"},{"tool":"fast"}]}"#, r#"{"answer":"ok"}"#]);
        let specs = vec![spec("tools", "t", json!({"use": ["slow", "fast"]})), spec("history", "h", Value::Null), reply()];
        let shared: Vec<Arc<dyn Tool>> = vec![Arc::new(Slow("slow", 300)), Arc::new(Slow("fast", 100))];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], shared, infer.clone()).unwrap();
        let t = web_time::Instant::now();
        e.run("x").await.unwrap();
        assert!(t.elapsed().as_millis() < 380, "ran in sequence: {:?}", t.elapsed());
        let p = &infer.prompts.held()[1];
        assert!(p.find("fast() →").unwrap() < p.find("slow() →").unwrap(), "{p}");
    }

    #[tokio::test]
    async fn await_any_continues_after_the_first_result() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"slow"},{"tool":"fast"}],"await":"any"}"#, r#"{"answer":"ok"}"#]);
        let specs = vec![spec("tools", "t", json!({"use": ["slow", "fast"]})), spec("history", "h", Value::Null), reply()];
        let shared: Vec<Arc<dyn Tool>> = vec![Arc::new(Slow("slow", 400)), Arc::new(Slow("fast", 50))];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], shared, infer.clone()).unwrap();
        let t = web_time::Instant::now();
        e.run("x").await.unwrap();
        assert!(t.elapsed().as_millis() < 300);
        let p = &infer.prompts.held()[1];
        assert!(p.contains("fast() →") && !p.contains("slow() →"), "{p}");
    }

    #[tokio::test]
    async fn stop_ends_the_run_before_the_next_step() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"halt"}]}"#, r#"{"answer":"never"}"#]);
        let handle: Arc<std::sync::OnceLock<std::sync::Weak<Engine>>> = Arc::default();
        let h = handle.clone();
        let halt = tool("halt", "stops its engine", Value::Null, move |_| {
            h.get().and_then(|w| w.upgrade()).ok_or("no engine")?.stop();
            Ok(json!("ok"))
        });
        let e = Arc::new(Engine::new(file("e"), "e".into(), vec![spec("tools", "t", json!({"use": ["halt"]})), reply()], vec![], vec![halt], infer.clone()).unwrap());
        handle.set(Arc::downgrade(&e)).unwrap();
        assert_eq!(e.run("x").await.unwrap(), "stopped");
        assert_eq!(e.file.held().status, "stopped");
        assert_eq!(infer.prompts.held().len(), 1);
    }

    #[tokio::test]
    async fn refocus_folds_history_near_the_context_limit_and_keeps_lessons() {
        let infer = Scripted::new(&["lesson: add works", r#"{"answer":"done"}"#]);
        let mut f = file("e");
        f.context = 50;
        let h = Spec {
            kind: "history".into(),
            name: "h".into(),
            config: Value::Null,
            state: json!({"turns": (0..10).map(|i| json!({"role": "user", "text": format!("old turn {i} with some padding")})).collect::<Vec<_>>()}),
        };
        let e = Engine::new(f, "e".into(), vec![h], vec![], vec![], infer.clone()).unwrap();
        e.run("go").await.unwrap();
        let p = infer.prompts.held();
        assert!(p[0].starts_with("The context is nearly full"));
        assert!(p[1].contains("summary: lesson: add works") && !p[1].contains("old turn 0"), "{}", p[1]);
        assert!(e.total_version() > 0);
    }

    /// Activity follows the run: thinking while the model is asked, calling while tools run,
    /// idle after; every change bumps the version (live UI), and every size carries it.
    #[tokio::test]
    async fn activity_tracks_model_and_tool_phases_and_shows_on_every_size() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let handle: Arc<std::sync::OnceLock<std::sync::Weak<Engine>>> = Arc::default();
        let (h, s2) = (handle.clone(), seen.clone());
        let probe = tool("probe", "records activity", Value::Null, move |_| {
            let e = h.get().and_then(|w| w.upgrade()).ok_or("no engine")?;
            s2.held().push(e.activity().0 + ":" + &e.activity().1);
            Ok(json!("ok"))
        });
        let infer = Scripted::new(&["calls[1]{tool,args}:\n  probe,{}", "answer: done"]);
        let e = Arc::new(Engine::new(file("e"), "e".into(), vec![spec("tools", "t", json!({"use": ["probe"]})), reply()], vec![], vec![probe], infer).unwrap());
        handle.set(Arc::downgrade(&e)).unwrap();
        let v0 = e.total_version();
        assert_eq!(e.run("x").await.unwrap(), "done");
        assert_eq!(*seen.held(), ["calling:probe"]);
        assert_eq!(e.activity().0, "idle");
        assert!(e.total_version() >= v0 + 4, "thinking, calling, thinking, idle each bump");
        for size in Size::ALL {
            let n = e.render(size, &[]);
            assert_eq!((n.kind.as_str(), n.text.as_str(), n.state.as_str(), n.size.as_str()), ("object", "engine", "idle", size.as_str()));
        }
        assert!(e.render(Size::Small, &[]).children.is_empty(), "small is only the live icon");
        let card = e.render(Size::Medium, &[]);
        assert!(card.children.iter().all(|c| c.label != "Tools"), "card: no tools row, only status, phase, summary, logs");
        assert!(card.children.iter().any(|c| c.kind == "summary"));
        let large = e.render(Size::Large, &[]);
        let tools = large.children.iter().find(|c| c.label == "Tools").expect("large lists its tools");
        assert!(tools.kind == "muted" && tools.text.contains("probe"), "tools as names, not icons");
        assert!(e.render(Size::Large, &[]).children.iter().any(|c| c.kind == "grid" && c.children[0].size == "medium"));
    }

    #[tokio::test]
    async fn a_refocus_phase_supplies_the_refocus_instruction() {
        let infer = Scripted::new(&["kept: the plan", r#"{"answer":"ok"}"#]);
        let mut f = file("e");
        f.context = 20;
        let phase = spec("phase", "phase", json!({"phases": [{"name": "work", "focus": "do it"}, {"name": "refocus", "refocus": true, "focus": "Keep the plan, the open files and every failed attempt."}]}));
        let e = Engine::new(f, "e".into(), vec![phase, spec("history", "h", Value::Null)], vec![], vec![], infer.clone()).unwrap();
        e.run("a long enough input to pass the tiny window").await.unwrap();
        let p = infer.prompts.held();
        assert!(p[0].starts_with("Keep the plan, the open files and every failed attempt."), "{}", p[0]);
        assert!(p[1].contains("Phase 1/1: work"), "refocus is never the working phase by default");
    }

    #[tokio::test]
    async fn requests_carry_the_sampling_of_the_current_phase() {
        let infer = Scripted::new(&["kept: the plan", r#"{"answer":"ok"}"#]);
        let mut f = file("e");
        f.context = 20;
        let phase = spec("phase", "phase", json!({"phases": [{"name": "work"}, {"name": "refocus", "refocus": true, "focus": "sum up"}]}));
        let sampling = spec("sampling", "sampling", json!({"use": "creative", "phases": {"refocus": "precise"}}));
        let e = Engine::new(f, "e".into(), vec![phase, sampling, spec("history", "h", Value::Null)], vec![], vec![], infer.clone()).unwrap();
        e.run("a long enough input to pass the tiny window").await.unwrap();
        let s = infer.samplings.held();
        assert_eq!(s[0].temperature, Some(0.2), "refocus uses its own preset");
        assert_eq!((s[1].temperature, s[1].top_p), (Some(1.0), Some(0.95)), "work uses the engine preset");
        let plain = Engine::new(file("p"), "p".into(), vec![], vec![], vec![], Scripted::new(&[])).unwrap();
        assert_eq!(plain.sampling(None), crate::core::Sampling::default(), "no sampling element: the model decides");
    }

    #[tokio::test]
    async fn refocus_sends_only_what_the_summary_needs() {
        let infer = Scripted::new(&["kept: the plan", r#"{"answer":"ok"}"#]);
        let mut f = file("e");
        f.context = 230;
        let specs = vec![
            spec("history", "h", Value::Null),
            spec("tools", "t", json!({"use": ["add"]})),
            spec("artifact", "screen", Value::Null),
            spec("notes", "notes", json!({"mode": "list"})),
        ];
        let e = Engine::new(f, "e".into(), specs, vec![], vec![add()], infer.clone()).unwrap();
        // ~210 tokens of input: over 90% of the window.
        e.run(&"x".repeat(840)).await.unwrap();
        let p = infer.prompts.held();
        assert_eq!(p.len(), 2, "refocus ran first");
        assert!(p[0].contains("## h") && !p[0].contains("## tools") && !p[0].contains("## screen") && !p[0].contains("## response"), "{}", p[0]);
        assert!(p[1].contains("## tools"), "the working prompt keeps everything");
    }

    /// A runtime that writes its reply in pieces, and notes what the engine says it has heard
    /// after each one.
    struct Pieces {
        pieces: Vec<&'static str>,
        engine: Arc<std::sync::OnceLock<std::sync::Weak<Engine>>>,
        seen: Arc<Mutex<Vec<(u64, usize, String)>>>,
    }

    impl Infer for Pieces {
        fn complete(&self, _: &str, _: String, _: crate::core::Sampling) -> Fut<Result<String, String>> {
            let whole = self.pieces.concat();
            Box::pin(async move { Ok(whole) })
        }
        fn stream(&self, _: &str, _: String, _: crate::core::Sampling, _: Vec<crate::core::media::Attachment>, said: crate::core::Said) -> Fut<Result<String, String>> {
            let (pieces, engine, seen) = (self.pieces.clone(), self.engine.clone(), self.seen.clone());
            Box::pin(async move {
                for p in &pieces {
                    said(p);
                    if let Some(e) = engine.get().and_then(|w| w.upgrade()) {
                        let (h, answer) = e.heard();
                        seen.held().push((h.run, h.step, answer));
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
                Ok(pieces.concat())
            })
        }
    }

    /// While the model writes, the answer so far can be read (and its key is marked changed);
    /// the run still ends with the whole answer.
    #[tokio::test]
    async fn an_answer_is_heard_while_it_is_written() {
        let engine: Arc<std::sync::OnceLock<std::sync::Weak<Engine>>> = Arc::default();
        let seen: Arc<Mutex<Vec<(u64, usize, String)>>> = Arc::default();
        let infer = Arc::new(Pieces { pieces: vec!["plan: say it\n", "answer: It ", "is ", "ten."], engine: engine.clone(), seen: seen.clone() });
        let mut e = Engine::new(file("e"), "e".into(), vec![spec("handoff", "handoff", json!({"nudge": "off"})), spec("history", "h", Value::Null)], vec![], vec![], infer).unwrap();
        e.key = "engines/heard".into();
        let e = Arc::new(e);
        engine.set(Arc::downgrade(&e)).unwrap();
        let before = crate::core::changes::now();
        assert_eq!(e.run("how much?").await.unwrap(), "It is ten.");
        let run = e.runs().last().unwrap().id;
        let got: Vec<String> = seen.held().iter().map(|(r, s, a)| { assert_eq!((*r, *s), (run, 1), "the pieces are tied to their run and step"); a.clone() }).collect();
        assert_eq!(got, ["", "It ", "It is ", "It is ten."], "the plan is not an answer; the answer grows piece by piece");
        let (_, keys) = crate::core::changes::since(before);
        assert!(keys.iter().any(|(k, _)| k == &crate::core::heard::heard_key("engines/heard")), "the arriving reply marks its own key: {keys:?}");
        // Without an element that reads replies, all of the reply is the answer.
        let plain = Arc::new(Pieces { pieces: vec!["Hel", "lo"], engine: Arc::default(), seen: Arc::default() });
        let p = Arc::new(Engine::new(file("p"), "p".into(), vec![], vec![], vec![], plain.clone()).unwrap());
        plain.engine.set(Arc::downgrade(&p)).unwrap();
        p.run("hi").await.unwrap();
        assert_eq!(plain.seen.held().iter().map(|(_, _, a)| a.as_str()).collect::<Vec<_>>(), ["Hel", "Hello"]);
    }

    #[tokio::test]
    async fn model_errors_are_returned_and_recorded() {
        let e = Engine::new(file("e"), "e".into(), vec![], vec![], vec![], Scripted::new(&[])).unwrap();
        assert!(e.run("x").await.is_err());
        assert!(e.file.held().status.starts_with("error"));
        assert_eq!(e.activity().0, "error");
    }
}
