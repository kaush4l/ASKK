//! The live layer over a Runtime: long-running tasks, one writer per object, events.
//!
//! - The Runtime sits behind one short synchronous lock (never held across an `.await`).
//! - Each object has its own async writer lock: every state change of one object (an action, a
//!   task tick, a task's end) takes it, so changes to one object land — in memory and on disk — in
//!   order. Different objects never wait on each other's writer; their tasks run in parallel.
//! - A task is a tokio task spawned by an action (`Kind::task`). It ends `idle` (Ok), `failed`
//!   (Err or panic), `stopped` (the `cancel` action, or shutdown), or silently when its object
//!   left the configuration (a reload removed it or changed its kind).
//! - Every change goes out as an `Event` (a twin, or the whole world after a structure change).

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fmt,
    sync::{
        Arc, Mutex as SyncMutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{Mutex, OwnedMutexGuard, broadcast, watch},
    task::JoinHandle,
};

use crate::{Obj, Phase, Runtime, Store, TaskFn};

/// One message for `/events`.
#[derive(Debug, Clone)]
pub enum Event {
    /// (id, twin): one object changed.
    Twin(String, Value),
    /// The whole `/world` payload: the structure changed.
    World(Value),
}

/// The refusal while the app is stopping (the server answers 503).
#[derive(Debug)]
pub struct Stopping;
impl fmt::Display for Stopping {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("stopping")
    }
}
impl std::error::Error for Stopping {}

/// How long shutdown waits for a task to write its `stopped` state.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq)]
enum Stop {
    /// The `cancel` action: ends `stopped`.
    Cancel,
    /// Shutdown: ends `stopped`.
    Shutdown,
    /// The object left the configuration: nothing to write.
    Gone,
}

struct Task {
    generation: u64,
    stop: watch::Sender<Option<Stop>>,
    handle: JoinHandle<()>,
}

struct Inner {
    rt: SyncMutex<Option<Runtime>>,
    store: Arc<dyn Store>,
    events: broadcast::Sender<Event>,
    writers: SyncMutex<HashMap<String, Arc<Mutex<()>>>>,
    tasks: SyncMutex<HashMap<String, Task>>,
    /// Objects woken while their task ran: woken again when it ends (lock order: tasks, then this).
    wake_pending: SyncMutex<std::collections::HashSet<String>>,
    /// Detached tool-call tasks, by object (a loop) then call id. Not in `running()`.
    calls: SyncMutex<HashMap<String, HashMap<String, JoinHandle<()>>>>,
    generation: AtomicU64,
    /// Loops found waiting on calls the process died under (`Runtime::recover_calls`), woken once by `resume`.
    recovered: SyncMutex<Vec<String>>,
    /// Set at shutdown: wakes are ignored from then on.
    stopping: std::sync::atomic::AtomicBool,
    /// How long a removed `.md`'s state file waits before it is deleted (ms).
    grace_ms: AtomicU64,
    /// Model connectors by name (`echo` always; the server adds the real ones).
    connectors: SyncMutex<HashMap<String, Arc<dyn crate::connector::Connector>>>,
}

/// The objects of an engine (at any depth) that are `waiting` with no task behind them.
fn waiting_below(e: &crate::engine::EngineNode) -> Vec<String> {
    let mut v: Vec<String> = e.elements.iter().filter(|o| o.phase == Phase::Waiting).map(|o| o.id.clone()).collect();
    for c in &e.children {
        v.extend(waiting_below(c));
    }
    v
}

/// A removed object's state file is deleted after this, unless its `.md` came back (contract, Backend notes 8).
pub const REMOVED_GRACE: Duration = Duration::from_secs(10);

/// Cheap to clone; every clone is the same app.
#[derive(Clone)]
pub struct Hub(Arc<Inner>);

/// What a task holds: its object's id and the way to change it.
#[derive(Clone)]
pub struct TaskCtx {
    hub: Hub,
    id: String,
}

impl TaskCtx {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn hub(&self) -> &Hub {
        &self.hub
    }
    /// The object as it is now (config may have been edited by a reload meanwhile).
    pub fn obj(&self) -> Result<Obj> {
        self.hub.read(|rt| rt.obj(&self.id).cloned())?.ok_or_else(|| anyhow!("{} is gone", self.id))
    }
    /// Change the object under its writer lock; persisted and broadcast before this returns.
    pub async fn update(&self, f: impl FnOnce(&mut Obj) -> Result<()>) -> Result<()> {
        self.hub.update(&self.id, f).await
    }
}

