use super::*;
use crate::frontmatter::{Doc, parse, render, value_of};
use crate::node::PRIMITIVES;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = fs::remove_dir_all(&dir);
    dir
}

fn start(dir: &Path) -> Runtime {
    boot(Box::new(FolderStore::open(dir).unwrap())).unwrap()
}

fn put(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

fn md(title: &str, kind: &str, extra: &str) -> String {
    format!("---\ntitle: {title}\nkind: {kind}\n{extra}---\n")
}

/// A data folder with one engine `lab` holding one element of each kind and a child engine.
fn lab(dir: &Path) {
    put(dir, "engines/lab/engine.md", &md("Lab", "engine", "order: 1\n"));
    put(dir, "engines/lab/elements/n.md", &(md("N", "note", "") + "hello"));
    put(dir, "engines/lab/elements/c.md", &md("C", "counter", "config: { step: 5 }\n"));
    put(dir, "engines/lab/elements/s.md", &md("S", "status", ""));
    put(dir, "engines/lab/elements/m.md", &md("M", "meter", "config: {max: 10}\n"));
    put(dir, "engines/lab/engines/kid/engine.md", &md("Kid", "engine", ""));
    put(dir, "engines/lab/engines/kid/elements/x.md", &md("X", "counter", ""));
}

fn element<'a>(e: &'a EngineTwin, id: &str) -> &'a Twin {
    e.elements.iter().find(|t| t.id == id).unwrap_or_else(|| panic!("no {id}"))
}

// ── frontmatter ────────────────────────────────────────────────────────────

#[test]
fn parser_reads_the_subset() {
    let d =
        parse("---\ntitle: Demo engine\nkind: engine\norder: 2\nflag: true\nr: 1.5\ntags: [a, b, 3]\nconfig: { step: 1, name: \"x, y\", inner: {a: [1, 2]} }\nnone:\n# comment\n---\n\nBody *md*\n")
            .unwrap();
    assert_eq!(d.meta["title"], "Demo engine");
    assert_eq!(d.meta["order"], 2);
    assert_eq!(d.meta["flag"], true);
    assert_eq!(d.meta["r"], 1.5);
    assert_eq!(d.meta["tags"], json!(["a", "b", 3]));
    assert_eq!(d.meta["config"], json!({"step": 1, "name": "x, y", "inner": {"a": [1, 2]}}));
    assert_eq!(d.meta["none"], Value::Null);
    assert!(!d.meta.contains_key("# comment"));
    assert_eq!(d.body, "Body *md*");
    assert_eq!(value_of("[]").unwrap(), json!([]));
    assert_eq!(value_of("{}").unwrap(), json!({}));
}

#[test]
fn parser_without_frontmatter_is_all_body_and_errors_are_named() {
    let d = parse("just text").unwrap();
    assert!(d.meta.is_empty());
    assert_eq!(d.body, "just text");
    assert!(parse("---\ntitle: x\n").is_err(), "unclosed");
    assert!(parse("---\nno colon here\n---\n").unwrap_err().to_string().contains("line 2"));
    assert!(parse("---\nx: [a, b\n---\n").is_err());
}

#[test]
fn render_round_trips() {
    let mut d = Doc { body: "text".into(), ..Default::default() };
    for (k, v) in [("title", json!("A: b, c")), ("kind", json!("counter")), ("config", json!({"step": 2, "on": false})), ("tags", json!(["x", 1])), ("n", json!("12"))] {
        d.meta.insert(k.into(), v);
    }
    let text = render(&d);
    assert!(text.starts_with("---\ntitle: "));
    assert_eq!(parse(&text).unwrap(), d);
}

// ── boot ───────────────────────────────────────────────────────────────────

#[test]
fn first_boot_seeds_home_with_a_note_on_disk() {
    let dir = temp("seed");
    let rt = start(&dir);
    assert_eq!(rt.info["boots"], 1);
    assert_eq!(rt.info["last_exit"], "none");
    let engines = rt.engines();
    assert_eq!(engines.len(), 1, "one default engine");
    assert_eq!(engines[0].twin.id, "askk");
    let kinds: Vec<&str> = engines[0].elements.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, ["loop", "phases", "workflows", "memory", "note"]);
    assert_eq!(engines[0].elements[4].id, "askk/welcome");
    assert!(engines.iter().all(|e| e.elements.iter().all(|x| x.phase == Phase::Idle)), "the seed loads clean");
    assert!(dir.join("engines/askk/engine.md").exists());
    assert!(dir.join("engines/askk/elements/welcome.md").exists());
    assert!(dir.join(".lock").exists());
    assert!(dir.join("theme.json").exists());
    // a non-empty folder is not seeded
    let dir2 = temp("noseed");
    lab(&dir2);
    let rt2 = start(&dir2);
    assert!(!dir2.join("engines/askk").exists());
    assert_eq!(rt2.engines()[0].twin.id, "lab");
}

