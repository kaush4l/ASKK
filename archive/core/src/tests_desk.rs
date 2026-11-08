//! The desk: model library, desk default, resolution order, saving through /act.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-desk-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = fs::remove_dir_all(&dir);
    dir
}
fn put(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}
fn hub(dir: &Path) -> Hub {
    Hub::new(boot(Box::new(FolderStore::open(dir).unwrap())).unwrap())
}
fn twin(h: &Hub, id: &str) -> Value {
    h.read(|rt| rt.twin(id)).unwrap().unwrap_or_else(|| panic!("no {id}"))
}
fn world(h: &Hub) -> Value {
    h.read(|rt| rt.world()).unwrap()
}
fn source(h: &Hub, id: &str) -> (String, Option<String>) {
    let r = h.read(|rt| rt.model_for(id)).unwrap().unwrap();
    (r.source.to_string(), r.slug)
}

/// Two engines, a library of two (`a` in the older title/id shape, `b` in the name shape), a desk default of `b`.
fn desk(dir: &Path) {
    put(dir, "engines/e/engine.md", "---\ntitle: E\nkind: engine\n---\n");
    put(dir, "engines/f/engine.md", "---\ntitle: F\nkind: engine\nmodel: a\n---\n");
    put(dir, "engines/models/a.md", "---\ntitle: A\nconfig: {connector: echo, id: a, context: 5000}\n---\n");
    put(dir, "engines/models/b.md", "---\nname: b\nconfig: {connector: echo}\n---\n");
    put(dir, "engines/desk.md", "---\ntitle: Desk\nmodel: b\n---\n");
}

