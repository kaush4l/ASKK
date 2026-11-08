//! Phases as modes and workflows: a phase the owner picks and stays in is a mode (only its tools and instructions
//! change); phases chained by exit/next are a workflow. One `phases` kind for both.

use super::*;
use crate::{run, seed};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-phase-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
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
const MODES: &str = "[{id: chat, title: Chat, icon: \"💬\", tools: [], instructions: \"Talk plainly.\"}, {id: research, title: Research, icon: \"🔎\", tools: [files.read, clock.now, help.ask], instructions: \"Look things up before answering.\"}, {id: build, title: Build, icon: \"🛠️\", tools: [note.write, files.read, clock.now], instructions: \"Write it into the note.\"}]";
/// Engine `e`: echo model, loop, a note, and phases `list` (no tools element: the phases offer the tools).
fn engine(dir: &Path, list: &str) {
    put(dir, "engines/e/engine.md", &(md("E", "engine", "") + "You test things."));
    put(dir, "engines/e/elements/model.md", &md("Model", "model", "order: 1\nconfig: {connector: echo, id: echo, context: 12000}\n"));
    put(dir, "engines/e/elements/loop.md", &md("Loop", "loop", "order: 2\n"));
    put(dir, "engines/e/elements/note.md", &(md("Note", "note", "order: 3\n") + "start"));
    put(dir, "engines/e/elements/phases.md", &md("Phases", "phases", &format!("order: 4\nconfig: {{list: {list}}}\n")));
}
fn start(dir: &Path) -> Runtime {
    boot(Box::new(FolderStore::open(dir).unwrap())).unwrap()
}
fn prompt(rt: &Runtime) -> String {
    run::render(rt.engine_node("e").unwrap(), rt.obj("e/loop").unwrap())
}
fn texts(v: &Value) -> String {
    v.to_string()
}

#[test]
fn a_phase_carries_title_icon_tools_instructions() {
    let dir = temp("parse");
    engine(&dir, "[{id: a, title: Alpha, icon: \"🅰️\", tools: [clock.now], instructions: \"Do A.\"}, b]");
    let rt = start(&dir);
    let defs = run::phase_defs(rt.obj("e/phases").unwrap());
    assert_eq!(defs[0].title.as_deref(), Some("Alpha"));
    assert_eq!(defs[0].icon.as_deref(), Some("🅰️"));
    assert_eq!(defs[0].tools, Some(vec!["clock.now".to_string()]));
    assert_eq!(defs[0].instructions.as_deref(), Some("Do A."));
    assert_eq!(defs[0].label(), "🅰️ Alpha");
    assert_eq!(defs[1].label(), "b");
}

#[test]
fn a_phase_switch_changes_the_offered_tools_and_the_prompt_section_exactly() {
    let dir = temp("switch");
    engine(&dir, MODES);
    let mut rt = start(&dir);
    assert!(run::offered(rt.engine_node("e").unwrap()).is_empty(), "chat: no tools");
    let p = prompt(&rt);
    assert!(p.contains("\n# PHASE chat\nTalk plainly.\n"), "{p}");
    assert!(p.contains("# TOOLS\nNo tools.\n"));
    assert!(texts(&rt.twin("e").unwrap()["views"]["medium"]).contains("No tools"));
    rt.act("e/phases", "set", &json!({"phase": "research"})).unwrap();
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["files.read", "clock.now", "help.ask"]);
    let p = prompt(&rt);
    assert!(p.contains("\n# PHASE research\nLook things up before answering.\n"));
    assert!(!p.contains("Talk plainly."));
    assert!(p.contains("- files.read") && !p.contains("- note.write"));
    // the switch is a message of the loop's history; model, loop and memory untouched
    let msgs = rt.twin("e/loop").unwrap()["state"]["messages"].clone();
    let last = msgs.as_array().unwrap().last().unwrap().clone();
    assert_eq!((last["role"].as_str(), last["phase"].as_str(), last["by"].as_str()), (Some("phase"), Some("research"), Some("owner")));
    assert!(last["text"].as_str().unwrap().contains("🔎 Research"));
    assert!(prompt(&rt).contains("[phase] phase → 🔎 Research"));
    assert!(rt.twin("e").unwrap()["status"]["now"].as_str().unwrap().starts_with("🔎 Research"), "the status line names the phase");
    // unknown refused; the same phase again records nothing; it survives a restart
    assert!(rt.act("e/phases", "set", &json!({"phase": "nope"})).is_err());
    rt.act("e/phases", "set", &json!({"phase": "research"})).unwrap();
    assert_eq!(rt.twin("e/loop").unwrap()["state"]["messages"].as_array().unwrap().len(), msgs.as_array().unwrap().len());
    rt.shutdown().unwrap();
    let rt = start(&dir);
    assert_eq!(rt.twin("e/phases").unwrap()["state"]["current"], "research");
}