#[test]
fn a_folder_without_engine_md_does_not_count() {
    let dir = temp("stray");
    fs::create_dir_all(dir.join("engines/stray")).unwrap();
    let rt = start(&dir);
    assert_eq!(rt.engines().iter().map(|e| e.twin.id.clone()).collect::<Vec<_>>(), ["askk"]);
}

#[test]
fn boot_nests_and_orders() {
    let dir = temp("nest");
    lab(&dir);
    put(&dir, "engines/alpha/engine.md", &md("Alpha", "engine", ""));
    put(&dir, "engines/zeta/engine.md", &md("Zeta", "engine", "order: 0\n"));
    put(&dir, "engines/lab/engines/kid/engines/deep/engine.md", &md("Deep", "engine", ""));
    put(&dir, "engines/lab/elements/first.md", &md("First", "note", "order: -1\n"));
    let rt = start(&dir);
    let e = rt.engines();
    // order: first, then id
    assert_eq!(e.iter().map(|x| x.twin.id.as_str()).collect::<Vec<_>>(), ["zeta", "lab", "alpha"]);
    let lab = &e[1];
    assert_eq!(lab.elements.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["lab/first", "lab/c", "lab/m", "lab/n", "lab/s"]);
    assert_eq!(lab.children[0].twin.id, "lab/kid");
    assert_eq!(lab.children[0].elements[0].id, "lab/kid/x");
    assert_eq!(lab.children[0].children[0].twin.id, "lab/kid/deep");
    assert_eq!(lab.twin.kind, "engine");
}

#[test]
fn a_broken_md_at_boot_fails_its_object_and_the_app_still_boots() {
    let cases: [(&str, &str, &str, &[&str]); 3] = [
        ("engines/x/elements/bad.md", &md("Bad", "gizmo", ""), "x/bad", &["engines/x/elements/bad.md", "gizmo"]),
        ("engines/x/elements/bad.md", "---\ntitle: B\n---\n", "x/bad", &["engines/x/elements/bad.md"]),
        ("engines/x/engine.md", &md("X", "note", ""), "x", &["engines/x/engine.md"]),
    ];
    for (file, text, id, says) in cases {
        let dir = temp("brokenboot");
        put(&dir, "engines/x/engine.md", &md("X", "engine", ""));
        put(&dir, "engines/x/elements/ok.md", &md("Ok", "counter", ""));
        put(&dir, file, text);
        let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).expect("a broken file never stops the app");
        assert_eq!(rt.engines().len(), 1);
        let t = rt.twin(id).unwrap();
        assert_eq!(t["phase"], "failed", "{file}");
        let err = t["state"]["error"].as_str().unwrap();
        for s in says {
            assert!(err.contains(s), "{err}");
        }
        assert_eq!(rt.twin("x/ok").unwrap()["phase"], "idle", "the rest loads");
    }
    // the only engine broken: still one engine (failed), nothing seeded over it
    let dir = temp("brokenonly");
    put(&dir, "engines/x/engine.md", "---\ntitle: X\nno colon\n---\n");
    let rt = start(&dir);
    assert_eq!(rt.engines().len(), 1);
    assert_eq!(rt.engines()[0].twin.phase, Phase::Failed);
    assert!(!dir.join("engines/askk").exists());
}

// ── kinds, actions, views ──────────────────────────────────────────────────

fn check_views(t: &Twin) {
    let all = [&t.views.icon, &t.views.small, &t.views.medium, &t.views.large];
    for v in all {
        for n in v.walk() {
            assert!(PRIMITIVES.contains(&n.c), "{} uses non-primitive {}", t.id, n.c);
        }
    }
    let v = serde_json::to_value(&t.views).unwrap();
    for at in crate::SIZES {
        assert_eq!(v[at]["c"], "Card", "{} {at} view is not rooted in a Card", t.id);
        assert_eq!(v[at]["props"]["size"], at, "{} {at} card names its size", t.id);
        assert_eq!(v[at]["props"]["status"]["now"], json!(t.status.now), "{} {at} card carries the status", t.id);
    }
    assert_eq!(v.as_object().unwrap().len(), 4, "{}: exactly icon, small, medium, large", t.id);
    assert!(!t.status.now.is_empty() && !t.status.light.is_empty() && t.status.since > 0, "{} has a live status", t.id);
    assert!(!t.prompt.is_empty());
}

