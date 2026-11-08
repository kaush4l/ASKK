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
    generation: AtomicU64,
    /// How long a removed `.md`'s state file waits before it is deleted (ms).
    grace_ms: AtomicU64,
    /// Model connectors by name (`echo` always; the server adds the real ones).
    connectors: SyncMutex<HashMap<String, Arc<dyn crate::connector::Connector>>>,
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
    pub fn new(rt: Runtime) -> Self {
        let store = rt.store();
        let (events, _) = broadcast::channel(1024);
        Hub(Arc::new(Inner {
            rt: SyncMutex::new(Some(rt)),
            store,
            events,
            writers: SyncMutex::new(HashMap::new()),
            tasks: SyncMutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
            grace_ms: AtomicU64::new(REMOVED_GRACE.as_millis() as u64),
            connectors: SyncMutex::new(HashMap::from([("echo".to_string(), Arc::new(crate::connector::Echo) as Arc<dyn crate::connector::Connector>)])),
        }))
    }

    /// Add (or replace) a model connector by name.
    pub fn add_connector(&self, name: &str, c: Arc<dyn crate::connector::Connector>) {
        self.0.connectors.lock().unwrap().insert(name.to_string(), c);
    }
    pub fn connector(&self, name: &str) -> Option<Arc<dyn crate::connector::Connector>> {
        self.0.connectors.lock().unwrap().get(name).cloned()
    }
    pub fn connector_names(&self) -> Vec<String> {
        let mut v: Vec<String> = self.0.connectors.lock().unwrap().keys().cloned().collect();
        v.sort();
        v
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
            let by = if o.kind == "loop" { "loop" } else if o.kind == "workflows" { "workflow" } else { "task" };
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
        if action == "cancel" && self.stop_task(target, Stop::Cancel).await {
            return self.read(|rt| rt.twin(target))?.ok_or_else(|| anyhow!("{target} vanished"));
        }
        // an engine's stop cascades: the tasks below it are cancelled (→ stopped) first
        if action == "stop" && self.read(|rt| rt.obj(target).is_some_and(|o| o.kind == "engine"))? {
            let below = format!("{target}/");
            let ids: Vec<String> = self.running().into_iter().filter(|id| id.starts_with(&below)).collect();
            for id in ids {
                self.stop_task(&id, Stop::Cancel).await;
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
        for id in gone {
            self.stop_task(&id, Stop::Gone).await;
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
                        if matches!(o.phase, Phase::Running | Phase::Waiting) {
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
                    if s == Stop::Gone { Ok(()) } else { hub.update(&id, |o| {
                            o.phase = Phase::Stopped;
                            Ok(())
                        })
                        .await }
                }
            };
            if let Err(e) = write
                && !e.is::<Stopping>()
            {
                eprintln!("task {id}: {e:#}");
            }
            let mut tasks = hub.0.tasks.lock().unwrap();
            if tasks.get(&id).is_some_and(|t| t.generation == generation) {
                tasks.remove(&id);
            }
        });
        self.0.tasks.lock().unwrap().insert(key, Task { generation, stop, handle });
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
        let tasks: Vec<Task> = self.0.tasks.lock().unwrap().drain().map(|(_, t)| t).collect();
        for t in &tasks {
            let _ = t.stop.send(Some(Stop::Shutdown));
        }
        for t in tasks {
            let _ = tokio::time::timeout(SHUTDOWN_GRACE, t.handle).await;
        }
        let rt = self.0.rt.lock().unwrap().take();
        match rt {
            Some(rt) => rt.shutdown(),
            None => Ok(()),
        }
    }
}