#[test]
fn with_a_tools_element_the_phase_narrows_its_list() {
    let dir = temp("narrow");
    engine(&dir, MODES);
    put(&dir, "engines/e/elements/tools.md", &md("Tools", "tools", "order: 5\nconfig: {list: [clock.now, clock.wait, files.read]}\n"));
    let mut rt = start(&dir);
    rt.act("e/phases", "set", &json!({"phase": "research"})).unwrap();
    // phase {files.read, clock.now, help.ask} ∩ tools {clock.now, clock.wait, files.read}, in the list's order
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["clock.now", "files.read"]);
}

#[test]
fn an_engine_without_phases_behaves_as_before() {
    let dir = temp("none");
    put(&dir, "engines/e/engine.md", &md("E", "engine", ""));
    put(&dir, "engines/e/elements/loop.md", &md("Loop", "loop", ""));
    put(&dir, "engines/e/elements/tools.md", &md("Tools", "tools", "config: {list: [clock.wait, help.ask]}\n"));
    let rt = start(&dir);
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["clock.wait", "help.ask"]);
    assert!(!run::render(rt.engine_node("e").unwrap(), rt.obj("e/loop").unwrap()).contains("# PHASE"));
}

#[test]
fn a_broken_phases_file_fails_alone_and_the_engine_offers_nothing() {
    let dir = temp("broken");
    engine(&dir, MODES);
    let mut rt = start(&dir);
    put(&dir, "engines/e/elements/phases.md", "---\ntitle: [unclosed\n");
    rt.reload().unwrap();
    assert_eq!(rt.twin("e/phases").unwrap()["phase"], "failed");
    assert!(run::offered(rt.engine_node("e").unwrap()).is_empty());
    assert_eq!(rt.twin("e/loop").unwrap()["phase"], "idle", "the rest keeps working");
    engine(&dir, MODES);
    rt.reload().unwrap();
    assert_eq!(rt.twin("e/phases").unwrap()["phase"], "idle");
}

#[test]
fn phases_hot_reload() {
    let dir = temp("hot");
    engine(&dir, MODES);
    let mut rt = start(&dir);
    rt.act("e/phases", "set", &json!({"phase": "research"})).unwrap();
    engine(&dir, &MODES.replace("tools: [files.read, clock.now, help.ask], instructions: \"Look things up before answering.\"", "tools: [clock.now], instructions: \"Only the clock.\""));
    assert!(rt.reload().unwrap().changed);
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["clock.now"]);
    assert!(prompt(&rt).contains("# PHASE research\nOnly the clock.\n"));
    assert!(!rt.reload().unwrap().changed, "idempotent");
}