#[test]
fn every_object_has_four_views_of_primitives() {
    let dir = temp("views");
    lab(&dir);
    let rt = start(&dir);
    let lab = &rt.engines()[0];
    check_views(&lab.twin);
    check_views(&lab.children[0].twin);
    assert_eq!(lab.elements.len(), 4);
    for e in &lab.elements {
        check_views(e);
    }
    // the engine embeds its elements and child through Slots
    let slots: Vec<String> = lab.twin.views.medium.walk().iter().filter(|n| n.c == "Slot").map(|n| n.props["of"].as_str().unwrap().to_string()).collect();
    assert_eq!(slots, ["lab/c", "lab/m", "lab/n", "lab/s", "lab/kid"]);
    assert!(lab.twin.views.large.walk().iter().any(|n| n.c == "Slot" && n.props["at"] == "small"));
    let kinds: Vec<String> = rt.kinds().iter().map(|k| k.kind.clone()).collect();
    assert_eq!(kinds, ["note", "counter", "status", "meter", "timer", "model", "loop", "phases", "tools", "memory", "workflows"]);
    assert_eq!(rt.kinds()[1].config["step"], "number");
    assert_eq!(element(lab, "lab/c").config, json!({"step": 5}));
    assert_eq!(element(lab, "lab/n").config, json!({}));
    assert_eq!(lab.twin.config, json!({}));
}

fn texts(n: &Node) -> String {
    n.walk().iter().filter_map(|n| n.props.get("value").or(n.props.get("label")).map(|v| v.to_string())).collect::<Vec<_>>().join("|")
}

#[test]
fn note_edit() {
    let dir = temp("note");
    lab(&dir);
    let mut rt = start(&dir);
    let t = element(&rt.engines()[0], "lab/n").clone();
    assert_eq!(t.state["text"], "hello");
    let out = rt.act("lab/n", "edit", &json!({"text": "changed"})).unwrap();
    assert_eq!(out.twin["state"]["text"], "changed");
    assert!(!out.world);
    assert_eq!(out.changed.iter().map(|c| c.0.as_str()).collect::<Vec<_>>(), ["lab/n", "lab"]);
    let t = element(&rt.engines()[0], "lab/n").clone();
    assert!(texts(&t.views.medium).contains("changed"));
    assert!(t.prompt.contains("changed"));
    assert!(rt.engines()[0].twin.prompt.contains("changed"), "engine prompt includes elements");
    assert!(rt.act("lab/n", "edit", &json!({})).is_err());
}

#[test]
fn counter_steps_from_config() {
    let dir = temp("counter");
    lab(&dir);
    let mut rt = start(&dir);
    rt.act("lab/c", "inc", &json!({})).unwrap();
    rt.act("lab/c", "inc", &json!({})).unwrap();
    let out = rt.act("lab/c", "dec", &json!({})).unwrap();
    assert_eq!(out.twin["state"]["value"], 5);
    let t = element(&rt.engines()[0], "lab/c").clone();
    assert!(texts(&t.views.medium).contains("\"5\""));
    assert!(t.prompt.contains("value 5"));
    rt.act("lab/c", "reset", &json!({})).unwrap();
    assert_eq!(element(&rt.engines()[0], "lab/c").state["value"], 0);
    // child engine's counter uses default step 1
    rt.act("lab/kid/x", "inc", &json!({})).unwrap();
    assert_eq!(rt.twin("lab/kid/x").unwrap()["state"]["value"], 1);
}

#[test]
fn status_drives_phase() {
    let dir = temp("status");
    lab(&dir);
    let mut rt = start(&dir);
    let out = rt.act("lab/s", "start", &json!({})).unwrap();
    assert_eq!(out.twin["phase"], "running");
    let t = element(&rt.engines()[0], "lab/s").clone();
    assert_eq!(t.views.medium.props["tone"], "busy");
    assert!(t.views.medium.walk().iter().any(|n| n.c == "Button" && n.props["action"] == "stop"));
    rt.act("lab/s", "stop", &json!({})).unwrap();
    assert_eq!(rt.twin("lab/s").unwrap()["phase"], "stopped");
}

