//! The design rules by structure: every kind's four views and every seeded page tree name scale steps only;
//! raw values are refused with a clear error (docs/design-rules.md §10).

use super::*;
use crate::design::{check_theme, check_tree, migrate_theme, migrate_tree, raw_value, tokens};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

static N: AtomicUsize = AtomicUsize::new(0);

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("askk-design-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = fs::remove_dir_all(&dir);
    dir
}
fn put(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

fn every_view(v: &Value, out: &mut Vec<(String, Value)>) {
    let id = v["id"].as_str().unwrap_or("?").to_string();
    for s in ["icon", "small", "medium", "large"] {
        out.push((format!("{id}:{s}"), v["views"][s].clone()));
    }
    for k in ["elements", "children"] {
        for x in v[k].as_array().cloned().unwrap_or_default() {
            every_view(&x, out);
        }
    }
}

#[test]
fn every_kind_at_every_size_names_scale_steps_only() {
    let dir = temp("kinds");
    put(&dir, "engines/all/engine.md", "---\ntitle: All\nkind: engine\norder: 1\n---\nEvery kind.\n");
    for (k, cfg) in [
        ("note", ""), ("counter", ""), ("status", ""), ("meter", "config: {max: 10}\n"), ("timer", "config: {seconds: 3}\n"),
        ("model", "config: {connector: echo, id: echo, context: 12000}\n"), ("loop", ""), ("phases", ""), ("tools", "config: {list: [clock.now]}\n"), ("memory", ""),
        ("workflows", "config: {list: [{id: w, phases: [a, b]}]}\n"),
    ] {
        put(&dir, &format!("engines/all/elements/{k}.md"), &format!("---\ntitle: {k}\nkind: {k}\n{cfg}---\nbody\n"));
    }
    assert_eq!(kinds::KINDS.len(), 11, "a new kind joins this test");
    put(&dir, "engines/all/elements/broken.md", "---\ntitle: Broken\nkind: nope\n---\n");
    put(&dir, "engines/all/engines/kid/engine.md", "---\ntitle: Kid\nkind: engine\n---\n");
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let w = rt.world();
    let mut views = vec![];
    for e in w["engines"].as_array().unwrap() {
        every_view(e, &mut views);
    }
    assert!(views.len() >= 4 * 13, "{}", views.len());
    for (at, v) in &views {
        assert!(v.is_object(), "{at}: missing view");
        check_tree(v).unwrap_or_else(|e| panic!("{at}: {e}"));
    }
}

#[test]
fn seeded_page_trees_and_theme_follow_the_rules() {
    for v in VIEWS {
        check_tree(&default_ui(v)).unwrap_or_else(|e| panic!("{v}: {e}"));
    }
    check_theme(&default_theme()).unwrap();
    assert_eq!(&default_theme(), tokens(), "the seeded theme is the token file");
    let c = &default_ui("canvas")["children"][1]["props"];
    assert_eq!((c["grid"].clone(), c["minimap"].clone(), c["edges"].clone()), (json!(true), json!(true), json!("curve")));
}

#[test]
fn raw_values_are_refused_with_a_clear_error() {
    let bad = [
        (json!({"c": "Stack", "props": {"gap": 8}}), "scale step"),
        (json!({"c": "Stack", "props": {"gap": 1.5}}), "scale step"),
        (json!({"c": "Text", "props": {"value": "12px is fine in text", "size": "14px"}}), "text size"),
        (json!({"c": "Badge", "props": {"label": "x", "tone": "#ff0000"}}), "tone"),
        (json!({"c": "Grid", "props": {"min": 320}}), "width step"),
        (json!({"c": "Card", "props": {"title": "t", "style": "color: red"}}), "raw style"),
        (json!({"c": "Card", "props": {"title": "t", "radius": "8px"}}), "radius step"),
        (json!({"c": "Stack", "children": [{"c": "Text", "props": {"value": "v", "face": "Georgia, serif"}}]}), "font name"),
        (json!({"c": "Button", "props": {"label": "go", "transition": "300ms"}}), "duration"),
        (json!({"c": "Divider", "props": {"ink": "rgb(1 2 3)"}}), "colour"),
        (json!({"c": "Page", "props": {"background": {"fields": [{"at": "16% 8%", "size": "md", "color": "wall-a"}]}}}), "place"),
        (json!({"c": "Page", "props": {"background": {"fields": [{"at": [1, 1], "size": "26vmax", "color": "wall-a"}]}}}), "field size"),
        (json!({"c": "Page", "props": {"background": {"tint": "#123456"}}}), "colour token"),
        (json!({"c": "Canvas", "props": {"edges": "wiggly"}}), "edge style"),
    ];
    for (t, word) in bad {
        let e = check_tree(&t).expect_err(&t.to_string()).to_string();
        assert!(e.contains(word), "{t} → {e}");
    }
    for s in ["12px", "1.5rem", "#fff", "300ms", "2s", "rgb(0 0 0)", "Georgia, serif", "50%"] {
        assert!(raw_value(s).is_some(), "{s}");
    }
    for s in ["md", "busy", "wall-a", "step 3", "a1", "running", "home/loop"] {
        assert!(raw_value(s).is_none(), "{s}");
    }
}

#[test]
fn ui_and_theme_saves_refuse_raw_values() {
    let dir = temp("save");
    let mut rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let e = rt.set_ui("dashboard", &json!({"c": "Page", "children": [{"c": "CardGrid", "props": {"min": 360}}]})).unwrap_err().to_string();
    assert!(e.contains("min") && e.contains("width step"), "{e}");
    rt.set_ui("dashboard", &json!({"c": "Page", "children": [{"c": "CardGrid", "props": {"min": "lg", "gap": 3}}]})).unwrap();
    for (bad, word) in [(json!({"colors": {}}), "unknown token group"), (json!({"space": {"9": "40px"}}), "not a step"), (json!({"light": {"bg": "red;"}}), "character"), (json!({"motion": {"fast": "fast"}}), "not a valid"), (json!({"space": {"1": "#fff"}}), "not a valid")] {
        let e = rt.set_theme(&bad).unwrap_err().to_string();
        assert!(e.contains(word), "{bad} → {e}");
    }
    rt.set_theme(&json!({"light": {"bg": "#fafafa"}, "space": {"1": "5px"}})).unwrap();
}

#[test]
fn older_trees_and_themes_migrate_to_steps() {
    let old = json!({"c": "Page", "props": {"background": {"fields": [{"at": "16% 8%", "size": "26vmax", "color": "wall-a", "hard": true}], "blur": 12, "dim": 0.3, "tint": "#123"}},
        "children": [{"c": "Panel"}, {"c": "CardGrid", "props": {"min": 360, "gap": 4, "max": 1600}}, {"c": "Canvas", "props": {"zoom": {"icon": 0.35}}}]});
    assert!(check_tree(&old).is_err());
    let m = migrate_tree(&old);
    check_tree(&m).unwrap();
    assert_eq!(m["props"]["background"]["fields"][0]["at"], json!([1, 1]));
    assert_eq!(m["props"]["background"]["fields"][0]["size"], "md");
    assert_eq!(m["props"]["background"]["dim"], 3);
    assert_eq!(m["children"][1]["props"]["min"], "md");
    assert_eq!(m["children"][1]["props"]["max"], "page");
    assert_eq!(m["children"][2]["props"]["edges"], "curve");
    let th = migrate_theme(&json!({"radius": "12px", "face": "Amarante", "light": {"bg": "#eeeeee"}}));
    check_theme(&th).unwrap();
    assert_eq!((th["radius"]["md"].as_str(), th["light"]["bg"].as_str()), (Some("12px"), Some("#eeeeee")));
    // a folder holding an older tree boots with it migrated
    let dir = temp("old");
    put(&dir, "ui/dashboard.json", &old.to_string());
    let rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    check_tree(&rt.world()["ui"]["dashboard"]).unwrap();
    assert_eq!(rt.world()["ui"]["dashboard"]["children"][1]["props"]["min"], "md");
}

#[test]
fn engine_children_defaults_cascade_into_its_views_and_are_written_by_an_action() {
    let dir = temp("cascade");
    put(&dir, "engines/e/engine.md", "---\ntitle: E\nkind: engine\norder: 1\nchildren: { size: icon, kinds: { loop: { size: large } } }\n---\n");
    put(&dir, "engines/e/elements/n.md", "---\ntitle: N\nkind: note\n---\nhi\n");
    put(&dir, "engines/e/elements/l.md", "---\ntitle: L\nkind: loop\n---\n");
    put(&dir, "engines/bad/engine.md", "---\ntitle: Bad\nkind: engine\nchildren: { size: 300px }\n---\n");
    let mut rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let e = rt.twin("e").unwrap();
    assert_eq!(e["children_defaults"]["size"], "icon");
    let medium = e["views"]["medium"].to_string();
    assert!(medium.contains(r#""at":"icon","of":"e/n""#) || medium.contains(r#""of":"e/n","at":"icon""#), "{medium}");
    assert!(medium.contains(r#""at":"large","of":"e/l""#) || medium.contains(r#""of":"e/l","at":"large""#), "{medium}");
    check_tree(&e["views"]["medium"]).unwrap();
    assert_eq!(rt.twin("bad").unwrap()["phase"], "failed", "a raw size in children: is refused");
    rt.act("e", "engine.children", &json!({ "size": "small" })).unwrap();
    assert!(fs::read_to_string(dir.join("engines/e/engine.md")).unwrap().contains("small"));
    assert_eq!(rt.twin("e").unwrap()["children_defaults"]["size"], "small");
    assert!(rt.act("e", "engine.children", &json!({ "size": "huge" })).is_err());
    rt.act("e", "engine.children", &json!({ "size": "auto", "kinds": {} })).unwrap();
    assert_eq!(rt.twin("e").unwrap()["children_defaults"], Value::Null);
}

#[test]
fn every_object_has_an_avatar_from_its_icon_or_its_kind() {
    let dir = temp("avatar");
    put(&dir, "engines/e/engine.md", "---\ntitle: Explorer\nkind: engine\norder: 1\nicon: 🧪\n---\n");
    put(&dir, "engines/e/elements/m.md", "---\ntitle: M\nkind: model\nconfig: {connector: echo, id: echo}\n---\n");
    put(&dir, "engines/e/elements/l.md", "---\ntitle: L\nkind: loop\nicon: 🌀\n---\n");
    put(&dir, "engines/e/elements/bad.md", "---\ntitle: Bad\nkind: note\nicon: hello\n---\n");
    put(&dir, "engines/plain/engine.md", "---\ntitle: Plain\nkind: engine\norder: 2\n---\n");
    let mut rt = boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap();
    let defaults = [("note", "📝"), ("counter", "🔢"), ("status", "🚦"), ("meter", "📊"), ("timer", "⏱️"), ("model", "🧠"), ("loop", "🔁"), ("phases", "🪜"), ("tools", "🧰"), ("memory", "📚")];
    for (k, e) in defaults {
        assert_eq!(kinds::find(k).unwrap().avatar(), e, "{k}");
    }
    let m = rt.twin("e/m").unwrap();
    assert_eq!(m["icon"], "🧠", "kind default");
    assert_eq!(m["views"]["icon"]["children"], json!([{ "c": "Avatar", "props": { "icon": "🧠", "label": "M", "phase": "idle", "tone": "neutral" } }]), "the icon size is the avatar alone");
    assert_eq!(m["views"]["medium"]["props"]["icon"], "🧠", "bigger sizes carry it in their header");
    assert_eq!(rt.twin("e/l").unwrap()["icon"], "🌀", "icon: overrides");
    assert_eq!(rt.twin("e").unwrap()["icon"], "🧪");
    assert_eq!(rt.twin("plain").unwrap()["icon"], "🧭", "engine default");
    assert_eq!(rt.twin("e/bad").unwrap()["phase"], "failed", "icon must be an emoji");
    for (s, ok) in [("🧭", true), ("⏱️", true), ("👩‍💻", true), ("/ui/assets/a.png", true), ("hello", false), ("12px", false), ("", false), ("/ui/assets/../x", false)] {
        assert_eq!(crate::design::check_icon(s).is_ok(), ok, "{s}");
    }
    rt.act("e", "element.edit", &json!({ "id": "e/m", "icon": "🦉" })).unwrap();
    assert_eq!(rt.twin("e/m").unwrap()["icon"], "🦉");
    assert!(rt.act("e", "element.edit", &json!({ "id": "e/m", "icon": "x" })).is_err());
    rt.act("plain", "engine.edit", &json!({ "icon": "🛰️" })).unwrap();
    assert_eq!(rt.twin("plain").unwrap()["icon"], "🛰️");
    rt.act("e", "element.edit", &json!({ "id": "e/m", "icon": "" })).unwrap();
    assert_eq!(rt.twin("e/m").unwrap()["icon"], "🧠");
    for v in ["icon", "small", "medium", "large"] {
        check_tree(&rt.twin("e").unwrap()["views"][v]).unwrap();
    }
}
