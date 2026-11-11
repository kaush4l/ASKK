//! # Default developer tools (server only)
//!
//! Shared tools any engine may select with a `tools` element (`use: [...]`):
//!
//! | tool | args | does |
//! | --- | --- | --- |
//! | `read_file` | `{path}` | file text (relative to the workspace root) |
//! | `write_file` | `{path, content}` | create/overwrite, parents created |
//! | `list_dir` | `{path?}` | entries, `/` suffix for folders |
//! | `run` | `{command, timeout_s?}` | `sh -c`, waits; `{code, stdout, stderr}` |
//! | `spawn` | `{command}` | long-running process in the background → `{id}` |
//! | `jobs` | `{}` | every spawned process: id, command, running/exit code, output tail |
//! | `stop` | `{id}` | kill a spawned process |
//! | `alarm` | `{after_s, input, engine?}` | wake an engine with `input` later |
//! | `create_script` | `{engine, name, description, steps}` | save a script element (loads on next boot) |
//! | `parallel` | `{calls: [{tool, args}]}` | run calls at once, results in call order |
//!
//! Paths may not leave the workspace root (`ASKK_WORKSPACE`, default the working directory).
//! Workspace files are the user's work, not askk state, so they bypass the store; scripts and
//! the job record are askk state and go through it.
use crate::core::held::Held;
use crate::core::store::{join, Store};
use crate::core::{tool, Fut, IntoTool, Tool, Toolbox};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Where an alarm goes when it fires: `(engine, input)`.
/// The workspace's files on this disk (the host's side of `core/files.rs`).
pub struct Disk;

impl crate::core::files::Files for Disk {
    fn list(&self, dir: &Path) -> Vec<(String, bool)> {
        let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
        let mut v: Vec<(String, bool)> = rd.flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), e.path().is_dir())).collect();
        v.sort();
        v
    }
    fn is_file(&self, file: &Path) -> bool {
        file.is_file()
    }
    fn read(&self, file: &Path) -> Result<String, String> {
        std::fs::read_to_string(file).map_err(|e| e.to_string())
    }
    fn write(&self, file: &Path, text: &str) -> Result<(), String> {
        if let Some(d) = file.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(file, text).map_err(|e| e.to_string())
    }
}

pub type Fire = Arc<dyn Fn(String, String) + Send + Sync>;

pub fn workspace() -> PathBuf {
    crate::core::places::workspace()
}