impl Hub {
    pub fn new(mut rt: Runtime) -> Self {
        // restart safety: calls the process died under are interrupted; their waiting loops wake once
        let wake = rt.recover_calls().unwrap_or_else(|e| {
            eprintln!("recover calls: {e:#}");
            vec![]
        });
        let store = rt.store();
        let (events, _) = broadcast::channel(1024);
        let hub = Hub(Arc::new(Inner {
            rt: SyncMutex::new(Some(rt)),
            store,
            events,
            writers: SyncMutex::new(HashMap::new()),
            tasks: SyncMutex::new(HashMap::new()),
            wake_pending: SyncMutex::new(Default::default()),
            calls: SyncMutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
            stopping: Default::default(),
            recovered: SyncMutex::new(vec![]),
            grace_ms: AtomicU64::new(REMOVED_GRACE.as_millis() as u64),
            connectors: SyncMutex::new(HashMap::from([("echo".to_string(), Arc::new(crate::connector::Echo) as Arc<dyn crate::connector::Connector>)])),
        }));
        *hub.0.recovered.lock().unwrap() = wake;
        hub
    }

    // ── callbacks: wake, detached calls ────────────────────────────────────

    /// After boot, once the connectors are added: wake each loop that was waiting on calls when
    /// the process died (its calls are already `interrupted`), once, so its model sees the failures.
    pub async fn resume(&self) {
        let ids = std::mem::take(&mut *self.0.recovered.lock().unwrap());
        for id in ids {
            self.wake(&id).await;
        }
    }

    /// The callback: an object's waiting condition may be met (a call finished, a step ended).
    /// Dispatched on its kind (`Kind::wake`); a wake while the object's task runs is held and
    /// delivered when that task ends. Errors are logged, never raised.
    pub async fn wake(&self, id: &str) {
        if self.0.stopping.load(Ordering::SeqCst) {
            return;
        }
        let kind = match self.read(|rt| rt.obj(id).filter(|o| o.error.is_none()).map(|o| o.kind.clone())) {
            Ok(Some(k)) => k,
            _ => return,
        };
        let Some(f) = crate::kinds::find(&kind).and_then(|k| k.wake()) else {
            return;
        };
        if let Err(e) = f(self.clone(), id.to_string()).await
            && !e.is::<Stopping>()
        {
            eprintln!("wake {id}: {e:#}");
        }
    }

    /// True (and the wake held for later) when the object's task is running.
    pub fn busy_or_hold(&self, id: &str) -> bool {
        let tasks = self.0.tasks.lock().unwrap();
        if tasks.contains_key(id) {
            self.0.wake_pending.lock().unwrap().insert(id.to_string());
            true
        } else {
            false
        }
    }

    /// Start a task for an object unless one runs (the caller holds the object's writer).
    pub fn start_task(&self, id: &str, f: TaskFn) -> bool {
        if self.0.tasks.lock().unwrap().contains_key(id) {
            return false;
        }
        self.spawn(id, f);
        true
    }

    /// Start a detached call task owned by the hub, keyed by (owner, call). The future writes
    /// its own result and calls `call_done` + `wake`.
    pub fn spawn_call(&self, owner: &str, call: &str, fut: impl std::future::Future<Output = ()> + Send + 'static) {
        let mut calls = self.0.calls.lock().unwrap(); // held across the spawn: `call_done` cannot run first
        let h = tokio::spawn(fut);
        calls.entry(owner.to_string()).or_default().insert(call.to_string(), h);
    }

    /// A call task ended: forget its handle.
    pub fn call_done(&self, owner: &str, call: &str) {
        let mut calls = self.0.calls.lock().unwrap();
        if let Some(m) = calls.get_mut(owner) {
            m.remove(call);
            if m.is_empty() {
                calls.remove(owner);
            }
        }
    }

    /// Abort one call task (the caller records its status). False when it was not live.
    pub fn abort_call(&self, owner: &str, call: &str) -> bool {
        let mut calls = self.0.calls.lock().unwrap();
        let h = calls.get_mut(owner).and_then(|m| m.remove(call));
        if calls.get(owner).is_some_and(|m| m.is_empty()) {
            calls.remove(owner);
        }
        h.map(|h| h.abort()).is_some()
    }

