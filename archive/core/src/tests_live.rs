//! The live layer: tasks (timers), parallelism, cancel, shutdown, crash, one writer per object,
//! and hot reload. Every data folder is a fresh temp dir.

use super::*;
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicUsize, Ordering};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-live-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = fs::remove_dir_all(&dir);
    dir
}
fn put(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}
fn md(title: &str, kind: &str, extra: &str) -> String {
    format!("---\ntitle: {title}\nkind: {kind}\n{extra}---\n")
}
fn hub(dir: &Path) -> Hub {
    Hub::new(boot(Box::new(FolderStore::open(dir).unwrap())).unwrap())
}
fn twin(h: &Hub, id: &str) -> Option<Value> {
    h.read(|rt| rt.twin(id)).unwrap()
}
fn saved(dir: &Path, id: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(dir.join(format!("state/{id}.json"))).unwrap()).unwrap()
}
/// A folder with engine `t` and timers `t/a`.. of the given seconds, plus counter `t/c` (step 5).
fn timers(dir: &Path, secs: &[u64]) {
    put(dir, "engines/t/engine.md", &md("T", "engine", ""));
    put(dir, "engines/t/elements/c.md", &md("C", "counter", "config: {step: 5}\n"));
    for (i, s) in secs.iter().enumerate() {
        let name = (b'a' + i as u8) as char;
        put(dir, &format!("engines/t/elements/{name}.md"), &md(&format!("Timer {name}"), "timer", &format!("config: {{seconds: {s}}}\n")));
    }
}
async fn until_idle(h: &Hub, id: &str, limit: Duration) -> Duration {
    let t0 = Instant::now();
    loop {
        if twin(h, id).unwrap()["phase"] != "running" {
            return t0.elapsed();
        }
        assert!(t0.elapsed() < limit, "{id} still running after {limit:?}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// ── tasks ──────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn timer_start_returns_at_once_and_ticks_in_the_background() {
    let dir = temp("timer");
    timers(&dir, &[2]);
    let h = hub(&dir);
    let mut events = h.subscribe();
    let t0 = Instant::now();
    let t = h.act("t/a", "start", &json!({})).await.unwrap();
    assert!(t0.elapsed() < Duration::from_millis(200), "act waited for the task: {:?}", t0.elapsed());
    assert_eq!(t["phase"], "running");
    assert_eq!(t["state"], json!({"elapsed": 0, "seconds": 2}));
    assert_eq!(t["actions"][0]["name"], "cancel");
    assert!(t["views"]["medium"].to_string().contains("\"Meter\""));
    assert_eq!(h.running(), ["t/a"]);
    assert!(h.act("t/a", "start", &json!({})).await.unwrap_err().to_string().contains("already running"));

    tokio::time::sleep(Duration::from_millis(1300)).await;
    assert_eq!(twin(&h, "t/a").unwrap()["state"]["elapsed"], 1, "progress is visible while running");
    assert_eq!(saved(&dir, "t/a")["state"]["elapsed"], 1, "each tick is persisted");
    until_idle(&h, "t/a", Duration::from_secs(3)).await;
    let t = twin(&h, "t/a").unwrap();
    assert_eq!((t["phase"].clone(), t["state"]["elapsed"].clone()), (json!("idle"), json!(2)));
    assert_eq!(saved(&dir, "t/a")["phase"], "idle");
    assert!(h.running().is_empty());
    // twin events for each tick: the timer, then its engine
    let mut ticks = 0;
    while let Ok(e) = events.try_recv() {
        if let Event::Twin(id, tw) = e
            && id == "t/a"
        {
            ticks += 1;
            assert!(tw["state"]["elapsed"].is_number());
        }
    }
    assert!(ticks >= 4, "start + 2 ticks + end, got {ticks}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn parallel_timers_take_the_longest_not_the_sum() {
    let dir = temp("parallel");
    let secs = [2, 2, 2, 3, 3];
    timers(&dir, &secs);
    let h = hub(&dir);
    let ids: Vec<String> = (0..secs.len()).map(|i| format!("t/{}", (b'a' + i as u8) as char)).collect();
    let t0 = Instant::now();
    let starts = ids.iter().map(|id| {
        let h = h.clone();
        let id = id.clone();
        tokio::spawn(async move { h.act(&id, "start", &json!({})).await.unwrap() })
    });
    for s in starts {
        assert_eq!(s.await.unwrap()["phase"], "running");
    }
    assert_eq!(h.running().len(), secs.len());
    for id in &ids {
        until_idle(&h, id, Duration::from_secs(6)).await;
    }
    let took = t0.elapsed();
    let sum: u64 = secs.iter().sum();
    println!("parallel timers {secs:?}: all done in {took:?} (max 3 s, sum {sum} s)");
    assert!(took >= Duration::from_secs(3), "{took:?}");
    assert!(took < Duration::from_millis(4500), "ran in series? {took:?} (sum {sum} s)");
    for (id, s) in ids.iter().zip(secs) {
        assert_eq!(twin(&h, id).unwrap()["state"]["elapsed"], s);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_stops_a_running_task() {
    let dir = temp("cancel");
    timers(&dir, &[10]);
    let h = hub(&dir);
    h.act("t/a", "start", &json!({})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    let t = h.act("t/a", "cancel", &json!({})).await.unwrap();
    assert_eq!(t["phase"], "stopped");
    assert_eq!(t["state"]["elapsed"], 1);
    assert!(h.running().is_empty());
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(twin(&h, "t/a").unwrap()["state"]["elapsed"], 1, "no tick after cancel");
    assert_eq!(saved(&dir, "t/a")["phase"], "stopped");
    assert!(h.act("t/a", "cancel", &json!({})).await.unwrap_err().to_string().contains("not running"));
    // and it can start again from zero
    assert_eq!(h.act("t/a", "start", &json!({})).await.unwrap()["state"]["elapsed"], 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shutdown_mid_task_cancels_persists_and_marks_stopped() {
    let dir = temp("shutdown");
    timers(&dir, &[10, 10]);
    let h = hub(&dir);
    h.act("t/a", "start", &json!({})).await.unwrap();
    h.act("t/b", "start", &json!({})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    let t0 = Instant::now();
    h.shutdown().await.unwrap();
    assert!(t0.elapsed() < Duration::from_secs(1), "shutdown waited for the timers: {:?}", t0.elapsed());
    assert!(h.act("t/a", "start", &json!({})).await.unwrap_err().is::<hub::Stopping>());
    for id in ["t/a", "t/b"] {
        assert_eq!(saved(&dir, id)["phase"], "stopped");
        assert_eq!(saved(&dir, id)["state"]["elapsed"], 1);
    }
    assert!(!dir.join(".lock").exists());
    let h = hub(&dir);
    assert_eq!(h.read(|rt| rt.info["last_exit"].clone()).unwrap(), "clean");
    assert_eq!(twin(&h, "t/a").unwrap()["phase"], "stopped");
    assert!(h.running().is_empty(), "nothing resumes by itself");
}

#[test]
fn crash_mid_task_comes_back_interrupted() {
    let dir = temp("crash");
    timers(&dir, &[10]);
    {
        let tokio = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        tokio.block_on(async {
            let h = hub(&dir);
            h.act("t/a", "start", &json!({})).await.unwrap();
            tokio::time::sleep(Duration::from_millis(1200)).await;
            std::mem::forget(h); // no shutdown: the process died
        });
        tokio.shutdown_background(); // the task dies mid-run
    }
    assert_eq!(saved(&dir, "t/a")["phase"], "running");
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    assert_eq!(rt.info["last_exit"], "crash");
    let t = rt.twin("t/a").unwrap();
    assert_eq!(t["phase"], "interrupted");
    assert_eq!(t["state"]["elapsed"], 1, "the last persisted tick is kept");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn one_writer_per_object_serializes_read_modify_write() {
    let dir = temp("writer");
    timers(&dir, &[]);
    let h = hub(&dir);
    let value = |h: &Hub| twin(h, "t/c").unwrap()["state"]["value"].as_i64().unwrap();
    let bump = |h: Hub, locked: bool| async move {
        let _w = if locked { Some(h.writer("t/c").await) } else { None };
        let v = twin(&h, "t/c").unwrap()["state"]["value"].as_i64().unwrap();
        tokio::time::sleep(Duration::from_millis(2)).await; // a task awaiting mid-change
        h.update_locked("t/c", |o| Ok(o.state["value"] = json!(v + 1))).unwrap();
    };
    let all: Vec<_> = (0..40).map(|_| tokio::spawn(bump(h.clone(), true))).collect();
    for t in all {
        t.await.unwrap();
    }
    assert_eq!(value(&h), 40, "every change applied, in order");
    assert_eq!(saved(&dir, "t/c")["state"]["value"], 40, "the file holds the last write");

    // the control: the same without the writer loses updates, so the test above can fail
    let all: Vec<_> = (0..40).map(|_| tokio::spawn(bump(h.clone(), false))).collect();
    for t in all {
        t.await.unwrap();
    }
    assert!(value(&h) < 80, "unserialized writes should collide");

    // another object's writer never waits on this one
    let held = h.writer("t/c").await;
    let other = tokio::time::timeout(Duration::from_millis(200), h.writer("t")).await;
    assert!(other.is_ok());
    drop(held);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn actions_and_ticks_on_one_object_do_not_interleave() {
    // a sync action waits for the object's writer, then sees the latest tick
    let dir = temp("interleave");
    timers(&dir, &[10]);
    let h = hub(&dir);
    h.act("t/a", "start", &json!({})).await.unwrap();
    let w = h.writer("t/a").await;
    tokio::time::sleep(Duration::from_millis(1300)).await; // a tick is due but cannot write
    assert_eq!(twin(&h, "t/a").unwrap()["state"]["elapsed"], 0);
    drop(w);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(twin(&h, "t/a").unwrap()["state"]["elapsed"], 1);
    h.shutdown().await.unwrap();
}

// ── hot reload ─────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reload_adds_changes_and_removes_keeping_live_state() {
    let dir = temp("reload");
    timers(&dir, &[]);
    put(&dir, "engines/t/elements/n.md", &(md("N", "note", "") + "hi"));
    let h = hub(&dir);
    let mut events = h.subscribe();
    h.act("t/c", "inc", &json!({})).await.unwrap();
    h.act("t/c", "inc", &json!({})).await.unwrap();
    while events.try_recv().is_ok() {}
    assert!(!h.reload().await.unwrap(), "nothing changed: no world");
    assert!(events.try_recv().is_err());

    // add
    put(&dir, "engines/t/elements/m.md", &md("M", "meter", "config: {max: 5}\n"));
    put(&dir, "engines/u/engine.md", &md("U", "engine", ""));
    assert!(h.reload().await.unwrap());
    assert!(matches!(events.try_recv().unwrap(), Event::World(w) if w["engines"].as_array().unwrap().len() == 2));
    assert_eq!(twin(&h, "t/m").unwrap()["state"]["value"], 0);
    assert!(twin(&h, "u").is_some());
    assert!(!h.reload().await.unwrap(), "idempotent");

    // change: title and config of a live counter; its state survives, the new step applies
    put(&dir, "engines/t/elements/c.md", &md("Count", "counter", "config: {step: 7}\n"));
    assert!(h.reload().await.unwrap());
    let c = twin(&h, "t/c").unwrap();
    assert_eq!((c["title"].clone(), c["state"]["value"].clone()), (json!("Count"), json!(10)));
    assert_eq!(h.act("t/c", "inc", &json!({})).await.unwrap()["state"]["value"], 17);
    assert_eq!(twin(&h, "t/n").unwrap()["state"]["text"], "hi", "untouched objects untouched");

    // a kind change gets the new kind's fresh state
    put(&dir, "engines/t/elements/m.md", &md("M", "counter", ""));
    h.reload().await.unwrap();
    assert_eq!(twin(&h, "t/m").unwrap()["kind"], "counter");

    // remove an element and an engine
    fs::remove_file(dir.join("engines/t/elements/n.md")).unwrap();
    fs::remove_dir_all(dir.join("engines/u")).unwrap();
    assert!(h.reload().await.unwrap());
    assert!(twin(&h, "t/n").is_none());
    assert!(twin(&h, "u").is_none());
    assert!(!h.reload().await.unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_broken_file_fails_its_object_only_and_recovers_when_fixed() {
    let dir = temp("broken");
    timers(&dir, &[]);
    let h = hub(&dir);
    h.act("t/c", "inc", &json!({})).await.unwrap();
    let good = fs::read_to_string(dir.join("engines/t/elements/c.md")).unwrap();

    for (bad, says) in [("---\ntitle: C\nkind: counter\nconfig: {step: 5\n---\n", "unclosed map"), (md("C", "gizmo", "").as_str(), "gizmo")] {
        put(&dir, "engines/t/elements/c.md", bad);
        assert!(h.reload().await.unwrap());
        let c = twin(&h, "t/c").unwrap();
        assert_eq!(c["phase"], "failed");
        let err = c["state"]["error"].as_str().unwrap();
        assert!(err.contains("engines/t/elements/c.md") && err.contains(says), "{err}");
        assert!(c["views"]["medium"].to_string().contains(says), "the views show the error");
        assert!(c["views"]["small"].to_string().contains("failed"));
        assert!(c["actions"].as_array().unwrap().is_empty());
        assert!(h.act("t/c", "inc", &json!({})).await.is_err());
        assert!(twin(&h, "t").unwrap()["prompt"].as_str().unwrap().contains("failed to load"));
        assert_eq!(saved(&dir, "t/c")["state"]["value"], 5, "the last good state stays on disk");
    }
    // the rest of the world still works
    assert!(h.act("t", "start", &json!({})).await.is_ok());

    put(&dir, "engines/t/elements/c.md", &good);
    assert!(h.reload().await.unwrap());
    let c = twin(&h, "t/c").unwrap();
    assert_eq!((c["phase"].clone(), c["state"]["value"].clone()), (json!("idle"), json!(5)));
    assert_eq!(h.act("t/c", "inc", &json!({})).await.unwrap()["state"]["value"], 10);

    // a broken engine.md: the engine fails, its elements still load
    put(&dir, "engines/t/engine.md", "---\ntitle: T\nno colon\n---\n");
    assert!(h.reload().await.unwrap());
    let t = twin(&h, "t").unwrap();
    assert_eq!(t["phase"], "failed");
    assert!(t["views"]["medium"].to_string().contains("line 3"));
    assert_eq!(t["elements"].as_array().unwrap().len(), 1);
    put(&dir, "engines/t/engine.md", &md("T", "engine", ""));
    assert!(h.reload().await.unwrap());
    assert_eq!(twin(&h, "t").unwrap()["phase"], "running", "the engine's saved phase is back");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reload_keeps_running_tasks_and_ends_those_whose_object_left() {
    let dir = temp("reloadtask");
    timers(&dir, &[10, 10]);
    let h = hub(&dir);
    h.act("t/a", "start", &json!({})).await.unwrap();
    h.act("t/b", "start", &json!({})).await.unwrap();
    // edit a's title, remove b
    put(&dir, "engines/t/elements/a.md", &md("Renamed", "timer", "config: {seconds: 10}\n"));
    fs::remove_file(dir.join("engines/t/elements/b.md")).unwrap();
    assert!(h.reload().await.unwrap());
    assert_eq!(h.running(), ["t/a"], "b's task ended with its object");
    tokio::time::sleep(Duration::from_millis(1200)).await;
    let a = twin(&h, "t/a").unwrap();
    assert_eq!((a["title"].clone(), a["phase"].clone(), a["state"]["elapsed"].clone()), (json!("Renamed"), json!("running"), json!(1)));
    // config change mid-run is read by the task: shorten it and it ends
    put(&dir, "engines/t/elements/a.md", &md("Renamed", "timer", "config: {seconds: 2}\n"));
    h.reload().await.unwrap();
    until_idle(&h, "t/a", Duration::from_secs(3)).await;
    assert_eq!(twin(&h, "t/a").unwrap()["state"]["elapsed"], 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn structure_actions_are_not_reloaded_twice() {
    let dir = temp("noloop");
    timers(&dir, &[]);
    let h = hub(&dir);
    h.act("t", "element.add", &json!({"kind": "timer", "title": "Egg", "config": {"seconds": 3}})).await.unwrap();
    assert_eq!(twin(&h, "t/egg").unwrap()["state"], json!({"elapsed": 0, "seconds": 3}));
    assert!(!h.reload().await.unwrap(), "the server's own write is already the world");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn engine_stop_cancels_running_tasks_below_it() {
    let dir = temp("cascade");
    timers(&dir, &[30]);
    put(&dir, "engines/t/engines/kid/engine.md", &md("Kid", "engine", ""));
    put(&dir, "engines/t/engines/kid/elements/k.md", &md("K", "timer", "config: {seconds: 30}\n"));
    put(&dir, "engines/u/engine.md", &md("U", "engine", ""));
    put(&dir, "engines/u/elements/o.md", &md("O", "timer", "config: {seconds: 30}\n"));
    let h = hub(&dir);
    for id in ["t/a", "t/kid/k", "u/o"] {
        h.act(id, "start", &json!({})).await.unwrap();
    }
    h.act("t/kid", "start", &json!({})).await.unwrap();
    assert_eq!(h.running(), ["t/a", "t/kid/k", "u/o"]);
    h.act("t", "stop", &json!({})).await.unwrap();
    assert_eq!(h.running(), ["u/o"], "only tasks below t were cancelled");
    for id in ["t/a", "t/kid/k", "t/kid"] {
        assert_eq!(twin(&h, id).unwrap()["phase"], "stopped", "{id}");
        assert_eq!(saved(&dir, id)["phase"], "stopped", "{id} on disk");
    }
    assert_eq!(twin(&h, "u/o").unwrap()["phase"], "running");
    h.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_removed_files_state_is_deleted_after_the_grace() {
    let dir = temp("grace");
    timers(&dir, &[]);
    put(&dir, "engines/t/elements/d.md", &md("D", "counter", ""));
    let h = hub(&dir);
    h.set_removed_grace(Duration::from_millis(300));
    h.act("t/c", "inc", &json!({})).await.unwrap();
    h.act("t/d", "inc", &json!({})).await.unwrap();
    let c_md = fs::read_to_string(dir.join("engines/t/elements/c.md")).unwrap();
    fs::remove_file(dir.join("engines/t/elements/c.md")).unwrap();
    fs::remove_file(dir.join("engines/t/elements/d.md")).unwrap();
    h.reload().await.unwrap();
    assert!(dir.join("state/t/c.json").exists() && dir.join("state/t/d.json").exists(), "kept during the grace");
    // c comes back within the grace: its state stays and is restored
    put(&dir, "engines/t/elements/c.md", &c_md);
    h.reload().await.unwrap();
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert!(!dir.join("state/t/d.json").exists(), "d's state deleted after the grace");
    assert_eq!(saved(&dir, "t/c")["state"]["value"], 5, "c came back: kept");
    assert_eq!(twin(&h, "t/c").unwrap()["state"]["value"], 5);
    h.shutdown().await.unwrap();
}
