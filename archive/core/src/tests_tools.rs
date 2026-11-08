//! Tools: the registry and specs, the reply format (ids, await, cancel, JSON), and the
//! non-blocking loop (await none / any / ids, cancel, timeout, an answer while calls run,
//! max_running), with a scripted connector.

use super::*;
use crate::{connector::*, run, tools, toon};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-tools-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
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
fn twin(h: &Hub, id: &str) -> Value {
    h.read(|rt| rt.twin(id)).unwrap().unwrap()
}
async fn until_done(h: &Hub, id: &str, limit: Duration) -> Value {
    let t0 = Instant::now();
    loop {
        let t = twin(h, id);
        if !matches!(t["phase"].as_str(), Some("running" | "waiting")) {
            return t;
        }
        assert!(t0.elapsed() < limit, "{id} still running after {limit:?}: {}", t["state"]);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Replies in order (after a short delay); records every prompt it was sent and the most model
/// prompts in order.
struct Script {
    replies: Mutex<VecDeque<String>>,
    seen: Arc<Mutex<Vec<String>>>,
}
impl Connector for Script {
    fn call(&self, _: ModelSpec, call: ModelCall) -> ReplyFuture {
        self.seen.lock().unwrap().push(call.prompt.clone());
        let r = self.replies.lock().unwrap().pop_front().unwrap_or_else(|| "answer: out of script".into());
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok(r)
        })
    }
}

/// A slow tool with a short timeout, and an owner-only one.
struct Slow(tools::ToolSpec);
impl tools::Tool for Slow {
    fn spec(&self) -> &tools::ToolSpec {
        &self.0
    }
    fn run(&self, _: tools::ToolCtx, _: Value) -> tools::ToolFuture {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            Ok(json!({}))
        })
    }
}
/// Sleeps 30 s (long timeout): a call that is still running when the test looks.
struct Hang(tools::ToolSpec);
impl tools::Tool for Hang {
    fn spec(&self) -> &tools::ToolSpec {
        &self.0
    }
    fn run(&self, _: tools::ToolCtx, _: Value) -> tools::ToolFuture {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok(json!({}))
        })
    }
}
fn add_test_tools(h: &Hub) {
    h.add_tool(Arc::new(Hang(tools::ToolSpec::new("test.hang", "sleeps 30 s").long().timeout(60_000))));
    h.add_tool(Arc::new(Slow(tools::ToolSpec::new("test.slow", "sleeps past its timeout").long().timeout(100))));
    h.add_tool(Arc::new(Slow(tools::ToolSpec::new("test.owner", "the owner's only").by(tools::By::Owner))));
}

/// Engine `e` with the scripted model, a loop (extra config) and the given tools; returns the
/// hub and the prompts the model saw.
fn scripted(name: &str, loop_cfg: &str, replies: &[&str]) -> (Hub, Arc<Mutex<Vec<String>>>) {
    scripted_in(&temp(name), loop_cfg, replies, true)
}
fn scripted_in(dir: &Path, loop_cfg: &str, replies: &[&str], fresh: bool) -> (Hub, Arc<Mutex<Vec<String>>>) {
    let dir = dir.to_path_buf();
    if fresh {
        put(&dir, "engines/e/engine.md", &md("E", "engine", ""));
        put(&dir, "engines/e/elements/model.md", &md("Model", "model", "order: 1\nconfig: {connector: script, id: s}\n"));
        put(&dir, "engines/e/elements/loop.md", &md("Loop", "loop", &format!("order: 2\n{loop_cfg}")));
        put(&dir, "engines/e/elements/tools.md", &md("Tools", "tools", "order: 3\nconfig: {list: [clock.wait, clock.now, test.slow, test.owner, test.hang]}\n"));
    }
    let h = Hub::new(boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap());
    add_test_tools(&h);
    let seen = Arc::new(Mutex::new(vec![]));
    h.add_connector("script", Arc::new(Script { replies: Mutex::new(replies.iter().map(|s| s.to_string()).collect()), seen: seen.clone() }));
    (h, seen)
}
fn tool_msgs(t: &Value) -> Vec<Value> {
    t["state"]["messages"].as_array().unwrap().iter().filter(|m| m["role"] == "tool").cloned().collect()
}