    /// Abort every call task of an object.
    fn abort_calls(&self, owner: &str) -> usize {
        let m = self.0.calls.lock().unwrap().remove(owner).unwrap_or_default();
        let n = m.len();
        for (_, h) in m {
            h.abort();
        }
        n
    }

    /// Ids (and call ids) with call tasks live.
    pub fn live_calls(&self) -> Vec<(String, Vec<String>)> {
        let mut v: Vec<(String, Vec<String>)> = self
            .0
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(k, m)| {
                let mut c: Vec<String> = m.keys().cloned().collect();
                c.sort();
                (k.clone(), c)
            })
            .collect();
        v.sort();
        v
    }

    /// End an object's calls: abort their tasks, record each running one with `status`, and (for
    /// cancel) turn a waiting object `stopped`. True when there was something to end.
    pub(crate) async fn end_calls(&self, id: &str, status: &'static str, stop: bool) -> bool {
        let _w = self.writer(id).await;
        let aborted = self.abort_calls(id);
        let mut did = aborted > 0;
        let r = self.update_locked(id, |o| {
            if o.kind != "loop" {
                return Ok(());
            }
            let waiting = o.phase == Phase::Waiting;
            if crate::run::any_running(o) || waiting {
                did = true;
            }
            crate::run::end_calls(o, status, status);
            o.state["waiting"] = Value::Null;
            o.state["pending_answer"] = Value::Null;
            if stop && waiting {
                o.phase = Phase::Stopped;
            }
            Ok(())
        });
        if let Err(e) = r
            && !e.is::<Stopping>()
        {
            eprintln!("end calls {id}: {e:#}");
        }
        did
    }

    /// Add (or replace) a model connector by name.
    pub fn add_connector(&self, name: &str, c: Arc<dyn crate::connector::Connector>) {
        self.0.connectors.lock().unwrap().insert(name.to_string(), c);
        let names = self.connector_names();
        let _ = self.with(|rt| {
            rt.set_connectors(names);
            Ok(())
        });
    }
    pub fn connector(&self, name: &str) -> Option<Arc<dyn crate::connector::Connector>> {
        self.0.connectors.lock().unwrap().get(name).cloned()
    }
    pub fn connector_names(&self) -> Vec<String> {
        let mut v: Vec<String> = self.0.connectors.lock().unwrap().keys().cloned().collect();
        v.sort();
        v
    }
    /// Add (or replace, by name) a tool. The tool registry is process-wide (crate::tools).
    pub fn add_tool(&self, t: Arc<dyn crate::tools::Tool>) {
        crate::tools::add(t)
    }
    pub fn tool(&self, name: &str) -> Option<Arc<dyn crate::tools::Tool>> {
        crate::tools::find(name)
    }
    pub fn tool_specs(&self) -> Vec<crate::tools::ToolSpec> {
        crate::tools::specs()
    }
    pub fn store(&self) -> Arc<dyn Store> {
        self.0.store.clone()
    }

    /// Change the grace before a removed object's state file is deleted (tests use a short one).
    pub fn set_removed_grace(&self, grace: Duration) {
        self.0.grace_ms.store(grace.as_millis() as u64, Ordering::SeqCst);
    }

    /// After the grace, delete the state files of objects still absent from the configuration.
    fn forget_later(&self, ids: Vec<String>) {
        if ids.is_empty() {
            return;
        }
        let hub = self.clone();
        let grace = Duration::from_millis(self.0.grace_ms.load(Ordering::SeqCst));
        tokio::spawn(async move {
            tokio::time::sleep(grace).await;
            for id in ids {
                let _w = hub.writer(&id).await;
                // came back, or the app is stopping: keep it
                if let Ok(true) = hub.read(|rt| rt.obj(&id).is_none())
                    && let Err(e) = hub.0.store.remove(&format!("state/{id}.json"))
                {
                    eprintln!("forget {id}: {e:#}");
                }
            }
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.0.events.subscribe()
    }

    fn send(&self, e: Event) {
        let _ = self.0.events.send(e);
    }

    /// Send the whole world (the desk changed outside an action).
    pub fn send_world(&self) {
        if let Ok(w) = self.read(|rt| rt.world()) {
            self.send(Event::World(w));
        }
    }

    /// Run `f` on the runtime (short, synchronous); `Stopping` once shut down.
    pub fn with<T>(&self, f: impl FnOnce(&mut Runtime) -> Result<T>) -> Result<T> {
        let mut guard = self.0.rt.lock().unwrap();
        let rt = guard.as_mut().ok_or(Stopping)?;
        f(rt)
    }

    pub fn read<T>(&self, f: impl FnOnce(&Runtime) -> T) -> Result<T> {
        self.with(|rt| Ok(f(rt)))
    }

    /// The one writer of an object: hold it across a read-modify-write that awaits.
    pub async fn writer(&self, id: &str) -> OwnedMutexGuard<()> {
        let lock = self.0.writers.lock().unwrap().entry(id.to_string()).or_default().clone();
        lock.lock_owned().await
    }

    /// Ids with a task in flight.
    pub fn running(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.0.tasks.lock().unwrap().keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Change an object; the caller holds its writer (`writer`). In memory under the runtime
    /// lock, then written to the store outside it, then broadcast.
    pub fn update_locked(&self, id: &str, f: impl FnOnce(&mut Obj) -> Result<()>) -> Result<()> {
        let (saved, changed) = self.with(|rt| {
            let o = rt.obj_mut(id).ok_or_else(|| anyhow!("no object {id}"))?;
            if let Some(err) = &o.error {
                bail!("{id} failed to load: {err}");
            }
            let prev = o.clone();
            let before = o.phase;
            f(o)?;
            o.mark(before);
            let found = crate::kinds::find(&o.kind);
            let entries = match found {
                Some(k) => k.activity(&prev, o),
                None => crate::engine::engine_activity(&prev, o),
            };
            let by = if o.kind == "loop" {
                "loop"
            } else if o.kind == "workflows" {
                "workflow"
            } else {
                "task"
            };
            for (a, t, ok) in entries {
                o.record(&a, by, &t, ok);
            }
            let saved = o.saved();
            Ok((saved, rt.changed_for(id)))
        })?;
        self.0.store.write("state", id, &saved)?;
        for (i, t) in changed {
            self.send(Event::Twin(i, t));
        }
        Ok(())
    }

    pub async fn update(&self, id: &str, f: impl FnOnce(&mut Obj) -> Result<()>) -> Result<()> {
        let _w = self.writer(id).await;
        self.update_locked(id, f)
    }

    /// POST /act. A long-running action returns at once with its object `running`; its task
    /// carries on. `cancel` on an object with a task stops it (→ `stopped`).
    pub async fn act(&self, target: &str, action: &str, args: &Value) -> Result<Value> {
        // the desk's model.test: one short call in the background; the world carries the result
        if target == crate::DESK && action == "model.test" && self.read(|rt| rt.obj(target).is_none())? {
            let slug = args["slug"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("model.test needs slug"))?.to_string();
            let known = self.read(|rt| rt.desk().find(&slug).map(|m| m.spec().connector))?;
            let conn = known.ok_or_else(|| anyhow!("no model {slug} in the library"))?;
            if self.connector(&conn).is_none() {
                bail!("no connector {conn} (known: {})", self.connector_names().join(", "));
            }
            let hub = self.clone();
            tokio::spawn(async move {
                if let Err(e) = crate::run::desk_test(hub, slug).await
                    && !e.is::<Stopping>()
                {
                    eprintln!("model.test: {e:#}");
                }
            });
            return self.read(|rt| rt.desk_world());
        }
        // the desk's model.discover: the names a connector can reach, and those already in the library
        if target == crate::DESK && action == "model.discover" && self.read(|rt| rt.obj(target).is_none())? {
            crate::desk::refuse_secrets(args)?;
            let text = |k: &str| args[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
            let conn_name = text("connector").ok_or_else(|| anyhow!("model.discover needs connector"))?;
            let conn = self.connector(&conn_name).ok_or_else(|| anyhow!("no connector {conn_name} (known: {})", self.connector_names().join(", ")))?;
            let key_env = text("key_env");
            if let Some(k) = &key_env
                && crate::desk::check_config(&serde_json::Map::from_iter([("connector".to_string(), json!(conn_name)), ("key_env".to_string(), json!(k))]), None).is_err()
            {
                bail!("key_env must be an environment variable NAME like OPENAI_API_KEY, not a key");
            }
            let spec = crate::connector::ModelSpec { connector: conn_name.clone(), base_url: text("base_url"), key_env, ..Default::default() };
            let base = spec.base_url.clone();
            let mut models = tokio::time::timeout(std::time::Duration::from_secs(10), conn.discover(spec)).await.map_err(|_| anyhow!("no answer within 10 s"))??;
            models.sort();
            models.dedup();
            let already = self.read(|rt| rt.desk().names_for(&conn_name, base.as_deref()))?;
            return Ok(json!({ "models": models, "already": already }));
        }
        if action == "cancel" && self.cancel(target).await {
            return self.read(|rt| rt.twin(target))?.ok_or_else(|| anyhow!("{target} vanished"));
        }
        // an engine's stop cascades: the tasks below it are cancelled (→ stopped) first
        if action == "stop" && self.read(|rt| rt.obj(target).is_some_and(|o| o.kind == "engine"))? {
            let below = format!("{target}/");
            let mut ids: Vec<String> = self.running();
            ids.extend(self.live_calls().into_iter().map(|(id, _)| id));
            ids.extend(self.read(|rt| rt.engine_node(target).map(waiting_below).unwrap_or_default())?);
            ids.sort();
            ids.dedup();
            for id in ids.into_iter().filter(|id| id.starts_with(&below)) {
                self.cancel(&id).await;
            }
        }
        let w = self.writer(target).await;
        let (out, world, gone) = self.with(|rt| {
            let task = rt.task_for(target, action);
            if task.is_some() && self.0.tasks.lock().unwrap().contains_key(target) {
                bail!("{target} is already running");
            }
            let out = rt.act(target, action, args)?;
            let world = out.world.then(|| rt.world());
            if let Some(f) = task {
                self.spawn(target, f); // registered before the writer is released: no double start
            }
            Ok((out, world, rt.take_gone()))
        })?;
        drop(w);
        // the callback for owner events: input to a busy loop, or a phase change, wakes the waiting loop(s)
        let mut wake: Vec<String> = vec![];
        let kind = self.read(|rt| rt.obj(target).map(|o| (o.kind.clone(), o.state["wake_now"] == true)))?;
        match kind {
            Some((k, true)) if k == "loop" => wake.push(target.to_string()),
            Some((k, _)) if k == "phases" && matches!(action, "set" | "next") => {
                let engine = target.rsplit_once('/').map(|(e, _)| e.to_string()).unwrap_or_default();
                let loops = self.read(|rt| rt.engine_node(&engine).map(|e| e.elements.iter().filter(|o| o.kind == "loop" && o.phase == Phase::Waiting).map(|o| o.id.clone()).collect::<Vec<_>>()).unwrap_or_default())?;
                for l in loops {
                    self.update(&l, |o| {
                        o.state["wake_now"] = json!(true);
                        Ok(())
                    })
                    .await?;
                    wake.push(l);
                }
            }
            _ => {}
        }
        for id in wake {
            self.wake(&id).await;
        }
        for id in gone {
            self.stop_task(&id, Stop::Gone).await;
            self.abort_calls(&id);
        }
        match world {
            Some(w) => self.send(Event::World(w)),
            None => {
                for (id, twin) in out.changed {
                    self.send(Event::Twin(id, twin));
                }
            }
        }
        Ok(out.twin)
    }

    fn spawn(&self, id: &str, f: TaskFn) {
        let generation = self.0.generation.fetch_add(1, Ordering::SeqCst);
        let (stop, mut rx) = watch::channel(None);
        let ctx = TaskCtx { hub: self.clone(), id: id.to_string() };
        let (hub, key) = (self.clone(), id.to_string());
        let id = key.clone();
        let handle = tokio::spawn(async move {
            // The body runs as its own task: a panic is a JoinError, a cancel is an abort.
            let mut body = tokio::spawn(f(ctx));
            let stopped = async {
                let got = rx.wait_for(Option::is_some).await.map(|v| v.expect("is_some"));
                match got {
                    Ok(s) => s,
                    Err(_) => std::future::pending().await,
                }
            };
            let end = tokio::select! {
                r = &mut body => Ok(r),
                s = stopped => Err(s),
            };
            let write = match end {
                Ok(Ok(Ok(()))) => {
                    hub.update(&id, |o| {
                        // a step that ended waiting on calls stays `waiting` (no task behind it)
                        if o.phase == Phase::Running || (o.phase == Phase::Waiting && o.state["waiting"].is_null()) {
                            o.phase = Phase::Idle;
                        }
                        Ok(())
                    })
                    .await
                }
                Ok(r) => {
                    let why = match r {
                        Ok(Err(e)) => format!("{e:#}"),
                        Err(j) => format!("task panicked: {j}"),
                        Ok(Ok(())) => unreachable!(),
                    };
                    hub.update(&id, |o| {
                        o.phase = Phase::Failed;
                        o.state["error"] = json!(why);
                        Ok(())
                    })
                    .await
                }
                Err(s) => {
                    body.abort();
                    let _ = body.await;
                    if s == Stop::Gone {
                        Ok(())
                    } else {
                        hub.update(&id, |o| {
                            o.phase = Phase::Stopped;
                            Ok(())
                        })
                        .await
                    }
                }
            };
            if let Err(e) = write
                && !e.is::<Stopping>()
            {
                eprintln!("task {id}: {e:#}");
            }
            let again = {
                let mut tasks = hub.0.tasks.lock().unwrap();
                if tasks.get(&id).is_some_and(|t| t.generation == generation) {
                    tasks.remove(&id);
                }
                !tasks.contains_key(&id) && hub.0.wake_pending.lock().unwrap().remove(&id)
            };
            if again {
                hub.wake(&id).await;
            }
        });
        self.0.tasks.lock().unwrap().insert(key, Task { generation, stop, handle });
    }

    /// The `cancel` action on an object with a task or detached calls: the calls are aborted and
    /// recorded `cancelled`, the task stopped (→ `stopped`). False when there was nothing to stop.
    async fn cancel(&self, id: &str) -> bool {
        let a = self.end_calls(id, "cancelled", true).await;
        let b = self.stop_task(id, Stop::Cancel).await;
        let c = self.abort_calls(id) > 0; // a call started by the step in between
        if c {
            self.end_calls(id, "cancelled", true).await;
        }
        a || b || c
    }

    /// Stop one task and wait until it wrote its end. False when none was running.
    async fn stop_task(&self, id: &str, why: Stop) -> bool {
        let task = self.0.tasks.lock().unwrap().remove(id);
        let Some(t) = task else { return false };
        let _ = t.stop.send(Some(why));
        let _ = t.handle.await;
        true
    }

    /// POST /theme: stored, then the world goes out.
    pub fn set_theme(&self, tokens: &Value) -> Result<()> {
        let w = self.with(|rt| {
            rt.set_theme(tokens)?;
            Ok(rt.world())
        })?;
        self.send(Event::World(w));
        Ok(())
    }

    /// POST /ui: stored, then the world goes out.
    pub fn set_ui(&self, view: &str, tree: &Value) -> Result<()> {
        let w = self.with(|rt| {
            rt.set_ui(view, tree)?;
            Ok(rt.world())
        })?;
        self.send(Event::World(w));
        Ok(())
    }

    /// Re-read the configuration (hot reload). Idempotent; broadcasts `world` only on a change.
    pub async fn reload(&self) -> Result<bool> {
        let (r, world) = self.with(|rt| {
            let r = rt.reload()?;
            let world = r.changed.then(|| rt.world());
            Ok((r, world))
        })?;
        for id in &r.gone {
            self.stop_task(id, Stop::Gone).await;
            self.abort_calls(id);
        }
        self.forget_later(r.removed);
        if let Some(w) = world {
            self.send(Event::World(w));
        }
        Ok(r.changed)
    }

    /// A clean stop: every task cancelled and its `stopped` state written, then the runtime's
    /// own shutdown (runtime.json clean, lock released). Afterwards every call is `Stopping`.
    pub async fn shutdown(&self) -> Result<()> {
        self.0.stopping.store(true, Ordering::SeqCst);
        for (id, _) in self.live_calls() {
            self.end_calls(&id, "interrupted", false).await;
        }
        let tasks: Vec<Task> = self.0.tasks.lock().unwrap().drain().map(|(_, t)| t).collect();
        for t in &tasks {
            let _ = t.stop.send(Some(Stop::Shutdown));
        }
        for t in tasks {
            let _ = tokio::time::timeout(SHUTDOWN_GRACE, t.handle).await;
        }
        // detached calls: aborted, recorded `interrupted` (the runtime's shutdown then stops the loop)
        for (id, _) in self.live_calls() {
            self.end_calls(&id, "interrupted", false).await;
        }
        let rt = self.0.rt.lock().unwrap().take();
        match rt {
            Some(rt) => rt.shutdown(),
            None => Ok(()),
        }
    }
}
