//! Engine vocabulary: config state, model/loop/phases/tools/memory kinds, the TOON reply format,
//! parallel tool calls, refocus, help.ask, secrets, and the vocabulary itself.

use super::*;
use crate::{connector::*, run, toon};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-eng-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
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
async fn until_done(h: &Hub, id: &str, limit: Duration) -> Value {
    let t0 = Instant::now();
    loop {
        let t = twin(h, id);
        if !matches!(t["phase"].as_str(), Some("running" | "waiting")) {
            return t;
        }
        assert!(t0.elapsed() < limit, "{id} still running after {limit:?}: {}", t["state"]);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
fn texts(v: &Value) -> String {
    v.to_string()
}
/// An engine `e` with an echo model (context chars), a loop, and the given extra elements.
fn engine(dir: &Path, context: usize, tools: Option<&str>) {
    put(dir, "engines/e/engine.md", &(md("E", "engine", "") + "You test things."));
    put(dir, "engines/e/elements/model.md", &md("Model", "model", &format!("order: 1\nconfig: {{connector: echo, id: echo, context: {context}}}\n")));
    put(dir, "engines/e/elements/loop.md", &md("Loop", "loop", "order: 2\n"));
    put(dir, "engines/e/elements/memory.md", &md("Memory", "memory", "order: 3\n"));
    put(dir, "engines/e/elements/note.md", &(md("Note", "note", "order: 4\n") + "start"));
    if let Some(t) = tools {
        put(dir, "engines/e/elements/tools.md", &md("Tools", "tools", &format!("order: 5\nconfig: {{list: [{t}]}}\n")));
    }
}

// ── 1. config carries state ────────────────────────────────────────────────

#[test]
fn config_state_is_the_initial_state_and_saved_state_wins() {
    let dir = temp("cfgstate");
    put(&dir, "engines/e/engine.md", &md("E", "engine", "state: {mood: calm}\nphase: stopped\n"));
    put(&dir, "engines/e/elements/c.md", &md("C", "counter", "state: {value: 41}\nphase: waiting\n"));
    put(&dir, "engines/e/elements/m.md", &md("Mem", "memory", "state: {lessons: [seeded]}\n"));
    let mut rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let w = rt.twin("e/c").unwrap();
    assert_eq!(w["state"]["value"], 41, "config state is the initial state");
    assert_eq!(w["phase"], "waiting");
    assert_eq!(rt.twin("e").unwrap()["state"]["mood"], "calm");
    assert_eq!(rt.twin("e").unwrap()["phase"], "stopped");
    assert_eq!(rt.twin("e/m").unwrap()["state"]["lessons"], json!(["seeded"]));
    rt.act("e/c", "inc", &json!({})).unwrap();
    rt.shutdown().unwrap();
    // saved state wins over the file's state on the next boot
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    assert_eq!(rt.twin("e/c").unwrap()["state"]["value"], 42);
    rt.shutdown().unwrap();
    // a configured `running` has no task behind it: refused, the file fails to load
    put(&dir, "engines/e/elements/r.md", &md("R", "counter", "phase: running\n"));
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let r = rt.twin("e/r").unwrap();
    assert_eq!(r["phase"], "failed");
    assert!(r["state"]["error"].as_str().unwrap().contains("running"));
}

// ── 2. no tools ────────────────────────────────────────────────────────────

#[test]
fn an_engine_without_tools_says_no_tools_and_offers_none() {
    for (name, tools) in [("none", None), ("empty", Some(""))] {
        let dir = temp(name);
        engine(&dir, 12000, tools);
        let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
        let e = rt.twin("e").unwrap();
        assert!(texts(&e["views"]["medium"]).contains("No tools"), "{name}: engine card");
        assert!(e["prompt"].as_str().unwrap().contains("No tools."));
        let l = rt.twin("e/loop").unwrap();
        assert!(texts(&l["views"]["medium"]).contains("No tools"), "{name}: loop card");
        let full = texts(&l["views"]["medium"]);
        assert!(full.contains("No tools.") && !full.contains("calls[N]"), "{name}: the prompt offers no tools nor calls");
        let node = rt.engine_node("e").unwrap();
        assert!(run::offered(node).is_empty());
        if tools.is_some() {
            assert!(texts(&rt.twin("e/tools").unwrap()["views"]["medium"]).contains("No tools"));
        }
    }
}

#[test]
fn the_seed_chat_phase_shows_no_tools_and_build_offers_them() {
    let dir = temp("seedtools");
    let mut rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    assert!(texts(&rt.twin("askk").unwrap()["views"]["medium"]).contains("No tools"));
    rt.act("askk/phases", "set", &json!({"phase": "build"})).unwrap();
    assert!(!texts(&rt.twin("askk").unwrap()["views"]["medium"]).contains("No tools"));
    assert_eq!(run::offered(rt.engine_node("askk").unwrap()), ["note.write", "files.read", "clock.now"]);
}

// ── phases narrow tools ────────────────────────────────────────────────────

#[test]
fn the_current_phase_narrows_the_tools_offered() {
    let dir = temp("phases");
    engine(&dir, 12000, Some("clock.now, note.write, help.ask"));
    put(&dir, "engines/e/elements/phases.md", &md("Phases", "phases", "config: {list: [{id: look, tools: [clock.now]}, {id: write, tools: [note.write, files.read]}, {id: free}]}\n"));
    let mut rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["clock.now"]);
    let p = run::render(rt.engine_node("e").unwrap(), rt.obj("e/loop").unwrap());
    assert!(p.contains("# PHASE look") && p.contains("- clock.now") && !p.contains("note.write"));
    rt.act("e/phases", "next", &json!({})).unwrap();
    // files.read is in the phase but not in the tools list: not offered
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["note.write"]);
    rt.act("e/phases", "set", &json!({"phase": "free"})).unwrap();
    assert_eq!(run::offered(rt.engine_node("e").unwrap()), ["clock.now", "note.write", "help.ask"]);
    assert!(rt.act("e/phases", "next", &json!({})).is_err(), "free is the last phase");
    assert!(rt.act("e/phases", "set", &json!({"phase": "nope"})).is_err());
}

