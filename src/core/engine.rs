//! # Engine
//! An engine is its elements. It is initialised from an [`EngineFile`] plus element [`Spec`]s,
//! and it is itself a [`Tool`] (name, description, `invoke(input)`), so engines nest: every
//! sub-engine appears in its parent's toolbox.
//!
//! One run: `Input` → per step (refresh live artifacts → prompt → model → `Reply` → parse →
//! run calls → `Called`) until a reply has no calls, gives an answer, or `max_steps` is hit.
//! State is saved through the `save` hook after every step, so a restart resumes.
use super::*;
use crate::compose::Node;
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

pub struct Engine {
    pub file: Mutex<EngineFile>,
    /// Slash path from the engines folder, e.g. `askk/designer`.
    pub path: String,
    pub elements: Mutex<Vec<Box<dyn Component>>>,
    pub subs: Vec<Arc<Engine>>,
    /// Shared tools; an engine uses one only if an element `selects` it.
    pub shared: Vec<Arc<dyn Tool>>,
    pub infer: Arc<dyn Infer>,
    pub save: Option<Save>,
    /// Set by `stop()`; checked before every step.
    pub stopping: std::sync::atomic::AtomicBool,
    /// Bumped on every save; the UI waits on it for live updates.
    pub version: std::sync::atomic::AtomicU64,
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
        let elements = specs.into_iter().map(build).collect::<Result<Vec<_>, _>>()?;
        Ok(Self { file: Mutex::new(file), path, elements: Mutex::new(elements), subs, shared, infer, save: None, stopping: Default::default(), version: Default::default() })
    }

    pub fn name(&self) -> String {
        self.file.lock().unwrap().name.clone()
    }

    pub fn specs(&self) -> Vec<Spec> {
        self.elements.lock().unwrap().iter().map(|e| e.spec()).collect()
    }

    fn set_status(&self, s: &str) {
        self.file.lock().unwrap().status = s.into();
    }

    /// Ask a running engine to stop before its next step.
    pub fn stop(&self) {
        self.stopping.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Changes so far, this engine and its sub-engines.
    pub fn total_version(&self) -> u64 {
        self.version.load(std::sync::atomic::Ordering::SeqCst) + self.subs.iter().map(|s| s.total_version()).sum::<u64>()
    }

    fn persist(&self) {
        self.version.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if let Some(save) = &self.save {
            save(self);
        }
    }

    pub fn dispatch(&self, ev: &Event) {
        for e in self.elements.lock().unwrap().iter_mut() {
            e.on(ev);
        }
    }

    /// Tools usable now: selected shared tools + element tools + sub-engines, minus vetoes.
    pub fn toolbox(&self) -> Toolbox {
        let els = self.elements.lock().unwrap();
        let mut list: Vec<Arc<dyn Tool>> =
            self.shared.iter().filter(|t| els.iter().any(|e| e.selects(&t.name()))).cloned().collect();
        list.extend(els.iter().flat_map(|e| e.tools()));
        list.extend(self.subs.iter().map(|s| Arc::new(EngineTool(s.clone())) as Arc<dyn Tool>));
        list.retain(|t| els.iter().all(|e| e.allows(&t.name())));
        Toolbox::new(list).logged()
    }

    /// The prompt as ordered sections: elements by [`super::rank`] of their kind (then name),
    /// the toolbox at the `tools` rank, the input always last. Same engine + input = same prompt.
    pub fn sections(&self, tools: &Toolbox, input: &str) -> Vec<Section> {
        let mut out: Vec<Section> = self
            .elements
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| e.prompt().map(|b| Section { name: e.name().into(), kind: e.kind().into(), body: b.trim_end().into() }))
            .collect();
        if let Some(t) = tools.describe() {
            out.push(Section { name: "tools".into(), kind: "tools".into(), body: t });
        }
        out.sort_by(|a, b| super::rank(&a.kind, &a.name).cmp(&super::rank(&b.kind, &b.name)).then(a.name.cmp(&b.name)));
        out.push(Section { name: "input".into(), kind: "input".into(), body: input.into() });
        out
    }

    pub fn prompt(&self, tools: &Toolbox, input: &str) -> String {
        super::render(&self.sections(tools, input))
    }

    fn parse(&self, reply: &str) -> Reply {
        let els = self.elements.lock().unwrap();
        els.iter().find_map(|e| e.parse(reply)).unwrap_or_else(|| crate::elements::response::parse_toon(reply))
    }

    pub async fn run(&self, input: &str) -> Result<String, String> {
        use std::sync::atomic::Ordering;
        self.stopping.store(false, Ordering::SeqCst);
        self.set_status("running");
        self.dispatch(&Event::Input(input.into()));
        let (model, steps, context) = {
            let f = self.file.lock().unwrap();
            (f.model.clone(), f.max_steps, f.context)
        };
        // Context window in tokens: the engine's override, else what the model reports.
        let context = if context > 0 { context } else { self.infer.context(&model).await };
        for step in 0..steps {
            if self.stopping.swap(false, Ordering::SeqCst) {
                self.set_status("stopped");
                self.persist();
                return Ok("stopped".into());
            }
            let tools = self.toolbox();
            let refresh: Vec<(String, Call)> = self
                .elements
                .lock()
                .unwrap()
                .iter()
                .filter_map(|e| e.refresh().map(|c| (e.name().to_string(), c)))
                .collect();
            let quiet = Toolbox(tools.0.clone(), None);
            for (name, c) in refresh {
                let content = match quiet.call(&c.tool, c.args).await {
                    Ok(v) => text(&v),
                    Err(e) => format!("error: {e}"),
                };
                self.dispatch(&Event::Snapshot { name, content });
            }
            let shown = continued(input, step);
            let mut prompt = self.prompt(&tools, &shown);
            if context > 0 && super::tokens(&prompt) * 10 >= context * 9 {
                let summary = self.infer.complete(&model, format!("{REFOCUS}\n\n{prompt}")).await?;
                self.dispatch(&Event::Folded(summary));
                prompt = self.prompt(&tools, &shown);
            }
            let reply = match self.infer.complete(&model, prompt).await {
                Ok(r) => r,
                Err(e) => {
                    self.set_status(&format!("error: {e}"));
                    self.persist();
                    return Err(e);
                }
            };
            self.dispatch(&Event::Reply(reply.clone()));
            let parsed = self.parse(&reply);
            // All calls of one reply start together; results are recorded in completion order.
            let calls: Vec<_> = parsed.calls.iter().map(|c| Box::pin(tools.call(&c.tool, c.args.clone()))).collect();
            if parsed.wait_any && !calls.is_empty() {
                let _ = futures::future::select_all(calls).await;
            } else {
                futures::future::join_all(calls).await;
            }
            for ev in tools.drain() {
                self.dispatch(&ev);
            }
            self.persist();
            if parsed.calls.is_empty() || parsed.answer.is_some() {
                self.set_status("idle");
                self.persist();
                return Ok(parsed.answer.unwrap_or(reply));
            }
        }
        self.set_status("idle");
        self.persist();
        Ok(format!("stopped after {steps} steps"))
    }

    /// Everything this engine polls (alerts).
    pub fn watches(&self) -> Vec<Watch> {
        self.elements.lock().unwrap().iter().filter_map(|e| e.watch()).collect()
    }

    /// Feed an observation; returns the inputs to wake the engine with.
    pub fn observe(&self, name: &str, value: f64) -> Vec<String> {
        self.dispatch(&Event::Observed { name: name.into(), value });
        let wakes = self.elements.lock().unwrap().iter_mut().filter_map(|e| e.wake()).collect();
        self.persist();
        wakes
    }

    pub fn find(self: &Arc<Self>, path: &str) -> Option<Arc<Engine>> {
        if self.path == path {
            return Some(self.clone());
        }
        self.subs.iter().find_map(|s| s.find(path))
    }

    /// The view without elements of the `hidden` kinds (layout config).
    pub fn view_with(&self, hidden: &[String]) -> Node {
        let f = self.file.lock().unwrap().clone();
        let mut head = Node::new("row").child(Node::new("link").label(&f.name).text(&format!("/e/{}", self.path)));
        if !f.status.is_empty() {
            head = head.child(Node::new("badge").text(&f.status));
        }
        let mut card = Node::new("pane").child(head);
        if !f.description.is_empty() {
            card = card.child(Node::new("muted").text(&f.description));
        }
        let els = self.elements.lock().unwrap();
        let shown: Vec<Node> = els.iter().filter(|e| !hidden.iter().any(|h| h == e.kind())).map(|e| e.view()).collect();
        if !shown.is_empty() {
            card = card.child(Node::new("grid").children(shown));
        }
        if !self.subs.is_empty() {
            card = card.child(Node::new("row").children(
                self.subs.iter().map(|s| Node::new("link").label(&s.name()).text(&format!("/e/{}", s.path))).collect(),
            ));
        }
        card
    }
}