#[test]
fn meter_sets_within_max() {
    let dir = temp("meter");
    lab(&dir);
    let mut rt = start(&dir);
    rt.act("lab/m", "set", &json!({"value": 7})).unwrap();
    rt.act("lab/m", "set", &json!({"value": "8"})).unwrap();
    assert!(rt.act("lab/m", "set", &json!({"value": 11})).is_err());
    assert!(rt.act("lab/m", "set", &json!({"value": "x"})).is_err());
    let t = element(&rt.engines()[0], "lab/m").clone();
    assert_eq!(t.state["value"], 8.0);
    let m = t.views.medium.walk().into_iter().find(|n| n.c == "Meter").unwrap().clone();
    assert_eq!(m.props["max"], 10.0);
    assert_eq!(m.props["value"], 8.0);
}

#[test]
fn unknown_action_or_target_is_refused_and_changes_nothing() {
    let dir = temp("refuse");
    let mut rt = start(&dir);
    let before = rt.world();
    assert!(rt.act("askk", "explode", &json!({})).is_err());
    assert!(rt.act("askk/welcome", "inc", &json!({})).is_err());
    assert!(rt.act("nobody", "start", &json!({})).is_err());
    assert!(rt.act("askk", "element.frob", &json!({})).is_err());
    assert_eq!(rt.world(), before);
}

#[test]
fn engine_start_stop_updates_phase_and_tone() {
    let dir = temp("engine");
    let mut rt = start(&dir);
    let out = rt.act("askk", "start", &json!({})).unwrap();
    assert_eq!(out.twin["phase"], "running");
    assert_eq!(out.twin["views"]["medium"]["props"]["tone"], "busy");
    assert!(out.twin["elements"].is_array(), "an engine's twin is its EngineTwin");
}

// ── structure actions ──────────────────────────────────────────────────────

#[test]
fn structure_actions_write_files_and_rebuild() {
    let dir = temp("structure");
    let mut rt = start(&dir);
    let out = rt.act("askk", "element.add", &json!({"kind": "counter", "title": "Runs today", "config": {"step": 2}})).unwrap();
    assert!(out.world);
    let file = dir.join("engines/askk/elements/runs-today.md");
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.contains("kind: counter") && text.contains("step: 2"), "{text}");
    rt.act("askk/runs-today", "inc", &json!({})).unwrap();
    assert_eq!(rt.twin("askk/runs-today").unwrap()["state"]["value"], 2);

    // same title → a second file, config as text
    rt.act("askk", "element.add", &json!({"kind": "meter", "title": "Runs today", "config": "{max: 5}"})).unwrap();
    assert!(dir.join("engines/askk/elements/runs-today-2.md").exists());

    rt.act("askk", "element.edit", &json!({"id": "askk/runs-today", "title": "Runs", "config": {"step": 3}})).unwrap();
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.contains("title: Runs\n") && text.contains("step: 3"), "{text}");
    assert_eq!(rt.twin("askk/runs-today").unwrap()["state"]["value"], 2, "state survives an edit");
    rt.act("askk/runs-today", "inc", &json!({})).unwrap();
    assert_eq!(rt.twin("askk/runs-today").unwrap()["state"]["value"], 5);

    rt.act("askk", "element.remove", &json!({"id": "runs-today-2"})).unwrap();
    assert!(!dir.join("engines/askk/elements/runs-today-2.md").exists());
    assert!(rt.twin("askk/runs-today-2").is_none());

    rt.act("askk", "engine.add", &json!({"title": "Sub Engine"})).unwrap();
    assert!(dir.join("engines/askk/engines/sub-engine/engine.md").exists());
    rt.act("askk/sub-engine", "element.add", &json!({"kind": "note", "title": "Hi"})).unwrap();
    assert!(dir.join("engines/askk/engines/sub-engine/elements/hi.md").exists());
    assert_eq!(rt.engines()[0].children[0].elements[0].id, "askk/sub-engine/hi");

    // refusals write nothing
    assert!(rt.act("askk", "element.add", &json!({"kind": "gizmo", "title": "x"})).is_err());
    assert!(rt.act("askk", "element.add", &json!({"kind": "counter", "title": "x", "config": {"max": 1}})).is_err());
    assert!(rt.act("askk", "element.add", &json!({"kind": "counter", "title": "y", "config": {"step": "a"}})).is_err());
    assert!(rt.act("askk", "element.add", &json!({"kind": "note"})).is_err());
    assert!(rt.act("askk", "element.remove", &json!({"id": "nope"})).is_err());
    assert!(!dir.join("engines/askk/elements/x.md").exists());
    assert!(!dir.join("engines/askk/elements/y.md").exists());

    // the folder is the truth: a fresh boot sees the same world
    let world = rt.world();
    rt.shutdown().unwrap();
    let rt = start(&dir);
    assert_eq!(rt.world()["engines"], world["engines"]);
}