/// All default tools over `root`, scripts saved under the `engines` key of `store`, alarms sent
/// to `fire`. Spawned jobs are recorded in the same store (`jobs.json`).
pub fn all(root: PathBuf, store: Arc<dyn Store>, engines: String, fire: Fire) -> Vec<Arc<dyn Tool>> {
    *RECORD.held() = Some(store.clone());
    let (r1, r2, r3, r4) = (root.clone(), root.clone(), root.clone(), root.clone());
    vec![
        tool("read_file", "read a text file", json!({"path": "relative path"}), move |a| {
            std::fs::read_to_string(inside(&r1, str_arg(&a, "path")?)?).map(Value::String).map_err(|e| e.to_string())
        }),
        tool("write_file", "create or overwrite a text file", json!({"path": "relative path", "content": "text"}), move |a| {
            let p = inside(&r2, str_arg(&a, "path")?)?;
            let content = str_arg(&a, "content")?;
            if let Some(d) = p.parent() {
                std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
            }
            std::fs::write(&p, content).map_err(|e| e.to_string())?;
            Ok(json!(format!("wrote {} bytes", content.len())))
        }),
        tool("list_dir", "list a folder", json!({"path": "relative path, default ."}), move |a| {
            let p = inside(&r3, a["path"].as_str().unwrap_or("."))?;
            let mut v: Vec<String> = std::fs::read_dir(&p)
                .map_err(|e| e.to_string())?
                .flatten()
                .map(|e| e.file_name().to_string_lossy().to_string() + if e.path().is_dir() { "/" } else { "" })
                .collect();
            v.sort();
            Ok(json!(v))
        }),
        Run(r4.clone()).into_tool(),
        Spawn(r4).into_tool(),
        tool("jobs", "list spawned processes with status and output tail", Value::Null, |_| Ok(jobs())),
        tool("stop", "stop a spawned process", json!({"id": "job id"}), |a| stop(a["id"].as_u64().ok_or("id missing")?)),
        tool("alarm", "wake an engine with an input after a delay", json!({"after_s": "seconds", "input": "text", "engine": "path, default askk"}), move |a| {
            let after = a["after_s"].as_f64().ok_or("after_s missing")?;
            if !after.is_finite() || after < 0.0 {
                return Err(format!("after_s must be a number of seconds from now, 0 or more (got {after}); a past time would wake at once"));
            }
            let input = str_arg(&a, "input")?.to_string();
            let engine = a["engine"].as_str().unwrap_or("askk").to_string();
            let fire = fire.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs_f64(after.max(0.0))).await;
                fire(engine, input);
            });
            Ok(json!(format!("alarm in {after}s")))
        }),
        tool("create_script", "save a script element: a named sequence of tool calls ($prev = previous result)", json!({"engine": "path", "name": "tool name", "description": "text", "steps": [{"tool": "name", "args": {}}]}), move |a| {
            let name = str_arg(&a, "name")?;
            if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
                return Err(format!("bad script name '{name}'"));
            }
            let engine = str_arg(&a, "engine")?;
            inside(Path::new(""), engine)?;
            let dir = join(&engines, engine);
            if !store.has(&join(&dir, "engine.json")) {
                return Err(format!("no engine at {dir}"));
            }
            let spec = json!({"kind": "script", "name": name, "config": {"description": a["description"], "steps": a["steps"]}});
            crate::core::build(serde_json::from_value(spec.clone()).map_err(|e| e.to_string())?)?;
            store.put(&join(&dir, &format!("elements/{name}.json")), &serde_json::to_string_pretty(&spec).unwrap())?;
            Ok(json!(format!("saved script {name}; it loads on next boot")))
        }),
        Parallel.into_tool(),
    ]
}

fn str_arg<'a>(a: &'a Value, k: &str) -> Result<&'a str, String> {
    a[k].as_str().ok_or_else(|| format!("{k} missing"))
}

/// `rel` under `root`, refusing absolute paths and `..`.
pub fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(format!("path '{rel}' must stay inside the workspace"));
    }
    Ok(root.join(p))
}

fn sh(root: &Path, command: &str) -> tokio::process::Command {
    let mut c = tokio::process::Command::new("sh");
    c.arg("-c").arg(command).current_dir(root).stdin(std::process::Stdio::null());
    c
}

struct Run(PathBuf);

impl Tool for Run {
    fn name(&self) -> String { "run".into() }
    fn description(&self) -> String { "run a shell command and wait for it".into() }
    fn args(&self) -> Value { json!({"command": "sh command", "timeout_s": "default 60"}) }
    fn invoke(&self, a: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        let root = self.0.clone();
        Box::pin(async move {
            let cmd = str_arg(&a, "command")?.to_string();
            let secs = a["timeout_s"].as_f64().unwrap_or(60.0);
            let mut c = sh(&root, &cmd);
            c.kill_on_drop(true);
            let out = tokio::time::timeout(std::time::Duration::from_secs_f64(secs), c.output())
                .await
                .map_err(|_| format!("timed out after {secs}s (use spawn for long-running commands)"))?
                .map_err(|e| e.to_string())?;
            Ok(json!({"code": out.status.code(), "stdout": String::from_utf8_lossy(&out.stdout), "stderr": String::from_utf8_lossy(&out.stderr)}))
        })
    }
}

const TAIL: usize = 4000;

