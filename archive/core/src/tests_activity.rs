//! Activity (what each object did, newest first in the twin), the focus line, the phase chip and the large scenes.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-act-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
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
fn twin(h: &Hub, id: &str) -> Value {
    h.read(|rt| rt.twin(id)).unwrap().unwrap_or_else(|| panic!("no {id}"))
}
async fn until_done(h: &Hub, id: &str) -> Value {
    let t0 = Instant::now();
    loop {
        let t = twin(h, id);
        if !matches!(t["phase"].as_str(), Some("running" | "waiting")) {
            return t;
        }
        assert!(t0.elapsed() < Duration::from_secs(5), "{id} still running");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
fn actions(t: &Value) -> Vec<String> {
    t["activity"].as_array().unwrap().iter().map(|a| a["action"].as_str().unwrap().to_string()).collect()
}
fn setup(dir: &Path) {
    put(dir, "engines/e/engine.md", &md("E", "engine", ""));
    put(dir, "engines/e/elements/model.md", &md("Model", "model", "order: 1\nconfig: {connector: echo, id: echo, context: 12000}\n"));
    put(dir, "engines/e/elements/loop.md", &md("Loop", "loop", "order: 2\n"));
    put(dir, "engines/e/elements/tools.md", &md("Tools", "tools", "order: 3\nconfig: {list: [clock.now, note.write]}\n"));
    put(dir, "engines/e/elements/note.md", &(md("Note", "note", "order: 4\n") + "first line\nsecond"));
    put(dir, "engines/e/elements/runs.md", &md("Runs", "counter", "order: 5\n"));
    put(dir, "engines/e/elements/timer.md", &md("Timer", "timer", "order: 6\nconfig: {seconds: 2}\n"));
    put(dir, "engines/e/elements/phases.md", &md("Phases", "phases", "order: 7\nconfig: {list: [{id: chat, title: Chat, icon: \"💬\", instructions: \"Talk it through with the owner\"}, {id: build, title: Build}]}\n"));
    put(dir, "engines/e/elements/workflows.md", &md("Workflows", "workflows", "order: 8\nconfig: {list: [{id: study, title: Study, phases: [chat, build]}]}\n"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn owner_actions_are_recorded_newest_first_capped_and_persisted() {
    let dir = temp("owner");
    setup(&dir);
    let h = hub(&dir);
    assert_eq!(twin(&h, "e/runs")["activity"], json!([]));
    for _ in 0..25 {
        h.act("e/runs", "inc", &json!({})).await.unwrap();
    }
    h.act("e/runs", "reset", &json!({})).await.unwrap();
    let t = twin(&h, "e/runs");
    let a = t["activity"].as_array().unwrap();
    assert_eq!(a.len(), 20, "capped");
    assert_eq!(a[0]["action"], "reset", "newest first");
    assert_eq!(a[0]["by"], "owner");
    assert_eq!(a[0]["ok"], true);
    assert!(a[0]["at"].as_u64().unwrap() > 0 && a[0]["text"].is_string());
    assert!(t["state"].get("activity").is_none(), "not inside state");
    // engine actions too
    h.act("e", "start", &json!({})).await.unwrap();
    assert_eq!(actions(&twin(&h, "e"))[0], "start");
    // survives a restart
    h.shutdown().await.unwrap();
    let h = hub(&dir);
    assert_eq!(twin(&h, "e/runs")["activity"].as_array().unwrap().len(), 20);
    assert_eq!(actions(&twin(&h, "e"))[0], "start");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn tasks_record_start_and_end_never_ticks() {
    let dir = temp("timer");
    setup(&dir);
    let h = hub(&dir);
    h.act("e/timer", "start", &json!({})).await.unwrap();
    let t = until_done(&h, "e/timer").await;
    assert_eq!(actions(&t), ["done", "start"], "{}", t["activity"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_loop_records_each_step_and_the_model_its_calls() {
    let dir = temp("loop");
    setup(&dir);
    let h = hub(&dir);
    h.act("e/loop", "run", &json!({"input": "hello"})).await.unwrap();
    let t = until_done(&h, "e/loop").await;
    let mut a = actions(&t);
    a.reverse();
    assert_eq!(a.first().map(String::as_str), Some("run"));
    assert!(a.iter().filter(|x| *x == "model").count() >= 2, "{a:?}");
    assert!(a.iter().any(|x| x == "tool"), "{a:?}");
    assert!(a.iter().any(|x| x == "answer"), "{a:?}");
    let texts = t["activity"].to_string();
    assert!(texts.contains("tool clock.now ok"), "{texts}");
    assert!(texts.contains("model replied"), "{texts}");
    assert!(t["activity"][0]["by"] == "loop" || t["activity"][0]["by"] == "task");
    // focus: the last answer once idle
    assert!(t["status"]["focus"].as_str().unwrap().starts_with("echo: hello"), "{}", t["status"]);
    assert_eq!(t["status"]["chip"], "💬 Chat");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn phases_and_workflows_record_their_steps() {
    let dir = temp("wf");
    setup(&dir);
    let h = hub(&dir);
    h.act("e/phases", "set", &json!({"phase": "build"})).await.unwrap();
    assert_eq!(actions(&twin(&h, "e/phases"))[0], "set");
    h.act("e/phases", "set", &json!({"phase": "chat"})).await.unwrap();
    h.act("e/workflows", "run", &json!({"workflow": "study", "input": "x"})).await.unwrap();
    let t = until_done(&h, "e/workflows").await;
    let a = actions(&t);
    assert!(a.iter().filter(|x| *x == "phase").count() >= 2, "{a:?}");
    assert!(t["activity"].to_string().contains("build"));
}

#[test]
fn focus_and_chip_per_kind() {
    let dir = temp("focus");
    setup(&dir);
    let h = hub(&dir);
    let f = |id: &str| twin(&h, id)["status"]["focus"].as_str().unwrap().to_string();
    assert_eq!(f("e/note"), "first line");
    assert_eq!(f("e/runs"), "value 0");
    assert_eq!(f("e/loop"), "ready");
    assert!(f("e/phases").starts_with("💬 Chat"), "{}", f("e/phases"));
    assert!(f("e/phases").contains("Talk it through"));
    assert_eq!(f("e/model"), "echo");
    assert!(f("e/tools").contains("clock.now"));
    assert!(f("e").contains("ready"), "{}", f("e"));
    assert_eq!(twin(&h, "e")["status"]["chip"], "💬 Chat");
    assert_eq!(twin(&h, "e/phases")["status"]["chip"], "💬 Chat");
    assert_eq!(twin(&h, "e/runs")["status"]["chip"], Value::Null);
}

#[test]
fn large_views_name_their_scene() {
    let dir = temp("scene");
    setup(&dir);
    let h = hub(&dir);
    let s = |id: &str| twin(&h, id)["views"]["large"]["props"]["scene"].as_str().unwrap_or("").to_string();
    assert_eq!(s("e/loop"), "conversation");
    assert_eq!(s("e/model"), "meters");
    assert_eq!(s("e/phases"), "gallery");
    assert_eq!(s("e/workflows"), "pipeline");
    assert_eq!(s("e/note"), "reader");
    assert_eq!(s("e"), "spatial");
    assert_eq!(s("e/runs"), "default");
    for id in ["e", "e/loop", "e/model", "e/phases", "e/workflows", "e/note", "e/runs"] {
        let t = twin(&h, id);
        for size in ["icon", "small", "medium", "large"] {
            crate::design::check_tree(&t["views"][size]).unwrap_or_else(|e| panic!("{id} {size}: {e}"));
        }
    }
    let phases = twin(&h, "e/phases")["views"]["large"].to_string();
    assert!(phases.contains("Talk it through") && phases.contains("\"set\""));
    assert!(twin(&h, "e/workflows")["views"]["large"].to_string().contains("→"));
}