#[test]
fn removed_element_state_is_gone_when_readded() {
    let dir = temp("readd");
    let mut rt = start(&dir);
    rt.act("askk", "element.add", &json!({"kind": "counter", "title": "K"})).unwrap();
    rt.act("askk/k", "inc", &json!({})).unwrap();
    rt.act("askk", "element.remove", &json!({"id": "askk/k"})).unwrap();
    assert!(!dir.join("state/home/k.json").exists());
    rt.act("askk", "element.add", &json!({"kind": "counter", "title": "K"})).unwrap();
    assert_eq!(rt.twin("askk/k").unwrap()["state"]["value"], 0);
}

// ── lifecycle ──────────────────────────────────────────────────────────────

#[test]
fn clean_restart_keeps_state_and_stops_running() {
    let dir = temp("clean");
    lab(&dir);
    let mut rt = start(&dir);
    rt.act("lab/c", "inc", &json!({})).unwrap();
    rt.act("lab/s", "start", &json!({})).unwrap();
    rt.act("lab", "start", &json!({})).unwrap();
    rt.shutdown().unwrap();
    assert!(!dir.join(".lock").exists());
    assert!(dir.join("state/lab/c.json").exists());

    let rt = start(&dir);
    assert_eq!(rt.info["boots"], 2);
    assert_eq!(rt.info["last_exit"], "clean");
    assert_eq!(rt.twin("lab/c").unwrap()["state"]["value"], 5);
    assert_eq!(rt.twin("lab/s").unwrap()["phase"], "stopped");
    assert_eq!(rt.twin("lab").unwrap()["phase"], "stopped");
}

#[test]
fn crash_marks_running_work_interrupted() {
    let dir = temp("crash");
    lab(&dir);
    let mut rt = start(&dir);
    rt.act("lab/s", "start", &json!({})).unwrap();
    rt.act("lab/kid", "start", &json!({})).unwrap();
    rt.act("lab/m", "set", &json!({"value": 3})).unwrap();
    drop(rt); // no shutdown: the process died

    let rt = start(&dir);
    assert_eq!(rt.info["last_exit"], "crash");
    assert_eq!(rt.twin("lab/s").unwrap()["phase"], "interrupted");
    assert_eq!(rt.twin("lab/kid").unwrap()["phase"], "interrupted");
    assert_eq!(rt.twin("lab/m").unwrap()["state"]["value"], 3.0);
    assert_eq!(rt.twin("lab/s").unwrap()["views"]["medium"]["props"]["tone"], "warn");
}

#[test]
fn layout_and_theme_persist() {
    let dir = temp("layout");
    let rt = start(&dir);
    assert_eq!(rt.world()["layouts"], json!({"dashboard": {"order": []}, "canvas": {"positions": {}}}));
    assert_eq!(rt.world()["theme"]["dark"]["bg"], "#000000");
    assert_eq!(rt.world()["theme"], default_theme());
    // the seed is the token file: every scale, colours per mode
    let th = default_theme();
    for g in ["space", "text", "radius", "motion", "ease", "font", "glass", "background"] {
        assert!(th[g].is_object(), "{g}");
    }
    assert_eq!((th["radius"]["md"].as_str(), th["glass"]["blur"].as_str()), (Some("10px"), Some("24px")));
    for mode in ["light", "dark"] {
        for k in ["tint", "edge", "wall-a", "wall-b", "wall-c", "press", "press-ink"] {
            assert!(th[mode][k].as_str().is_some_and(|v| v.starts_with('#')), "{mode}.{k}");
        }
    }
    rt.set_layout("canvas", &json!({"positions": {"askk": {"x": 1, "y": 2}}})).unwrap();
    assert!(rt.set_layout("../x", &json!({})).is_err());
    assert!(rt.set_layout("other", &json!({})).is_err());
    rt.set_theme(&json!({"radius": {"md": "4px"}})).unwrap();
    assert!(rt.set_theme(&json!(3)).is_err());
    rt.shutdown().unwrap();
    let rt = start(&dir);
    assert_eq!(rt.world()["layouts"]["canvas"], json!({"positions": {"askk": {"x": 1, "y": 2}}}));
    assert_eq!(rt.world()["theme"]["radius"]["md"], "4px");
    assert_eq!(rt.world()["theme"]["radius"]["sm"], default_theme()["radius"]["sm"]);
    assert!(dir.join("layout/canvas.json").exists());
}