struct Job {
    command: String,
    child: tokio::process::Child,
    output: Arc<Mutex<String>>,
}

static JOBS: Mutex<BTreeMap<u64, Job>> = Mutex::new(BTreeMap::new());
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
/// Where spawned jobs are recorded (`jobs.json`: `[{id, command, lost}]`).
static RECORD: Mutex<Option<Arc<dyn Store>>> = Mutex::new(None);
/// Jobs from before the last restart: their processes are gone, so they show as `lost`.
static LOST: Mutex<Vec<(u64, String)>> = Mutex::new(vec![]);
const KEEP_LOST: usize = 20;

fn record(id: u64, command: &str) {
    let Some(st) = RECORD.held().clone() else { return };
    let mut all: Vec<Value> = st.get(&crate::core::manifest::manifest().jobs).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    all.push(json!({"id": id, "command": command, "lost": false}));
    if let Err(e) = st.put(&crate::core::manifest::manifest().jobs, &serde_json::to_string_pretty(&all).unwrap()) {
        eprintln!("askk: jobs: {e}");
    }
}

/// At boot: every recorded job belongs to a process that no longer exists. Mark them lost
/// (kept, the last 20) so `jobs` still shows what ran, and number new jobs after them.
/// The folder of the project `name` in the workspace (made if absent); an empty name is the
/// workspace itself. The caller has checked that the name is one plain folder name.
pub fn project(name: &str) -> Result<PathBuf, String> {
    let dir = crate::core::places::workspace().join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn recover_jobs(st: Arc<dyn Store>) {
    let all: Vec<Value> = st.get(&crate::core::manifest::manifest().jobs).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let lost: Vec<(u64, String)> = all.iter().filter_map(|j| Some((j["id"].as_u64()?, j["command"].as_str()?.to_string()))).collect();
    let lost = lost[lost.len().saturating_sub(KEEP_LOST)..].to_vec();
    if let Some(max) = lost.iter().map(|(i, _)| *i).max() {
        NEXT.fetch_max(max + 1, std::sync::atomic::Ordering::SeqCst);
    }
    let kept: Vec<Value> = lost.iter().map(|(id, c)| json!({"id": id, "command": c, "lost": true})).collect();
    let _ = st.put(&crate::core::manifest::manifest().jobs, &serde_json::to_string_pretty(&kept).unwrap());
    *LOST.held() = lost;
    *RECORD.held() = Some(st);
}

fn tail(s: &str) -> &str {
    let from = (s.len().saturating_sub(TAIL)..s.len()).find(|i| s.is_char_boundary(*i)).unwrap_or(s.len());
    &s[from..]
}

fn collect(r: impl tokio::io::AsyncRead + Unpin + Send + 'static, out: Arc<Mutex<String>>) {
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(r).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            let mut o = out.held();
            o.push_str(&l);
            o.push('\n');
            if o.len() > TAIL * 2 {
                *o = tail(&o).to_string();
            }
        }
    });
}

struct Spawn(PathBuf);

impl Tool for Spawn {
    fn name(&self) -> String { "spawn".into() }
    fn description(&self) -> String { "start a long-running shell command in the background; see jobs, stop".into() }
    fn args(&self) -> Value { json!({"command": "sh command"}) }
    fn invoke(&self, a: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        let root = self.0.clone();
        Box::pin(async move {
            let command = str_arg(&a, "command")?.to_string();
            let mut child = sh(&root, &command)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .map_err(|e| e.to_string())?;
            let output = Arc::new(Mutex::new(String::new()));
            collect(child.stdout.take().unwrap(), output.clone());
            collect(child.stderr.take().unwrap(), output.clone());
            let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            record(id, &command);
            JOBS.held().insert(id, Job { command, child, output });
            Ok(json!({"id": id}))
        })
    }
}