// ── TOON + JSON ────────────────────────────────────────────────────────────

#[test]
fn toon_and_json_replies_parse() {
    let r = toon::parse("thought: look first\ncalls[2]{tool,args}:\n  clock.now,{}\n  note.write,{\"text\":\"a, b\"}\n").unwrap();
    assert_eq!(r.thought.as_deref(), Some("look first"));
    assert_eq!(r.calls.len(), 2);
    assert_eq!(r.calls[1].tool, "note.write");
    assert_eq!(r.calls[1].args, json!({"text": "a, b"}));
    let r = toon::parse("preamble\nthought: done\nanswer: line one\nline two: still the answer").unwrap();
    assert_eq!(r.answer.as_deref(), Some("line one\nline two: still the answer"));
    assert!(r.calls.is_empty());
    // a wrong row count is not TOON
    assert!(toon::parse_toon("calls[2]{tool,args}:\n  clock.now,{}\n").is_err());
    assert!(toon::parse_toon("calls[1]{tool,args}:\n  clock.now,{}\n  clock.now,{}\n").is_err());
    assert!(toon::parse_toon("calls[1]{tool,args}:\n  clock.now,not json\n").is_err());
    // JSON fallback, bare and fenced
    let r = toon::parse(r#"{"thought":"t","calls":[{"tool":"clock.now","args":{}}]}"#).unwrap();
    assert_eq!(r.calls[0].tool, "clock.now");
    let r = toon::parse("Here:\n```json\n{\"answer\": \"42\"}\n```").unwrap();
    assert_eq!(r.answer.as_deref(), Some("42"));
    assert!(toon::parse("just words").is_err());
}

// ── the loop runs ──────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_loop_with_echo_calls_tools_and_answers() {
    let dir = temp("loop");
    engine(&dir, 12000, Some("clock.now, note.write"));
    let h = hub(&dir);
    let t = h.act("e/loop", "run", &json!({"input": "hello"})).await.unwrap();
    assert_eq!(t["phase"], "running", "run returns at once");
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["phase"], "idle", "{}", t["state"]);
    assert_eq!(t["state"]["last_answer"], "echo: hello (after 2 tool result(s))");
    assert_eq!(t["state"]["step"], 2);
    let roles: Vec<&str> = t["state"]["messages"].as_array().unwrap().iter().map(|m| m["role"].as_str().unwrap()).collect();
    assert_eq!(roles, ["input", "model", "tool", "tool", "model"]);
    assert_eq!(twin(&h, "e/note")["state"]["text"], "echo saw: hello", "note.write wrote the engine's note");
    assert_eq!(twin(&h, "e/model")["state"]["calls"], 2);
    // the full view's prompt is exactly what was sent
    let sent = t["state"]["last_sent"].as_str().unwrap();
    assert!(sent.contains("# INPUT\nhello") && sent.contains("- clock.now"));
    assert!(texts(&t["views"]["medium"]).contains("echo: hello"));
    // a second run while idle works; the answer persists across a restart
    h.shutdown().await.unwrap();
    let h = hub(&dir);
    assert_eq!(twin(&h, "e/loop")["state"]["last_answer"], "echo: hello (after 2 tool result(s))");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bare_loop_answers_without_tools() {
    let dir = temp("bare");
    engine(&dir, 12000, None);
    let h = hub(&dir);
    h.act("e/loop", "run", &json!({"input": "hi"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["state"]["last_answer"], "echo: hi");
    assert_eq!(t["state"]["step"], 1);
    assert!(t["state"]["last_sent"].as_str().unwrap().contains("# TOOLS\nNo tools."));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_calls_of_one_reply_run_concurrently() {
    let dir = temp("par");
    engine(&dir, 12000, Some("clock.wait"));
    let h = hub(&dir);
    h.act("e/loop", "run", &json!({"input": "wait twice"})).await.unwrap();
    let t0 = Instant::now();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    let took = t0.elapsed();
    let tools: Vec<&Value> = t["state"]["messages"].as_array().unwrap().iter().filter(|m| m["role"] == "tool").collect();
    assert_eq!(tools.len(), 2);
    assert!(took < Duration::from_millis(560), "two 300 ms waits took {took:?}: they ran one after the other");
    // directly, too
    let tc = tools::ToolCtx { hub: h.clone(), engine: "e".into(), loop_id: "e/loop".into() };
    let calls = vec![toon::Call { tool: "clock.wait".into(), args: json!({"ms": 250}) }; 3];
    let t0 = Instant::now();
    let out = run::run_calls(tc, &["clock.wait".into()], calls).await;
    assert!(t0.elapsed() < Duration::from_millis(500), "{:?}", t0.elapsed());
    assert!(out.iter().all(|m| m["ok"] == true));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_stops_a_loop() {
    let dir = temp("cancel");
    engine(&dir, 12000, Some("clock.wait"));
    let h = hub(&dir);
    h.act("e/loop", "run", &json!({"input": "wait"})).await.unwrap();
    assert!(h.act("e/loop", "run", &json!({"input": "again"})).await.is_err(), "one run at a time");
    let card = twin(&h, "e/loop")["views"]["medium"].to_string();
    assert!(card.contains("\"action\":\"cancel\"") && !card.contains("\"c\":\"Field\""), "running shows Cancel: {card}");
    let t = h.act("e/loop", "cancel", &json!({})).await.unwrap();
    assert_eq!(t["phase"], "stopped");
}

// ── refocus ────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn refocus_folds_history_and_writes_lessons_at_the_threshold() {
    let dir = temp("refocus");
    engine(&dir, 1400, Some("clock.now, note.write"));
    // a long history already there, as a config state
    let mut msgs = vec![];
    for i in 0..12 {
        msgs.push(format!("{{role: model, text: \"thought: step {i} of the long work, with enough words to take room in the prompt\"}}"));
    }
    put(&dir, "engines/e/elements/loop.md", &md("Loop", "loop", &format!("order: 2\nconfig: {{keep: 2, refocus: 0.9}}\nstate: {{messages: [{}]}}\n", msgs.join(", "))));
    let h = hub(&dir);
    let before = run::render(h.read(|rt| rt.engine_node("e").cloned()).unwrap().as_ref().unwrap(), &h.read(|rt| rt.obj("e/loop").cloned()).unwrap().unwrap()).len();
    assert!(before as f64 >= 0.9 * 1400.0, "the history starts over the threshold ({before})");
    h.act("e/loop", "run", &json!({"input": "finish it"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["phase"], "idle", "{}", t["state"]);
    let r = &t["state"]["refocus"];
    assert!(r["count"].as_u64().unwrap() >= 1);
    assert!(r["last"]["after"].as_u64() < r["last"]["before"].as_u64(), "{r}");
    let msgs = t["state"]["messages"].as_array().unwrap();
    assert_eq!(msgs[0]["role"], "refocus");
    assert!(msgs[0]["text"].as_str().unwrap().contains("goal: finish it"));
    assert!(msgs.len() < 13);
    let lessons = twin(&h, "e/memory")["state"]["lessons"].clone();
    assert!(!lessons.as_array().unwrap().is_empty(), "lessons written to memory");
    assert!(texts(&t["views"]["medium"]).contains("refocused"));
    // the next prompt carries the lessons
    assert!(t["state"]["last_sent"].as_str().unwrap().contains("# MEMORY"));
    assert_eq!(t["state"]["last_answer"].as_str().map(|a| a.starts_with("echo: finish it")), Some(true));
}

#[test]
fn a_refocus_reply_parses_and_the_fallback_always_does() {
    let r = run::parse_refocus("goal: g\ndecisions: d\nfacts: f\nopen: o\nlessons[2]:\n  - one\n  - two\n").unwrap();
    assert_eq!(r.lessons, ["one", "two"]);
    assert!(r.essentials.starts_with("goal: g"));
    assert!(run::parse_refocus("nothing").is_none());
    let f = run::fallback_refocus(&[json!({"role": "input", "text": "x"}), json!({"role": "tool", "tool": "clock.now", "ok": false, "text": "boom"})]);
    let r = run::parse_refocus(&f).unwrap();
    assert!(r.lessons.iter().any(|l| l.contains("clock.now failed")));
}

// ── help.ask ───────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn help_ask_goes_to_the_parent_and_a_top_ask_to_the_owner() {
    let dir = temp("ask");
    engine(&dir, 12000, Some("help.ask"));
    put(&dir, "engines/e/engines/kid/engine.md", &md("Kid", "engine", ""));
    put(&dir, "engines/e/engines/kid/elements/model.md", &md("Model", "model", "config: {connector: echo}\n"));
    put(&dir, "engines/e/engines/kid/elements/loop.md", &md("Loop", "loop", ""));
    put(&dir, "engines/e/engines/kid/elements/tools.md", &md("Tools", "tools", "config: {list: [help.ask]}\n"));
    let h = hub(&dir);
    // the child asks: it lands on its parent
    h.act("e/kid/loop", "run", &json!({"input": "ask: which color?"})).await.unwrap();
    until_done(&h, "e/kid/loop", Duration::from_secs(5)).await;
    let e = twin(&h, "e");
    let asks = e["state"]["asks"].as_array().unwrap();
    assert_eq!(asks.len(), 1);
    assert_eq!(asks[0]["from"], "e/kid");
    assert_eq!(asks[0]["to"], "e");
    assert_eq!(asks[0]["status"], "open");
    assert!(texts(&e["views"]["medium"]).contains("which color?"));
    // the question is content: its own wrapping Text, not squeezed into the row's title
    let card = texts(&e["views"]["medium"]);
    assert!(!card.contains(": which color?"), "the ask's text is not in a one-line row title: {card}");
    assert!(card.contains(&format!("\"Ask {}\"", asks[0]["id"].as_str().unwrap())));
    // the top engine asks: it lands on itself, to the owner
    h.act("e/loop", "run", &json!({"input": "ask: may I?"})).await.unwrap();
    until_done(&h, "e/loop", Duration::from_secs(5)).await;
    let e = twin(&h, "e");
    let top = e["state"]["asks"].as_array().unwrap().iter().find(|a| a["to"] == "owner").cloned().unwrap();
    assert_eq!(top["from"], "e");
    assert!(texts(&e["views"]["medium"]).contains("asks you"));
    let field = e["views"]["medium"].to_string();
    assert!(field.contains("\"action\":\"reply\""));
    // the owner replies at either level; the reply reaches the asker's loop
    h.act("e", "reply", &json!({"ask": top["id"], "text": "yes"})).await.unwrap();
    h.act("e", "reply", &json!({"text": "blue"})).await.unwrap();
    let e = twin(&h, "e");
    assert!(e["state"]["asks"].as_array().unwrap().iter().all(|a| a["status"] == "answered"));
    let kid = twin(&h, "e/kid/loop");
    assert!(kid["state"]["messages"].as_array().unwrap().iter().any(|m| m["role"] == "reply" && m["text"] == "blue"));
    let own = twin(&h, "e/loop");
    assert!(own["state"]["messages"].as_array().unwrap().iter().any(|m| m["role"] == "reply" && m["text"] == "yes"));
    assert!(h.act("e", "reply", &json!({"text": "again"})).await.is_err(), "no open ask left");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn files_read_stays_in_the_workspace() {
    let dir = temp("files");
    engine(&dir, 12000, Some("files.read"));
    put(&dir, "workspace/e/a.txt", "inside");
    put(&dir, "secret.txt", "outside");
    let h = hub(&dir);
    let tc = tools::ToolCtx { hub: h.clone(), engine: "e".into(), loop_id: "e/loop".into() };
    let out = run::run_calls(
        tc,
        &["files.read".into()],
        vec![
            toon::Call { tool: "files.read".into(), args: json!({"path": "a.txt"}) },
            toon::Call { tool: "files.read".into(), args: json!({"path": "../../secret.txt"}) },
            toon::Call { tool: "files.read".into(), args: json!({"path": "/etc/hosts"}) },
            toon::Call { tool: "note.write".into(), args: json!({"text": "x"}) },
        ],
    )
    .await;
    assert_eq!(out[0]["ok"], true);
    assert!(out[0]["text"].as_str().unwrap().contains("inside"));
    assert!(out[1..].iter().all(|m| m["ok"] == false), "{out:?}");
    assert!(out[3]["text"].as_str().unwrap().contains("not offered"));
}

// ── model ──────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn model_test_and_secrets_never_leave_the_environment() {
    let canary = "sk-canary-7f3a9e11-never-shown";
    // SAFETY: set once in this test; no other test reads this variable
    unsafe { std::env::set_var("ASKK_TEST_CANARY_KEY", canary) };
    let dir = temp("secret");
    engine(&dir, 12000, Some("clock.now, note.write"));
    put(&dir, "engines/e/elements/model.md", &md("Model", "model", "order: 1\nconfig: {connector: echo, id: echo, context: 12000, key_env: ASKK_TEST_CANARY_KEY}\n"));
    let h = hub(&dir);
    let mut events = h.subscribe();
    h.act("e/model", "test", &json!({})).await.unwrap();
    let m = until_done(&h, "e/model", Duration::from_secs(5)).await;
    assert_eq!(m["state"]["test"]["reply"], "answer: pong");
    assert!(texts(&m["views"]["medium"]).contains("key ASKK_TEST_CANARY_KEY: set"));
    h.act("e/loop", "run", &json!({"input": "go"})).await.unwrap();
    until_done(&h, "e/loop", Duration::from_secs(5)).await;
    let world = h.read(|rt| rt.world()).unwrap().to_string();
    assert!(!world.contains(canary), "the key is in the world");
    while let Ok(ev) = events.try_recv() {
        let s = match ev {
            Event::Twin(_, t) => t.to_string(),
            Event::World(w) => w.to_string(),
        };
        assert!(!s.contains(canary), "the key is in an event");
    }
    h.shutdown().await.unwrap();
    fn walk(p: &Path, canary: &str) {
        for e in fs::read_dir(p).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, canary);
            } else {
                assert!(!fs::read_to_string(&p).unwrap_or_default().contains(canary), "the key is in {}", p.display());
            }
        }
    }
    walk(&dir, canary);
    assert_eq!(ModelSpec::from_config(&serde_json::from_value(json!({"key_env": "ASKK_TEST_CANARY_KEY"})).unwrap()).key().as_deref(), Some(canary));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_loop_without_a_model_fails_naming_it() {
    let dir = temp("nomodel");
    put(&dir, "engines/e/engine.md", &md("E", "engine", ""));
    put(&dir, "engines/e/elements/loop.md", &md("Loop", "loop", ""));
    let h = hub(&dir);
    h.act("e/loop", "run", &json!({"input": "x"})).await.unwrap();
    let t = until_done(&h, "e/loop", Duration::from_secs(5)).await;
    assert_eq!(t["phase"], "failed");
    assert!(t["state"]["error"].as_str().unwrap().contains("no model"));
}

// ── vocabulary ─────────────────────────────────────────────────────────────

#[test]
fn the_word_is_never_used() {
    let word = ["ag", "ent"].concat();
    fn walk(p: &Path, out: &mut Vec<PathBuf>) {
        for e in fs::read_dir(p).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() { walk(&p, out) } else { out.push(p) }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = vec![];
    walk(&root.join("src"), &mut files);
    for f in files {
        let t = fs::read_to_string(&f).unwrap().to_lowercase();
        assert!(!t.contains(&word), "{} uses the word", f.display());
    }
    for (path, text) in seed::FILES.iter() {
        assert!(!text.to_lowercase().contains(&word), "seed {path}");
    }
    let dir = temp("vocab");
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    assert!(!rt.world().to_string().to_lowercase().contains(&word), "the seeded world");
}

// ── view labels ─────────────────────────────────────────────────────────────

#[test]
fn the_model_is_named_once_when_its_id_is_the_connector() {
    let dir = temp("label");
    engine(&dir, 12000, Some("clock.now"));
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let all = [rt.twin("e").unwrap(), rt.twin("e/loop").unwrap(), rt.twin("e/model").unwrap()].map(|t| t["views"].to_string());
    for v in &all {
        assert!(!v.contains("echo echo"), "said twice: {v}");
    }
    assert!(all[0].contains("model: echo") && all[1].contains("model: echo"));
    use crate::connector::ModelSpec;
    let spec = |c: &str, i: &str| ModelSpec::from_config(json!({"connector": c, "id": i}).as_object().unwrap());
    assert_eq!(crate::kinds::model::label(&spec("echo", "")), "echo");
    assert_eq!(crate::kinds::model::label(&spec("claude-cli", "sonnet")), "claude-cli sonnet");
}

#[test]
fn a_loop_card_offers_input_when_idle_and_cancel_when_running() {
    let dir = temp("controls");
    engine(&dir, 12000, None);
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let idle = rt.twin("e/loop").unwrap()["views"]["medium"].to_string();
    assert!(idle.contains("\"c\":\"Field\"") && idle.contains("\"action\":\"run\""), "{idle}");
    assert!(!idle.contains("\"action\":\"cancel\""));
}