#[test]
fn writes_leave_no_temp_files_and_reject_bad_names() {
    let dir = temp("atomic");
    let store = FolderStore::open(&dir).unwrap();
    store.write("state", "x", &json!({ "a": 1 })).unwrap();
    store.write("state", "a/b", &json!({ "a": 1 })).unwrap();
    assert!(dir.join("state/a/b.json").exists());
    let tmp_in = |d: &str| fs::read_dir(dir.join(d)).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().ends_with(".tmp"));
    assert!(!tmp_in("state"));
    assert!(store.write("state", "../escape", &json!({})).is_err());
    assert!(store.write_text("engines/../../x.md", "").is_err());
    assert!(store.write_text("engines/.hidden/x.md", "").is_err());
    assert!(store.remove("").is_err());
    store.write_text("engines/a/engine.md", "t").unwrap();
    assert!(!tmp_in("engines/a"));
    assert_eq!(store.dirs("engines").unwrap(), ["a"]);
    assert_eq!(store.files("engines/a", "md").unwrap(), ["engine"]);
}

#[test]
fn note_row_text_is_inline_markdown() {
    let dir = temp("noterow");
    put(&dir, "engines/x/engine.md", &md("X", "engine", ""));
    put(&dir, "engines/x/elements/n.md", &(md("N", "note", "") + "Hello from **Askk**."));
    let rt = start(&dir);
    let row = &rt.twin("x/n").unwrap()["views"]["small"];
    assert_eq!(row["c"], "Card");
    let body = &row["children"][0]["children"][0];
    assert_eq!(body["props"]["value"], "Hello from **Askk**.");
    assert_eq!(body["props"]["md"], true, "the frontend renders it as inline markdown");
}

#[test]
fn engine_summary_counts_what_runs_and_failed_below_it() {
    let dir = temp("summary");
    lab(&dir);
    put(&dir, "engines/lab/engines/kid/elements/bad.md", &md("Bad", "gizmo", ""));
    let mut rt = start(&dir);
    rt.act("lab/s", "start", &json!({})).unwrap();
    rt.act("lab/kid", "start", &json!({})).unwrap();
    let lab = &rt.engines()[0];
    assert_eq!(lab.twin.phase, Phase::Idle, "its own phase stays separate");
    assert_eq!(lab.summary, engine::Summary { running: 2, failed: 1 });
    assert_eq!(lab.children[0].summary, engine::Summary { running: 0, failed: 1 });
    let card = serde_json::to_string(&lab.twin.views.medium).unwrap();
    assert!(card.contains("2 running") && card.contains("1 failed"), "{card}");
    let row = serde_json::to_string(&lab.twin.views.small).unwrap();
    assert!(row.contains("2 running") && row.contains("1 failed"));
    assert!(json!(lab)["summary"] == json!({"running": 2, "failed": 1}));
    // nothing below: no badge
    rt.act("lab/s", "stop", &json!({})).unwrap();
    rt.act("lab/kid", "stop", &json!({})).unwrap();
    fs::remove_file(dir.join("engines/lab/engines/kid/elements/bad.md")).unwrap();
    rt.reload().unwrap();
    let card = serde_json::to_string(&rt.engines()[0].twin.views.medium).unwrap();
    assert!(!card.contains(" running\"") && !card.contains(" failed\""), "{card}");
}

#[test]
fn engine_stop_cascades_to_everything_below() {
    let dir = temp("cascade");
    lab(&dir);
    let mut rt = start(&dir);
    rt.act("lab/s", "start", &json!({})).unwrap();
    rt.act("lab/kid", "start", &json!({})).unwrap();
    rt.act("lab", "stop", &json!({})).unwrap();
    for id in ["lab", "lab/s", "lab/kid"] {
        assert_eq!(rt.twin(id).unwrap()["phase"], "stopped", "{id}");
        let saved: Value = serde_json::from_str(&fs::read_to_string(dir.join(format!("state/{id}.json"))).unwrap()).unwrap();
        assert_eq!(saved["phase"], "stopped", "{id} on disk");
    }
    assert_eq!(rt.twin("lab/c").unwrap()["phase"], "idle", "idle objects are untouched");
}