pub fn jobs() -> Value {
    let mut all = JOBS.held();
    let live: Vec<u64> = all.keys().copied().collect();
    let lost = LOST.held().clone();
    Value::Array(
        lost.into_iter()
            .filter(|(id, _)| !live.contains(id))
            .map(|(id, command)| json!({"id": id, "command": command, "status": "lost", "output": "(the app restarted; the process is gone)"}))
            .chain(all.iter_mut()
            .map(|(id, j)| {
                let status = match j.child.try_wait() {
                    Ok(None) => json!("running"),
                    Ok(Some(s)) => json!(s.code()),
                    Err(e) => json!(e.to_string()),
                };
                json!({"id": id, "command": j.command, "status": status, "output": tail(&j.output.held())})
            }))
            .collect(),
    )
}

pub fn stop(id: u64) -> Result<Value, String> {
    let mut all = JOBS.held();
    let j = all.get_mut(&id).ok_or_else(|| format!("no job {id}"))?;
    if j.child.try_wait().ok().flatten().is_some() {
        return Ok(json!(format!("job {id} had already exited")));
    }
    j.child.start_kill().map_err(|e| e.to_string())?;
    Ok(json!(format!("stopped job {id}")))
}

/// Several calls at once through the same toolbox (so each is logged like a direct call).
struct Parallel;