// ── the format ─────────────────────────────────────────────────────────────

#[test]
fn replies_carry_ids_await_and_cancel() {
    let r = toon::parse("thought: go\ncalls[2]{id,tool,args}:\n  c1,web.fetch,{\"url\":\"a,b\"}\n  c2,clock.now,{}\nawait: any\ncancel: c0\n").unwrap();
    assert_eq!(r.calls[0], toon::Call { id: Some("c1".into()), tool: "web.fetch".into(), args: json!({"url": "a,b"}) });
    assert_eq!(r.calls[1].id.as_deref(), Some("c2"));
    assert_eq!(r.wait, toon::Await::Any);
    assert_eq!(r.cancel, ["c0"]);
    for (w, want) in [("all", toon::Await::All), ("none", toon::Await::None), ("c1, c3", toon::Await::Ids(vec!["c1".into(), "c3".into()]))] {
        assert_eq!(toon::parse(&format!("calls[0]:\nawait: {w}")).unwrap().wait, want);
    }
    // the default is all; ids are optional; calls[0] alone is a wait
    let r = toon::parse("calls[1]{tool,args}:\n  clock.now,{}\n").unwrap();
    assert_eq!((r.calls[0].id.clone(), r.wait.clone()), (None, toon::Await::All));
    assert!(toon::parse("calls[0]{id,tool,args}:\n").unwrap().calls.is_empty());
    assert_eq!(toon::parse("cancel: c1, c2\nanswer: stop").unwrap().cancel, ["c1", "c2"]);
    // count mismatches, bad ids, bad await
    assert!(toon::parse_toon("calls[2]{id,tool,args}:\n  c1,clock.now,{}\n").is_err());
    assert!(toon::parse_toon("calls[1]{id,tool,args}:\n  c1,clock.now,{}\n  c2,clock.now,{}\n").is_err());
    assert!(toon::parse_toon("calls[1]{id,tool,args}:\n  1x,clock.now,{}\n").is_err());
    assert!(toon::parse_toon("calls[0]:\nawait: soon please").is_err());
    assert!(toon::parse_toon("thought: only").is_err());
    // JSON fallback
    let r = toon::parse(r#"{"thought":"t","calls":[{"id":"c1","tool":"clock.now","args":{}},{"tool":"clock.wait","args":{"ms":1}}],"await":"none","cancel":["c9"]}"#).unwrap();
    assert_eq!((r.calls.len(), r.calls[1].id.clone(), r.wait, r.cancel), (2, None, toon::Await::None, vec!["c9".to_string()]));
    assert_eq!(toon::parse(r#"{"calls":[],"await":["c1","c2"]}"#).unwrap().wait, toon::Await::Ids(vec!["c1".into(), "c2".into()]));
    assert!(toon::format_help(true).contains("await: all | any | none"));
    assert!(!toon::format_help(false).contains("calls"));
}

// ── the registry ───────────────────────────────────────────────────────────

#[test]
fn the_registry_holds_the_built_ins_with_full_specs() {
    let names: Vec<String> = tools::specs().into_iter().map(|s| s.name).collect();
    for n in ["note.write", "clock.now", "clock.wait", "help.ask", "files.read"] {
        assert!(names.contains(&n.to_string()), "{n}");
    }
    let w = tools::find("clock.wait").unwrap();
    let s = w.spec();
    assert_eq!((s.mode, s.args_line().as_str(), s.by), (tools::Mode::Long, "{ms: int}", tools::By::Model));
    assert!(s.timeout_ms > tools::WAIT_LIMIT_MS);
    assert_eq!(tools::find("note.write").unwrap().spec().args_line(), "{text: string, note?: string, append?: bool}");
    assert_eq!(tools::find("files.read").unwrap().spec().effects, [tools::Effect::Read]);
    assert!(s.prompt_line().starts_with("- clock.wait {ms: int} [long]: wait some milliseconds"));
    for s in tools::specs() {
        let (ns, verb) = s.name.split_once('.').expect("<ns>.<verb>");
        assert!(!ns.is_empty() && !verb.is_empty() && !s.description.is_empty(), "{}", s.name);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn added_tools_are_offered_unless_they_are_the_owners() {
    let (h, _) = scripted("reg", "", &[]);
    assert!(h.tool("test.slow").is_some());
    let off = h.read(|rt| run::offered(rt.engine_node("e").unwrap())).unwrap();
    assert_eq!(off, ["clock.wait", "clock.now", "test.slow", "test.hang"], "by: owner is not offered to the model");
    let p = h.read(|rt| run::render(rt.engine_node("e").unwrap(), rt.obj("e/loop").unwrap())).unwrap();
    let order: Vec<usize> = ["# ENGINE", "# TOOLS", "# INPUT", "# REPLY FORMAT"].iter().map(|s| p.find(s).unwrap()).collect();
    assert!(order.windows(2).all(|w| w[0] < w[1]), "sections in order: {p}");
    assert!(p.contains("- test.slow {} [long]") && !p.contains("test.owner"));
}

// ── the non-blocking loop ──────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn r2_r4_await_none_lets_a_later_call_finish_before_an_earlier_one() {
    let (h, seen) = scripted(
        "none",
        "",
        &[
            "thought: start the long one\ncalls[1]{id,tool,args}:\n  c1,clock.wait,{\"ms\":1000}\nawait: none",
            "thought: meanwhile\ncalls[1]{id,tool,args}:\n  c2,clock.now,{}\nawait: c2",
            "thought: now wait for c1\ncalls[0]:\nawait: c1",
            "answer: done",
        ],
    );
    let t0 = Instant::now();
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    let took = t0.elapsed();
    assert_eq!(t["state"]["last_answer"], "done", "{}", t["state"]);
    let tm = tool_msgs(&t);
    let order: Vec<&str> = tm.iter().map(|m| m["call"].as_str().unwrap()).collect();
    assert_eq!(order, ["c2", "c1"], "c2 finished first");
    assert!(tm.iter().all(|m| m["status"] == "ok" && m["ms"].is_u64()));
    let prompts = seen.lock().unwrap().clone();
    assert_eq!(prompts.len(), 4);
    assert!(prompts[1].contains("# RUNNING\nc1 clock.wait running"), "{}", prompts[1]);
    assert!(prompts[2].contains("# RUNNING\nc1 clock.wait running") && prompts[2].contains("[tool c2 clock.now ok]"), "{}", prompts[2]);
    assert!(!prompts[3].contains("# RUNNING") && prompts[3].contains("[tool c1 clock.wait ok]"));
    assert!(took >= Duration::from_millis(1000) && took < Duration::from_millis(2500), "{took:?}");
    assert!(run::running(h.read(|rt| rt.obj("e/loop").cloned()).unwrap().as_ref().unwrap()).is_empty());
    assert!(h.live_calls().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn await_any_steps_on_the_first_result_and_cancel_aborts_the_rest() {
    let (h, seen) = scripted("any", "", &["calls[2]{id,tool,args}:\n  c1,clock.wait,{\"ms\":3000}\n  c2,clock.wait,{\"ms\":50}\nawait: any", "thought: enough\ncancel: c1\nanswer: c2 was enough"]);
    let t0 = Instant::now();
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert!(t0.elapsed() < Duration::from_millis(1500), "did not wait for c1: {:?}", t0.elapsed());
    assert_eq!(t["state"]["last_answer"], "c2 was enough");
    let tm = tool_msgs(&t);
    let st: Vec<(&str, &str)> = tm.iter().map(|m| (m["call"].as_str().unwrap(), m["status"].as_str().unwrap())).collect();
    assert_eq!(st, [("c2", "ok"), ("c1", "cancelled")]);
    assert!(seen.lock().unwrap()[1].contains("c1 clock.wait running"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_call_past_its_timeout_is_timed_out() {
    let (h, _) = scripted("timeout", "", &["calls[1]{id,tool,args}:\n  c1,test.slow,{}\n", "answer: ok"]);
    let t0 = Instant::now();
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert!(t0.elapsed() < Duration::from_millis(1500));
    let m = &tool_msgs(&t)[0];
    assert_eq!((m["status"].as_str(), m["ok"].as_bool()), (Some("timed_out"), Some(false)));
    assert!(m["text"].as_str().unwrap().contains("timed out after 100 ms"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_answer_waits_for_running_calls_then_ends_the_run() {
    let (h, seen) = scripted("held", "", &["calls[1]{id,tool,args}:\n  c1,clock.wait,{\"ms\":400}\nanswer: done once c1 is"]);
    let t0 = Instant::now();
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    let mid = twin(&h, "e/loop");
    assert_eq!(mid["state"]["pending_answer"], "done once c1 is", "held while c1 runs");
    assert!(mid["views"]["medium"].to_string().contains("c1 clock.wait · running"), "the running call is shown");
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert!(t0.elapsed() >= Duration::from_millis(400));
    assert_eq!(t["state"]["last_answer"], "done once c1 is");
    assert!(t["state"]["pending_answer"].is_null());
    assert_eq!(tool_msgs(&t)[0]["status"], "ok");
    assert_eq!(seen.lock().unwrap().len(), 1, "no further step");
    assert!(t["views"]["large"].to_string().contains("tool c1 clock.wait · ok"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn r5_max_running_and_reused_ids_fail_with_a_clear_message() {
    let (h, _) = scripted(
        "cap",
        "config: {max_running: 2}\n",
        &["calls[4]{id,tool,args}:\n  c1,clock.wait,{\"ms\":100}\n  c2,clock.wait,{\"ms\":100}\n  c3,clock.wait,{\"ms\":100}\n  c1,clock.now,{}\n", "calls[1]:\n  test.owner,{}\n", "answer: ok"],
    );
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    let tm = tool_msgs(&t);
    let find = |c: &str, tool: &str| tm.iter().find(|m| m["call"] == c && m["tool"] == tool).unwrap_or_else(|| panic!("{c} {tool}: {tm:?}")).clone();
    assert!(find("c3", "clock.wait")["text"].as_str().unwrap().contains("max_running 2"));
    // R5: a reused id is refused with a format note
    assert!(t["state"]["messages"].as_array().unwrap().iter().any(|m| m["role"] == "format" && m["text"].as_str().unwrap().contains("call id c1 is already used")));
    assert_eq!(find("c1", "clock.wait")["status"], "ok");
    // an auto id skips the used ones; an owner-only tool is not offered
    let owner = find("c4", "test.owner");
    assert_eq!(owner["status"], "failed");
    assert!(owner["text"].as_str().unwrap().contains("not offered"));
    assert_eq!(t["state"]["last_answer"], "ok");
}

// ── callbacks: no task waits on tools ──────────────────────────────────────

fn lp(h: &Hub) -> Obj {
    h.read(|rt| rt.obj("e/loop").cloned()).unwrap().unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn while_calls_run_no_task_is_alive_and_the_completion_wakes_the_next_step() {
    let (h, seen) = scripted("idle-wait", "", &["calls[2]{id,tool,args}:\n  c1,clock.wait,{\"ms\":300}\n  c2,clock.now,{}\n", "answer: done"]);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    let mid = twin(&h, "e/loop");
    assert_eq!(mid["phase"], "waiting");
    assert!(h.running().is_empty(), "no step task while c1 runs: {:?}", h.running());
    assert_eq!(h.live_calls(), [("e/loop".to_string(), vec!["c1".to_string()])]);
    assert_eq!(mid["state"]["calls"]["c1"]["status"], "running");
    assert_eq!(mid["state"]["calls"]["c2"]["status"], "ok");
    assert_eq!(mid["state"]["waiting"]["on"], "all");
    assert_eq!(mid["status"]["now"], "step 1 · waiting on c1");
    assert!(mid["views"]["medium"].to_string().contains("waiting on c1"));
    assert!(mid["views"]["medium"].to_string().contains("c2 clock.now · ok"));
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["state"]["last_answer"], "done");
    assert_eq!(seen.lock().unwrap().len(), 2);
    assert!(t["state"]["waiting"].is_null());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn r1_two_calls_finishing_together_take_exactly_one_next_step() {
    for wait in ["all", "any"] {
        let first = format!("calls[3]{{id,tool,args}}:\n  c1,clock.now,{{}}\n  c2,clock.now,{{}}\n  c3,clock.now,{{}}\nawait: {wait}");
        let (h, seen) = scripted("together", "", &[&first, "answer: one"]);
        h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
        let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
        tokio::time::sleep(Duration::from_millis(100)).await; // any held wake has been delivered
        assert_eq!(t["state"]["last_answer"], "one", "{wait}");
        assert_eq!(seen.lock().unwrap().len(), 2, "{wait}: exactly one next step");
        assert_eq!(twin(&h, "e/loop")["state"]["step"], 2);
        assert!(h.running().is_empty());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn await_ids_waits_only_for_the_listed_calls() {
    let (h, seen) = scripted("ids", "", &["calls[2]{id,tool,args}:\n  a,clock.wait,{\"ms\":1500}\n  b,clock.wait,{\"ms\":50}\nawait: b", "cancel: a\nanswer: b done"]);
    let t0 = Instant::now();
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert!(t0.elapsed() < Duration::from_millis(1000));
    assert_eq!(t["state"]["last_answer"], "b done");
    assert_eq!(t["state"]["calls"]["a"]["status"], "cancelled");
    assert_eq!(seen.lock().unwrap().len(), 2);
    assert!(h.live_calls().is_empty(), "{:?}", h.live_calls());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn o1_owner_cancel_while_waiting_aborts_the_calls() {
    let (h, _) = scripted("cancel", "", &["calls[1]{id,tool,args}:\n  c1,test.hang,{}\n"]);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(twin(&h, "e/loop")["phase"], "waiting");
    let out = h.act("e/loop", "cancel", &json!({})).await.unwrap();
    assert_eq!(out["phase"], "stopped");
    let t = twin(&h, "e/loop");
    assert_eq!(t["state"]["calls"]["c1"]["status"], "cancelled");
    assert_eq!(tool_msgs(&t)[0]["status"], "cancelled");
    assert!(h.live_calls().is_empty() && h.running().is_empty());
    assert!(t["state"]["waiting"].is_null());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn engine_stop_aborts_the_calls_of_a_waiting_loop() {
    let (h, _) = scripted("stop", "", &["calls[1]{id,tool,args}:\n  c1,test.hang,{}\n"]);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    let _ = h.act("e", "stop", &json!({})).await;
    let t = twin(&h, "e/loop");
    assert_eq!(t["phase"], "stopped");
    assert_eq!(t["state"]["calls"]["c1"]["status"], "cancelled");
    assert!(h.live_calls().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn o5_shutdown_records_running_calls_interrupted() {
    let dir = temp("shut");
    let (h, _) = scripted_in(&dir, "", &["calls[1]{id,tool,args}:\n  c1,test.hang,{}\n"], true);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    h.shutdown().await.unwrap();
    let saved: Value = serde_json::from_str(&fs::read_to_string(dir.join("state/e/loop.json")).unwrap()).unwrap();
    assert_eq!(saved["phase"], "stopped");
    assert_eq!(saved["state"]["calls"]["c1"]["status"], "interrupted");
    // a clean restart does not wake it
    let (h2, seen) = scripted_in(&dir, "", &["answer: no"], false);
    h2.resume().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(twin(&h2, "e/loop")["phase"], "stopped");
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn o3_a_restart_after_a_crash_interrupts_running_calls_and_wakes_once() {
    let dir = temp("crash");
    let (h, _) = scripted_in(&dir, "", &["calls[2]{id,tool,args}:\n  c1,test.hang,{}\n  c2,test.hang,{}\n"], true);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(run::running_ids(&lp(&h)), ["c1", "c2"]);
    // the process "dies": the lock stays, a second app boots on the same folder
    let (h2, seen) = scripted_in(&dir, "", &["answer: saw the failures"], false);
    let t = twin(&h2, "e/loop");
    assert_eq!(t["phase"], "waiting");
    let tm = tool_msgs(&t);
    assert_eq!(tm.len(), 2);
    assert!(tm.iter().all(|m| m["status"] == "interrupted" && m["ok"] == false));
    h2.resume().await;
    let t = until_done(&h2, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["state"]["last_answer"], "saw the failures");
    let prompts = seen.lock().unwrap().clone();
    assert_eq!(prompts.len(), 1, "woken once");
    assert!(prompts[0].contains("[tool c1 test.hang interrupted]"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn o4_max_steps_cancels_running_calls() {
    let (h, seen) = scripted("o4", "config: {max_steps: 1}\n", &["calls[1]{id,tool,args}:\n  c1,test.hang,{}\nawait: none"]);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(seen.lock().unwrap().len(), 1, "no more model steps");
    assert!(t["state"]["stop_reason"].as_str().unwrap().contains("max_steps (1)"));
    assert_eq!(t["state"]["calls"]["c1"]["status"], "cancelled");
    assert!(h.live_calls().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn o2_new_input_wakes_at_once_and_supersedes_a_pending_answer() {
    let (h, seen) = scripted("o2", "", &["calls[1]{id,tool,args}:\n  c1,test.hang,{}\nanswer: old", "cancel: c1\nanswer: new"]);
    h.act("e/loop", "run", &json!({"input": "first"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(twin(&h, "e/loop")["state"]["pending_answer"], "old");
    h.act("e/loop", "run", &json!({"input": "second"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["state"]["last_answer"], "new");
    let prompts = seen.lock().unwrap().clone();
    assert_eq!(prompts.len(), 2);
    assert!(prompts[1].contains("# INPUT\nsecond") && prompts[1].contains("c1 test.hang running"), "{}", prompts[1]);
    assert!(t["state"]["messages"].as_array().unwrap().iter().any(|m| m["role"] == "superseded" && m["text"] == "old"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p1_p4_p5_a_phase_change_wakes_the_loop_and_running_calls_finish_tagged() {
    let dir = temp("p1");
    put(&dir, "engines/e/engine.md", &md("E", "engine", ""));
    put(&dir, "engines/e/elements/model.md", &md("Model", "model", "order: 1\nconfig: {connector: script, id: s}\n"));
    put(&dir, "engines/e/elements/loop.md", &md("Loop", "loop", "order: 2\n"));
    put(&dir, "engines/e/elements/phases.md", &md("Phases", "phases", "order: 3\nconfig: {list: [{id: a, tools: [clock.wait]}, {id: b, tools: []}]}\n"));
    let h = Hub::new(boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap());
    let seen = Arc::new(Mutex::new(vec![]));
    let replies = ["calls[1]{id,tool,args}:\n  c1,clock.wait,{\"ms\":400}\n", "thought: phase b, nothing to call\nawait: all", "answer: done"];
    h.add_connector("script", Arc::new(Script { replies: Mutex::new(replies.iter().map(|s| s.to_string()).collect()), seen: seen.clone() }));
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(twin(&h, "e/loop")["phase"], "waiting");
    // P4: you switch the phase while the loop waits → it wakes (step 2 renders phase b)
    h.act("e/phases", "set", &json!({"phase": "b"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["state"]["last_answer"], "done", "{}", t["state"]);
    let prompts = seen.lock().unwrap().clone();
    assert_eq!(prompts.len(), 3);
    // P5: the new phase offers no tools; the running call still shows and its result arrives
    assert!(prompts[1].contains("# PHASE b") && prompts[1].contains("No tools.") && prompts[1].contains("c1 clock.wait running"), "{}", prompts[1]);
    // P1: the call finished, tagged with the phase it started in
    let m = &tool_msgs(&t)[0];
    assert_eq!((m["status"].as_str(), m["phase"].as_str()), (Some("ok"), Some("a")));
    assert!(prompts[2].contains("[tool c1 clock.wait ok (started in phase a)]"), "{}", prompts[2]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn r3_a_result_after_the_run_ended_is_late_and_wakes_nothing() {
    let (h, seen) = scripted("r3", "", &["answer: first", "calls[0]:\nawait: none"]);
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    until_done(&h, "e/loop", Duration::from_secs(5)).await;
    // a call of an earlier run reports after the run ended (its entry is gone from state.calls)
    let tc = tools::ToolCtx { hub: h.clone(), engine: "e".into(), loop_id: "e/loop".into(), call: "c9".into() };
    let fut = run::call_future_for_test(h.clone(), tc, tools::find("clock.now").unwrap(), json!({}));
    h.spawn_call("e/loop", "c9", fut);
    tokio::time::sleep(Duration::from_millis(150)).await;
    let t = twin(&h, "e/loop");
    assert_eq!(t["phase"], "idle");
    let late: Vec<Value> = tool_msgs(&t).into_iter().filter(|m| m["late"] == true).collect();
    assert_eq!(late.len(), 1);
    assert_eq!(seen.lock().unwrap().len(), 1, "no wake");
}