#[test]
fn engine_edit_and_remove_write_the_files() {
    let dir = temp("engedit");
    lab(&dir);
    put(&dir, "engines/other/engine.md", &md("Other", "engine", ""));
    let mut rt = start(&dir);
    rt.act("lab", "engine.edit", &json!({"title": "Lab two", "body": "New body."})).unwrap();
    let text = fs::read_to_string(dir.join("engines/lab/engine.md")).unwrap();
    assert!(text.contains("title: Lab two") && text.contains("New body.") && text.contains("order: 1"), "{text}");
    assert_eq!(rt.twin("lab").unwrap()["title"], "Lab two");
    assert!(rt.act("lab", "engine.edit", &json!({})).is_err());

    rt.act("lab/kid/x", "inc", &json!({})).unwrap();
    assert!(dir.join("state/lab/kid/x.json").exists());
    rt.act("lab", "engine.remove", &json!({"id": "kid"})).unwrap();
    assert!(!dir.join("engines/lab/engines/kid").exists());
    assert!(!dir.join("state/lab/kid.json").exists() && !dir.join("state/lab/kid").exists());
    assert!(rt.twin("lab/kid").is_none());
    assert!(rt.act("lab", "engine.remove", &json!({"id": "nope"})).is_err());

    // a top engine removes itself, but never the last one
    let out = rt.act("other", "engine.remove", &json!({"id": "other"})).unwrap();
    assert!(out.world && out.twin.is_null());
    assert!(!dir.join("engines/other").exists());
    assert!(rt.act("lab", "engine.remove", &json!({"id": "lab"})).unwrap_err().to_string().contains("last"));
    assert!(dir.join("engines/lab/engine.md").exists());
}

// ── card sizes and live status ─────────────────────────────────────────────

/// Every kind gives all four sizes rooted in a Card, and a status line of its own.
#[test]
fn every_kind_has_every_size_and_a_status_line() {
    use crate::kinds::KINDS;
    let mut seen = vec![];
    for k in KINDS.iter() {
        let mut o = Obj {
            id: format!("e/{}", k.kind()),
            kind: k.kind().into(),
            title: "T".into(),
            order: 0,
            config: serde_json::Map::new(),
            description: String::new(),
            body: "two words".into(),
            phase: Phase::Idle,
            state: json!({}),
            error: None,
            since: 1,
            activity: vec![],
        };
        o.state = k.init(&o);
        let t = k.twin(&o);
        check_views(&t);
        seen.push((k.kind(), t.status.now.clone()));
    }
    let now = |kind: &str| seen.iter().find(|(k, _)| *k == kind).unwrap().1.clone();
    assert_eq!(now("counter"), "value 0");
    assert_eq!(now("timer"), "0/10 s");
    assert_eq!(now("model"), "never called");
    assert_eq!(now("loop"), "idle");
    assert_eq!(now("memory"), "0 lesson(s)");
    assert_eq!(now("note"), "2 word(s)");
    assert_eq!(now("status"), "idle");
}

#[test]
fn a_running_loop_and_model_say_what_they_do() {
    use crate::kinds::find;
    let l = find("loop").unwrap();
    let mut o = Obj {
        id: "e/l".into(),
        kind: "loop".into(),
        title: "L".into(),
        order: 0,
        config: serde_json::Map::new(),
        description: String::new(),
        body: String::new(),
        phase: Phase::Waiting,
        state: json!({}),
        error: None,
        since: 5,
        activity: vec![],
    };
    o.state = l.init(&o);
    o.state["step"] = json!(2);
    o.state["calls"] = json!({ "c1": { "tool": "clock.wait", "args": {}, "status": "running", "started": 1 }, "c2": { "tool": "clock.now", "args": {}, "status": "running", "started": 2 } });
    o.state["waiting"] = json!({ "on": "all", "ids": ["c1", "c2"], "since": 5 });
    assert_eq!(l.twin(&o).status.now, "step 2 · waiting on c1, c2");
    assert_eq!(l.twin(&o).status.light, "accent");
    o.phase = Phase::Running;
    assert_eq!(l.twin(&o).status.now, "step 3 · calling model");
    o.state["messages"] = json!([{ "role": "model", "text": "x" }]);
    assert_eq!(l.twin(&o).status.now, "step 2 · starting calls");
    let m = find("model").unwrap();
    let mut o = Obj { kind: "model".into(), phase: Phase::Idle, state: json!({ "calls": 1, "last": { "ok": true, "ms": 1200 } }), ..o };
    assert_eq!(m.twin(&o).status.now, "last call 1.2 s");
    o.phase = Phase::Running;
    assert_eq!(m.twin(&o).status.light, "busy");
}