impl Tool for Parallel {
    fn name(&self) -> String { "parallel".into() }
    fn description(&self) -> String { "run several tool calls at the same time; results in call order".into() }
    fn args(&self) -> Value { json!({"calls": [{"tool": "name", "args": {}}]}) }
    fn invoke(&self, a: Value, tb: Toolbox) -> Fut<Result<Value, String>> {
        Box::pin(async move {
            let calls: Vec<crate::core::Call> = serde_json::from_value(a["calls"].clone()).map_err(|e| format!("calls: {e}"))?;
            let rs = futures::future::join_all(calls.iter().map(|c| tb.call(&c.tool, c.args.clone()))).await;
            Ok(Value::Array(rs.into_iter().map(|r| r.unwrap_or_else(|e| json!({"error": e}))).collect()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(tag: &str) -> (PathBuf, Toolbox, Arc<Mutex<Vec<(String, String)>>>) {
        let (st, root) = crate::core::store::temp(&format!("dev-{tag}"));
        st.put("engines/e/engine.json", r#"{"name":"e"}"#).unwrap();
        let fired: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
        let f = fired.clone();
        let tb = Toolbox::new(all(root.clone(), st, "engines".into(), Arc::new(move |e, i| f.held().push((e, i)))));
        (root, tb, fired)
    }

    #[tokio::test]
    async fn files_stay_inside_the_workspace() {
        let (root, tb, _) = setup("fs");
        tb.call("write_file", json!({"path": "a/b.txt", "content": "hi"})).await.unwrap();
        assert_eq!(tb.call("read_file", json!({"path": "a/b.txt"})).await.unwrap(), json!("hi"));
        assert_eq!(tb.call("list_dir", json!({"path": "a"})).await.unwrap(), json!(["b.txt"]));
        assert!(tb.call("list_dir", json!({})).await.unwrap().as_array().unwrap().contains(&json!("a/")));
        for bad in ["../x", "/etc/passwd", "a/../../x"] {
            assert!(tb.call("read_file", json!({"path": bad})).await.unwrap_err().contains("inside the workspace"), "{bad}");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn run_waits_and_times_out() {
        let (root, tb, _) = setup("run");
        let r = tb.call("run", json!({"command": "echo out; echo err >&2; exit 3"})).await.unwrap();
        assert_eq!(r, json!({"code": 3, "stdout": "out\n", "stderr": "err\n"}));
        assert!(tb.call("run", json!({"command": "sleep 5", "timeout_s": 0.2})).await.unwrap_err().contains("timed out"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn spawned_processes_keep_running_until_stopped() {
        let (root, tb, _) = setup("spawn");
        let id = tb.call("spawn", json!({"command": "echo started; sleep 30"})).await.unwrap()["id"].as_u64().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let job = |v: Value| v.as_array().unwrap().iter().find(|j| j["id"] == json!(id)).cloned().unwrap();
        let j = job(tb.call("jobs", json!({})).await.unwrap());
        assert_eq!((j["status"].clone(), j["output"].clone()), (json!("running"), json!("started\n")));
        assert_eq!(tb.call("stop", json!({"id": id})).await.unwrap(), json!(format!("stopped job {id}")));
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert_ne!(job(tb.call("jobs", json!({})).await.unwrap())["status"], json!("running"));
        assert!(tb.call("stop", json!({"id": 999999})).await.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn jobs_from_before_a_restart_show_as_lost() {
        let (st, root) = crate::core::store::temp("jobs");
        st.put(&crate::core::manifest::manifest().jobs, r#"[{"id": 41, "command": "npm run dev", "lost": false}]"#).unwrap();
        recover_jobs(st.clone());
        let j = jobs();
        let lost = j.as_array().unwrap().iter().find(|j| j["id"] == json!(41)).cloned().unwrap();
        assert_eq!((lost["status"].as_str(), lost["command"].as_str()), (Some("lost"), Some("npm run dev")));
        assert!(NEXT.load(std::sync::atomic::Ordering::SeqCst) > 41, "new jobs number after the old ones");
        assert!(st.get(&crate::core::manifest::manifest().jobs).unwrap().contains("\"lost\": true"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn parallel_runs_calls_at_once_in_call_order() {
        let (root, tb, _) = setup("par");
        let t = std::time::Instant::now();
        let r = tb
            .call("parallel", json!({"calls": [{"tool": "run", "args": {"command": "sleep 0.3; echo a"}}, {"tool": "run", "args": {"command": "sleep 0.3; echo b"}}, {"tool": "nope"}]}))
            .await
            .unwrap();
        assert!(t.elapsed().as_millis() < 550, "{:?}", t.elapsed());
        assert_eq!((r[0]["stdout"].clone(), r[1]["stdout"].clone(), r[2].clone()), (json!("a\n"), json!("b\n"), json!({"error": "no tool 'nope'"})));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn alarms_fire_later_and_scripts_are_saved_as_elements() {
        let (root, tb, fired) = setup("alarm");
        tb.call("alarm", json!({"after_s": 0.1, "input": "wake up", "engine": "e"})).await.unwrap();
        assert!(fired.held().is_empty());
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert_eq!(*fired.held(), [("e".to_string(), "wake up".to_string())]);
        for bad in [json!({"after_s": -5, "input": "x", "engine": "e"}), json!({"input": "x", "engine": "e"}), json!({"after_s": "soon", "input": "x", "engine": "e"})] {
            assert!(tb.call("alarm", bad.clone()).await.is_err(), "{bad}");
        }
        let err = tb.call("alarm", json!({"after_s": -5, "input": "x", "engine": "e"})).await.unwrap_err();
        assert!(err.contains("0 or more"), "{err}");
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(fired.held().len(), 1, "a refused alarm must not fire");

        let steps = json!([{"tool": "now"}, {"tool": "remember", "args": {"key": "t", "value": "$prev"}}]);
        tb.call("create_script", json!({"engine": "e", "name": "stamp", "description": "save time", "steps": steps})).await.unwrap();
        let saved: crate::core::Spec = serde_json::from_str(&std::fs::read_to_string(root.join("engines/e/elements/stamp.json")).unwrap()).unwrap();
        assert_eq!((saved.kind.as_str(), saved.name.as_str()), ("script", "stamp"));
        assert!(tb.call("create_script", json!({"engine": "nope", "name": "x", "steps": []})).await.is_err());
        assert!(tb.call("create_script", json!({"engine": "e", "name": "../x", "steps": []})).await.is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