/// An engine as a tool: `{"input": "..."}` → its answer.
pub struct EngineTool(pub Arc<Engine>);

impl Tool for EngineTool {
    fn name(&self) -> String {
        self.0.name()
    }
    fn description(&self) -> String {
        let d = self.0.file.lock().unwrap().description.clone();
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
    }

    impl Scripted {
        pub fn new(replies: &[&str]) -> Arc<Self> {
            Arc::new(Self { replies: Mutex::new(replies.iter().map(|s| s.to_string()).collect()), prompts: Mutex::default() })
        }
    }

    impl Infer for Scripted {
        fn complete(&self, _: &str, prompt: String) -> Fut<Result<String, String>> {
            self.prompts.lock().unwrap().push(prompt);
            let r = self.replies.lock().unwrap().pop_front().ok_or_else(|| "no more replies".to_string());
            Box::pin(async move { r })
        }
    }

    pub fn file(name: &str) -> EngineFile {
        EngineFile { name: name.into(), description: String::new(), model: String::new(), max_steps: 8, status: String::new(), context: 0 }
    }

    pub fn spec(kind: &str, name: &str, config: Value) -> Spec {
        Spec { kind: kind.into(), name: name.into(), config, state: Value::Null }
    }

    pub fn add() -> Arc<dyn Tool> {
        tool("add", "sum", Value::Null, |a| Ok(json!(a["a"].as_f64().unwrap_or(0.0) + a["b"].as_f64().unwrap_or(0.0))))
    }