#[test]
fn models_is_not_an_engine_and_the_seed_ships_the_library() {
    let dir = temp("seed");
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    assert!(rt.engines().iter().all(|e| e.twin.id != "models"));
    let w = rt.world();
    assert_eq!(w["desk"]["model"], "claude-cli");
    let slugs: Vec<&str> = w["desk"]["models"].as_array().unwrap().iter().map(|m| m["slug"].as_str().unwrap()).collect();
    assert_eq!(slugs, ["claude-cli", "sonnet-5-5"]);
    let (cli, sonnet) = (&w["desk"]["models"][0], &w["desk"]["models"][1]);
    assert_eq!((cli["name"].as_str(), cli["config"].clone()), (Some("default"), json!({"connector": "claude-cli", "context": 400000})));
    assert_eq!((sonnet["name"].as_str(), sonnet["config"]["connector"].as_str()), (Some("claude-sonnet-5-5"), Some("claude-cli")));
    assert!(sonnet.get("title").is_none() && sonnet["config"].get("id").is_none());
    // the CLI default sends no --model; a named one sends its name
    assert_eq!(rt.desk().find("claude-cli").unwrap().spec().id, "");
    assert_eq!(rt.desk().find("sonnet-5-5").unwrap().spec().id, "claude-sonnet-5-5");
    assert_eq!(w["desk"]["models"][0]["used_by"], json!(["askk"]));
    assert!(w["desk"]["connectors"].as_array().unwrap().contains(&json!("echo")));
    assert_eq!(rt.model_for("askk").unwrap().source, "desk");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn resolution_is_element_then_engine_then_desk_then_builtin() {
    let dir = temp("order");
    desk(&dir);
    let h = hub(&dir);
    assert_eq!(source(&h, "e"), ("desk".into(), Some("b".into())));
    assert_eq!(source(&h, "f"), ("engine".into(), Some("a".into())));
    // inline map in engine.md
    put(&dir, "engines/e/engine.md", "---\ntitle: E\nkind: engine\nmodel: {connector: echo, id: inline}\n---\n");
    h.with(|rt| rt.reload()).unwrap();
    let r = h.read(|rt| rt.model_for("e")).unwrap().unwrap();
    assert_eq!((r.source, r.slug.clone(), r.spec.id.as_str()), ("engine", None, "inline"));
    // an element wins over engine.md
    put(&dir, "engines/f/elements/m.md", "---\ntitle: M\nkind: model\nconfig: {connector: echo, id: own}\n---\n");
    h.with(|rt| rt.reload()).unwrap();
    let r = h.read(|rt| rt.model_for("f")).unwrap().unwrap();
    assert_eq!((r.source, r.element.as_deref()), ("element", Some("f/m")));
    // an unknown slug falls to the desk with a warning; no desk default → builtin echo
    put(&dir, "engines/e/engine.md", "---\ntitle: E\nkind: engine\nmodel: nope\n---\n");
    fs::remove_file(dir.join("engines/desk.md")).unwrap();
    h.with(|rt| rt.reload()).unwrap();
    let r = h.read(|rt| rt.model_for("e")).unwrap().unwrap();
    assert_eq!(r.source, "builtin");
    assert!(r.warning.unwrap().contains("nope"));
    // the view says which model and where it came from
    let t = twin(&h, "e");
    assert!(t["views"]["medium"].to_string().contains("· builtin"), "{}", t["views"]["medium"]);
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn save_refuses_keys_and_unknown_connectors_and_writes_the_library() {
    let dir = temp("save");
    desk(&dir);
    let h = hub(&dir);
    let save = |args: Value| {
        let h = h.clone();
        async move { h.act("desk", "model.save", &args).await }
    };
    for (bad, why) in [
        (json!({"name": "x", "config": {"connector": "echo"}, "api_key": "abc"}), "api_key"),
        (json!({"name": "x", "config": {"connector": "echo", "token": "abc"}}), "token"),
        (json!({"name": "sk-ant-api03-abcdefghijklmnop", "config": {"connector": "echo"}}), "looks like a key"),
        (json!({"name": "x", "config": {"connector": "echo", "key_env": "sk-abcdefghijklmnop1234"}}), "looks like a key"),
        (json!({"name": "x", "config": {"connector": "echo", "key_env": "lower"}}), "NAME"),
        (json!({"name": "x", "config": {"connector": "nope"}}), "unknown connector nope"),
        (json!({"name": "x", "config": {"connector": "echo", "colour": "red"}}), "unknown model field"),
        (json!({"name": "x"}), "needs config"),
        (json!({"config": {"connector": "echo"}}), "needs name"),
    ] {
        let e = save(bad).await.err().expect("refused").to_string();
        assert!(e.contains(why), "{why}: {e}");
    }
    let w = save(json!({"name": "Qwen3-30B-A3B", "config": {"connector": "echo", "key_env": "LOCAL_KEY", "context": "9000"}})).await.unwrap();
    let m = w["models"].as_array().unwrap().iter().find(|m| m["slug"] == "qwen3-30b-a3b").expect("created").clone();
    assert_eq!((m["name"].as_str(), m["config"].clone()), (Some("Qwen3-30B-A3B"), json!({"connector": "echo", "key_env": "LOCAL_KEY", "context": 9000})));
    let text = fs::read_to_string(dir.join("engines/models/qwen3-30b-a3b.md")).unwrap();
    assert!(text.contains("name: Qwen3-30B-A3B") && text.contains("key_env: LOCAL_KEY") && !text.contains("title"), "{text}");
    // the same name again: a second file
    save(json!({"name": "qwen3 30b a3b", "config": {"connector": "echo"}})).await.unwrap();
    assert!(dir.join("engines/models/qwen3-30b-a3b-2.md").exists());
    // update in place keeps the slug and the name when none is given; an old file drops title/id
    save(json!({"slug": "a", "config": {"connector": "echo", "context": 7000}})).await.unwrap();
    let text = fs::read_to_string(dir.join("engines/models/a.md")).unwrap();
    assert!(text.contains("name: a") && !text.contains("title") && !text.contains("id:"), "{text}");
    let a = world(&h)["desk"]["models"].as_array().unwrap().iter().find(|m| m["slug"] == "a").unwrap().clone();
    assert_eq!((a["name"].as_str(), a["config"]["context"].as_u64()), (Some("a"), Some(7000)));
    h.shutdown().await.unwrap();
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remove_refuses_the_default_and_referenced_models_and_default_switches() {
    let dir = temp("remove");
    desk(&dir);
    let h = hub(&dir);
    let e = h.act("desk", "model.remove", &json!({"slug": "b"})).await.err().unwrap().to_string();
    assert!(e.contains("desk default"), "{e}");
    let e = h.act("desk", "model.remove", &json!({"slug": "a"})).await.err().unwrap().to_string();
    assert!(e.contains("engine(s) f"), "{e}");
    assert!(h.act("desk", "model.default", &json!({"slug": "zzz"})).await.is_err());
    let w = h.act("desk", "model.default", &json!({"slug": "a"})).await.unwrap();
    assert_eq!(w["model"], "a");
    assert!(fs::read_to_string(dir.join("engines/desk.md")).unwrap().contains("model: a"));
    assert_eq!(source(&h, "e"), ("desk".into(), Some("a".into())));
    h.act("desk", "model.remove", &json!({"slug": "b"})).await.unwrap();
    assert!(!dir.join("engines/models/b.md").exists());
    h.shutdown().await.unwrap();
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn engine_model_writes_engine_md_and_the_world_shows_it() {
    let dir = temp("engmodel");
    desk(&dir);
    let h = hub(&dir);
    h.act("e", "engine.model", &json!({"model": "a"})).await.unwrap();
    assert!(fs::read_to_string(dir.join("engines/e/engine.md")).unwrap().contains("model: a"));
    assert_eq!(source(&h, "e"), ("engine".into(), Some("a".into())));
    let w = world(&h);
    let a = w["desk"]["models"].as_array().unwrap().iter().find(|m| m["slug"] == "a").unwrap();
    assert_eq!(a["used_by"], json!(["e", "f"]));
    assert!(h.act("e", "engine.model", &json!({"model": "nope"})).await.err().unwrap().to_string().contains("no model nope"));
    assert!(h.act("e", "engine.model", &json!({"model": {"connector": "echo", "secret": "x"}})).await.is_err());
    assert!(h.act("e", "engine.model", &json!({})).await.is_err());
    h.act("e", "engine.model", &json!({"model": {"connector": "echo", "id": "inl"}})).await.unwrap();
    assert_eq!(h.read(|rt| rt.model_for("e")).unwrap().unwrap().spec.id, "inl");
    h.act("e", "engine.model", &json!({"model": null})).await.unwrap();
    assert!(!fs::read_to_string(dir.join("engines/e/engine.md")).unwrap().contains("model:"));
    assert_eq!(source(&h, "e"), ("desk".into(), Some("b".into())));
    h.shutdown().await.unwrap();
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn model_test_runs_in_the_background_and_lands_on_the_desk() {
    let dir = temp("test");
    desk(&dir);
    let h = hub(&dir);
    assert!(h.act("desk", "model.test", &json!({"slug": "zzz"})).await.is_err());
    h.act("desk", "model.test", &json!({"slug": "a"})).await.unwrap();
    let t0 = Instant::now();
    let a = loop {
        let w = world(&h);
        let a = w["desk"]["models"].as_array().unwrap().iter().find(|m| m["slug"] == "a").unwrap().clone();
        if a["test"]["ok"].is_boolean() {
            break a;
        }
        assert!(t0.elapsed() < Duration::from_secs(5));
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(a["test"]["reply"], "answer: pong");
    assert_eq!(a["calls"], 1);
    assert!(dir.join("state/desk-models.json").exists());
    h.shutdown().await.unwrap();
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn old_files_load_id_as_name() {
    let dir = temp("old");
    put(&dir, "engines/models/x.md", "---\ntitle: Old X\ndescription: d\nconfig: {connector: echo, id: real-x}\n---\n");
    put(&dir, "engines/models/cli.md", "---\ntitle: CLI\nconfig: {connector: claude-cli}\n---\n");
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let d = rt.desk();
    assert_eq!((d.find("x").unwrap().name.as_str(), d.find("x").unwrap().spec().id.as_str()), ("real-x", "real-x"));
    assert!(d.find("x").unwrap().config.get("id").is_none());
    assert_eq!((d.find("cli").unwrap().name.as_str(), d.find("cli").unwrap().spec().id.as_str()), ("default", ""));
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn discover_lists_names_and_marks_those_already_saved() {
    let dir = temp("discover");
    desk(&dir);
    let h = hub(&dir);
    let got = h.act("desk", "model.discover", &json!({"connector": "echo"})).await.unwrap();
    assert_eq!(got, json!({"models": ["echo"], "already": ["a", "b"]}));
    assert!(h.act("desk", "model.discover", &json!({})).await.err().unwrap().to_string().contains("needs connector"));
    assert!(h.act("desk", "model.discover", &json!({"connector": "nope"})).await.err().unwrap().to_string().contains("no connector nope"));
    assert!(h.act("desk", "model.discover", &json!({"connector": "echo", "key_env": "lower"})).await.err().unwrap().to_string().contains("NAME"));
    assert!(h.act("desk", "model.discover", &json!({"connector": "echo", "api_key": "x"})).await.is_err());
    // another base_url: nothing saved there yet
    let got = h.act("desk", "model.discover", &json!({"connector": "echo", "base_url": "http://x/v1"})).await.unwrap();
    assert_eq!(got["already"], json!([]));
    h.shutdown().await.unwrap();
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn slugs_of_names() {
    for (n, s) in [("claude-sonnet-5-5", "claude-sonnet-5-5"), ("gpt-5.1", "gpt-5-1"), ("mlx-community/Qwen3-30B", "mlx-community-qwen3-30b"), ("  ", "model")] {
        assert_eq!(desk::slug_of(n), s);
    }
}

#[test]
fn key_shapes() {
    for k in ["sk-ant-api03-abcdefghijkl", "ghp_abcdefghijklmnopqrstu", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7"] {
        assert!(desk::looks_like_key(k), "{k}");
    }
    for ok in ["claude-sonnet-5-5", "http://127.0.0.1:8000/v1", "ANTHROPIC_API_KEY", "mlx-community/Qwen3-30B-A3B-Instruct-2507-4bit", "sonnet"] {
        assert!(!desk::looks_like_key(ok), "{ok}");
    }
}