#[test]
fn the_seed_is_one_top_engine_with_three_phases() {
    let dir = temp("seed");
    let rt = start(&dir);
    let engines = rt.engines();
    assert_eq!(engines.len(), 1);
    assert_eq!((engines[0].twin.id.as_str(), engines[0].twin.title.as_str()), ("askk", "Askk"));
    let kinds: Vec<&str> = engines[0].elements.iter().map(|x| x.kind.as_str()).collect();
    assert_eq!(kinds, ["model", "loop", "phases", "workflows", "memory", "note"]);
    let defs = run::phase_defs(rt.obj("askk/phases").unwrap());
    let got: Vec<(String, Option<Vec<String>>)> = defs.iter().map(|d| (d.id.clone(), d.tools.clone())).collect();
    let v = |a: &[&str]| Some(a.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    assert_eq!(got, [("chat".into(), v(&[])), ("research".into(), v(&["files.read", "clock.now", "help.ask"])), ("build".into(), v(&["note.write", "files.read", "clock.now"]))]);
    assert!(defs.iter().all(|d| d.icon.is_some() && d.instructions.is_some()));
    assert_eq!(crate::kinds::workflows::workflow_defs(rt.obj("askk/workflows").unwrap())[0].phases, ["research", "build"]);
    assert_eq!(rt.twin("askk/phases").unwrap()["state"]["current"], "chat");
    assert!(texts(&rt.twin("askk").unwrap()["views"]["medium"]).contains("No tools"));
    assert!(seed::FILES.iter().all(|(p, _)| !p.contains("modes/")));
}

async fn idle(h: &Hub, id: &str) -> Value {
    let t0 = Instant::now();
    loop {
        let t = h.read(|rt| rt.twin(id)).unwrap().unwrap();
        if !matches!(t["phase"].as_str(), Some("running" | "waiting")) {
            return t;
        }
        assert!(t0.elapsed() < Duration::from_secs(5), "{id} still running");
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
}
fn workflows(dir: &Path, list: &str) {
    put(dir, "engines/e/elements/workflows.md", &md("Workflows", "workflows", &format!("order: 6\nconfig: {{list: {list}}}\n")));
}

#[tokio::test]
async fn a_workflow_runs_its_phases_in_order_hands_answers_on_and_returns_to_the_mode() {
    let dir = temp("wf");
    engine(&dir, MODES);
    workflows(&dir, "[{id: study, phases: [research, build]}]");
    let h = Hub::new(start(&dir));
    h.act("e/phases", "set", &json!({"phase": "chat"})).await.unwrap();
    h.act("e/workflows", "run", &json!({"workflow": "study", "input": "topic"})).await.unwrap();
    let w = idle(&h, "e/workflows").await;
    assert_eq!(w["phase"], "idle", "{}", w["state"]);
    let last = &w["state"]["last"];
    assert_eq!(last["steps"].as_array().unwrap().iter().map(|s| s["phase"].as_str().unwrap()).collect::<Vec<_>>(), ["research", "build"], "in order");
    // research's answer is build's input; build wrote the note with its own tool
    let research = last["steps"][0]["answer"].as_str().unwrap().to_string();
    assert!(research.starts_with("echo: topic"));
    assert_eq!(last["answer"].as_str().unwrap(), format!("echo: {research} (after 2 tool result(s))").replace("echo: echo", "echo: echo"));
    assert_eq!(h.read(|rt| rt.twin("e/note")).unwrap().unwrap()["state"]["text"], format!("echo saw: {research}"));
    // history: the switches and both inputs, in order; each step's prompt was its phase's
    let msgs = h.read(|rt| rt.twin("e/loop")).unwrap().unwrap()["state"]["messages"].as_array().unwrap().clone();
    let seq: Vec<String> = msgs.iter().filter(|m| m["role"] == "phase" || m["role"] == "input").map(|m| format!("{}:{}", m["role"].as_str().unwrap(), m["phase"].as_str().or(m["text"].as_str()).unwrap())).collect();
    assert_eq!(seq, ["phase:research", "input:topic", "phase:build", format!("input:{research}").as_str(), "phase:chat"]);
    let tools: Vec<&str> = msgs.iter().filter(|m| m["role"] == "tool").map(|m| m["tool"].as_str().unwrap()).collect();
    assert!(tools.contains(&"clock.now") && tools.contains(&"note.write"));
    // back in the mode selected before
    for _ in 0..50 {
        if h.read(|rt| rt.twin("e/phases")).unwrap().unwrap()["state"]["current"] == "chat" { break; }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(h.read(|rt| rt.twin("e/phases")).unwrap().unwrap()["state"]["current"], "chat");
    // unknown workflow and a workflow naming no phase of the engine are refused / fail
    assert!(h.act("e/workflows", "run", &json!({"workflow": "nope", "input": "x"})).await.is_err());
}

#[tokio::test]
async fn a_workflow_naming_an_unknown_phase_fails_before_running() {
    let dir = temp("wfbad");
    engine(&dir, MODES);
    workflows(&dir, "[{id: odd, phases: [research, ghost]}]");
    let h = Hub::new(start(&dir));
    h.act("e/workflows", "run", &json!({"workflow": "odd", "input": "x"})).await.unwrap();
    let w = idle(&h, "e/workflows").await;
    assert_eq!(w["phase"], "failed");
    assert!(w["state"]["error"].as_str().unwrap().contains("ghost"));
    assert_eq!(h.read(|rt| rt.twin("e/loop")).unwrap().unwrap()["state"]["step"], 0, "nothing ran");
}

#[tokio::test]
async fn cancel_mid_workflow_stops_the_loop_and_returns_to_the_mode() {
    let dir = temp("wfcancel");
    engine(&dir, "[{id: chat, tools: []}, {id: slow, tools: [clock.wait]}, {id: after, tools: []}]");
    workflows(&dir, "[{id: w, phases: [slow, after]}]");
    let h = Hub::new(start(&dir));
    h.act("e/workflows", "run", &json!({"workflow": "w", "input": "wait please"})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(120)).await;
    let w = h.read(|rt| rt.twin("e/workflows")).unwrap().unwrap();
    assert_eq!(w["status"]["now"], "workflow slow→after · 1/2");
    h.act("e/workflows", "cancel", &json!({})).await.unwrap();
    assert_eq!(idle(&h, "e/workflows").await["phase"], "stopped");
    let lp = idle(&h, "e/loop").await;
    assert!(matches!(lp["phase"].as_str(), Some("stopped" | "idle")));
    for _ in 0..50 {
        if h.read(|rt| rt.twin("e/phases")).unwrap().unwrap()["state"]["current"] == "chat" { break; }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(h.read(|rt| rt.twin("e/phases")).unwrap().unwrap()["state"]["current"], "chat", "the mode before");
    let msgs = lp["state"]["messages"].as_array().unwrap().clone();
    assert!(!msgs.iter().any(|m| m["role"] == "input" && m["text"] != "wait please"), "the second step never ran");
}

#[test]
fn the_page_trees_name_a_default_engine_and_carry_the_composer() {
    for v in VIEWS {
        let t = default_ui(v);
        assert_eq!(t["props"]["default"], "askk", "{v}");
        let kids = t["children"].as_array().unwrap();
        let c = kids.iter().find(|k| k["c"] == "Composer").unwrap_or_else(|| panic!("{v} has no Composer"));
        assert_eq!(c["props"]["phases"], true);
        check_tree(&t).unwrap();
    }
    assert!(check_tree(&json!({"c": "Composer", "props": {"phases": "yes"}})).is_err());
    assert!(check_tree(&json!({"c": "Composer", "props": {"target": "askk", "placeholder": "Say…", "phases": false}})).is_ok());
}