#[test]
fn since_moves_only_when_the_phase_class_changes() {
    let mut o = Obj {
        id: "x".into(),
        kind: "note".into(),
        title: "x".into(),
        order: 0,
        config: serde_json::Map::new(),
        description: String::new(),
        body: String::new(),
        phase: Phase::Running,
        state: json!({}),
        error: None,
        since: 7,
        activity: vec![],
    };
    o.phase = Phase::Waiting;
    o.mark(Phase::Running);
    assert_eq!(o.since, 7, "running ↔ waiting is one busy stretch");
    o.phase = Phase::Idle;
    o.mark(Phase::Waiting);
    assert!(o.since > 7);
}

/// The page trees are seeded, served in /world, saved by set_ui and re-read by a reload.
#[test]
fn page_trees_seed_save_and_hot_reload() {
    let dir = temp("ui");
    let mut rt = start(&dir);
    let w = rt.world();
    assert_eq!(w["ui"]["dashboard"]["c"], "Page");
    assert_eq!(w["ui"]["dashboard"]["children"][1]["c"], "CardGrid");
    assert_eq!(w["ui"]["canvas"]["children"][1]["c"], "Canvas");
    assert!(w["ui"]["dashboard"]["props"]["background"]["fields"].as_array().unwrap().len() >= 3);
    assert!(dir.join("ui/dashboard.json").exists());

    let tree = json!({ "c": "Page", "props": { "background": { "image": "/ui/assets/a.png", "dim": 2 } }, "children": [{ "c": "CardGrid", "props": { "min": "sm" } }] });
    rt.set_ui("dashboard", &tree).unwrap();
    assert_eq!(rt.world()["ui"]["dashboard"], tree);
    assert!(rt.set_ui("nope", &tree).is_err());
    assert!(rt.set_ui("dashboard", &json!({ "props": {} })).is_err(), "a node needs c");
    assert!(rt.set_ui("dashboard", &json!({ "c": "Page", "children": {} })).is_err());

    // an edit by hand reaches the next reload, which reports a change once
    let edited = json!({ "c": "Page", "children": [{ "c": "Mystery" }] });
    std::fs::write(dir.join("ui/dashboard.json"), edited.to_string()).unwrap();
    assert!(rt.reload().unwrap().changed);
    assert_eq!(rt.world()["ui"]["dashboard"], edited, "an unknown primitive is kept: the UI shows it as unknown");
    assert!(!rt.reload().unwrap().changed);
    // a broken file falls back to the default
    std::fs::write(dir.join("ui/dashboard.json"), "{not json").unwrap();
    rt.reload().unwrap();
    assert_eq!(rt.world()["ui"]["dashboard"]["children"][1]["c"], "CardGrid");
}

#[test]
fn engines_folder_can_live_outside_the_data_folder() {
    let base = std::env::temp_dir().join(format!("askk-eng-{}", std::process::id()));
    let (data, eng) = (base.join("data"), base.join("cfg"));
    let store = crate::FolderStore::with_engines(&data, &eng).unwrap();
    let rt = crate::boot(Box::new(store)).unwrap();
    assert!(!rt.engines().is_empty());
    assert!(eng.join("askk/engine.md").is_file(), "seeded into the engines folder");
    assert!(!data.join("engines").exists(), "nothing under data/engines");
    assert!(data.join("state").exists(), "state still under data");
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn description_is_frontmatter_and_reaches_the_twin() {
    let dir = std::env::temp_dir().join(format!("askk-desc-{}", std::process::id()));
    let rt = crate::boot(Box::new(crate::FolderStore::open(&dir).unwrap())).unwrap();
    let w = rt.world();
    let e = &w["engines"][0];
    assert!(e["description"].as_str().is_some_and(|d| d.starts_with("The one engine")), "{}", e["description"]);
    assert!(e["prompt"].as_str().unwrap().contains("The one engine"));
    assert!(e["elements"].as_array().unwrap().iter().all(|x| x["kind"] != "model"), "the seed engine inherits the desk default");
    assert_eq!(w["desk"]["model"], "claude-cli");
    let cli = w["desk"]["models"].as_array().unwrap().iter().find(|m| m["slug"] == "claude-cli").unwrap();
    assert_eq!(cli["config"]["connector"], "claude-cli");
    let _ = std::fs::remove_dir_all(dir);
}