    #[tokio::test]
    async fn engine_without_elements_shows_only_input() {
        let e = Engine::new(file("e"), "e".into(), vec![], vec![], vec![add()], Scripted::new(&["hi"])).unwrap();
        assert_eq!(e.prompt(&e.toolbox(), "x"), "## input\nx\n");
        assert_eq!(e.run("x").await.unwrap(), "hi");
    }

    #[tokio::test]
    async fn selected_tools_are_called_until_an_answer() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"add","args":{"a":2,"b":3}}]}"#, r#"{"answer":"5"}"#]);
        let specs = vec![spec("tools", "tools", json!({"use": ["add"]})), spec("history", "history", Value::Null)];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], vec![add()], infer.clone()).unwrap();
        assert_eq!(e.run("add").await.unwrap(), "5");
        let prompts = infer.prompts.lock().unwrap();
        assert!(prompts[0].contains("- add: sum"));
        assert!(prompts[1].contains("add({\"a\":2,\"b\":3}) -> 5.0"), "{}", prompts[1]);
        assert!(prompts[0].ends_with("## input\nadd\n") && prompts[1].contains("(step 2: your calls"), "{}", prompts[1]);
        assert_eq!(e.file.lock().unwrap().status, "idle");
    }

    #[tokio::test]
    async fn an_engine_is_a_tool_of_its_parent() {
        let child = Arc::new(
            Engine::new(file("helper"), "p/helper".into(), vec![], vec![], vec![], Scripted::new(&["from child"])).unwrap(),
        );
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"helper","args":{"input":"go"}}]}"#, r#"{"answer":"done"}"#]);
        let parent =
            Engine::new(file("p"), "p".into(), vec![spec("history", "h", Value::Null)], vec![child], vec![], infer.clone()).unwrap();
        assert!(parent.toolbox().names().contains(&"helper".to_string()));
        assert_eq!(parent.run("x").await.unwrap(), "done");
        assert!(infer.prompts.lock().unwrap()[1].contains("from child"));
    }

    #[tokio::test]
    async fn calls_made_inside_a_script_reach_the_components() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"keep"}]}"#, r#"{"answer":"ok"}"#]);
        let specs = vec![
            spec("state", "memory", Value::Null),
            spec("script", "keep", json!({"steps": [{"tool": "remember", "args": {"key": "k", "value": 7}}]})),
        ];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], vec![], infer.clone()).unwrap();
        e.run("x").await.unwrap();
        assert_eq!(e.specs()[0].state, json!({"k": 7}));
        assert!(infer.prompts.lock().unwrap()[1].contains("{\"k\":7}"));
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
        let specs = vec![spec("tools", "t", json!({"use": ["slow", "fast"]})), spec("history", "h", Value::Null)];
        let shared: Vec<Arc<dyn Tool>> = vec![Arc::new(Slow("slow", 300)), Arc::new(Slow("fast", 100))];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], shared, infer.clone()).unwrap();
        let t = std::time::Instant::now();
        e.run("x").await.unwrap();
        assert!(t.elapsed().as_millis() < 380, "ran in sequence: {:?}", t.elapsed());
        let p = &infer.prompts.lock().unwrap()[1];
        assert!(p.find("tool: fast").unwrap() < p.find("tool: slow").unwrap(), "{p}");
    }

    #[tokio::test]
    async fn await_any_continues_after_the_first_result() {
        let infer = Scripted::new(&[r#"{"calls":[{"tool":"slow"},{"tool":"fast"}],"await":"any"}"#, r#"{"answer":"ok"}"#]);
        let specs = vec![spec("tools", "t", json!({"use": ["slow", "fast"]})), spec("history", "h", Value::Null)];
        let shared: Vec<Arc<dyn Tool>> = vec![Arc::new(Slow("slow", 400)), Arc::new(Slow("fast", 50))];
        let e = Engine::new(file("e"), "e".into(), specs, vec![], shared, infer.clone()).unwrap();
        let t = std::time::Instant::now();
        e.run("x").await.unwrap();
        assert!(t.elapsed().as_millis() < 300);
        let p = &infer.prompts.lock().unwrap()[1];
        assert!(p.contains("tool: fast") && !p.contains("tool: slow"), "{p}");
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
        let e = Arc::new(Engine::new(file("e"), "e".into(), vec![spec("tools", "t", json!({"use": ["halt"]}))], vec![], vec![halt], infer.clone()).unwrap());
        handle.set(Arc::downgrade(&e)).unwrap();
        assert_eq!(e.run("x").await.unwrap(), "stopped");
        assert_eq!(e.file.lock().unwrap().status, "stopped");
        assert_eq!(infer.prompts.lock().unwrap().len(), 1);
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
        let p = infer.prompts.lock().unwrap();
        assert!(p[0].starts_with("The context is nearly full"));
        assert!(p[1].contains("summary: lesson: add works") && !p[1].contains("old turn 0"), "{}", p[1]);
        assert!(e.total_version() > 0);
    }

    #[tokio::test]
    async fn model_errors_are_returned_and_recorded() {
        let e = Engine::new(file("e"), "e".into(), vec![], vec![], vec![], Scripted::new(&[])).unwrap();
        assert!(e.run("x").await.is_err());
        assert!(e.file.lock().unwrap().status.starts_with("error"));
    }
}
