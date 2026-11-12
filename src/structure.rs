//! # Structure: the walls between the folders, as tests
//!
//! The folders are the map (see `main.rs`). These tests fail the build's test run when a line
//! of code sits in the wrong place, so the map stays true without anyone remembering it.
use std::path::{Path, PathBuf};

/// Every source file as (`path under src`, text without its test module).
fn sources() -> Vec<(String, String)> {
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(d).unwrap().flatten() {
            if e.path().is_dir() {
                walk(&e.path(), out)
            } else if e.path().extension().is_some_and(|x| x == "rs") {
                out.push(e.path())
            }
        }
    }
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![];
    walk(&src, &mut files);
    files
        .into_iter()
        .map(|f| {
            let rel = f.strip_prefix(&src).unwrap().to_string_lossy().replace('\\', "/");
            let text = std::fs::read_to_string(&f).unwrap();
            // Test code may reach across walls (temp files, fixtures): a test module ends the
            // file's code, and a single item marked `#[cfg(test)]` is left out up to its closing
            // brace. Any other `cfg` line is ordinary code.
            let lines: Vec<&str> = text.lines().collect();
            let mut code: Vec<&str> = vec![];
            let mut i = 0;
            while i < lines.len() {
                let l = lines[i];
                let t = l.trim_start();
                if t.starts_with("#[cfg(test)]") || t.starts_with("#[cfg(all(test") {
                    if lines.get(i + 1).is_some_and(|n| n.contains("mod ")) {
                        break;
                    }
                    let close = format!("{}}}", &l[..l.len() - t.len()]);
                    while i < lines.len() && lines[i] != close {
                        i += 1;
                    }
                } else if !t.starts_with("//") {
                    code.push(l);
                }
                i += 1;
            }
            (rel, code.join("\n"))
        })
        .filter(|(rel, _)| rel != "structure.rs")
        .collect()
}

/// `needle` appears only in files under one of `homes`.
fn only_in(needle: &str, homes: &[&str], why: &str) {
    for (rel, code) in sources() {
        if homes.iter().any(|h| rel == *h || rel.starts_with(&format!("{h}/"))) {
            continue;
        }
        if let Some(n) = code.lines().position(|l| l.contains(needle)) {
            panic!("{rel}:{}: `{needle}` belongs in {homes:?}: {why}", n + 1);
        }
    }
}

/// No file under `folder` mentions `needle`.
fn never_in(folder: &str, needle: &str, why: &str) {
    for (rel, code) in sources() {
        if rel.starts_with(&format!("{folder}/")) {
            if let Some(n) = code.lines().position(|l| l.contains(needle)) {
                panic!("{rel}:{}: `{needle}` is not allowed in {folder}/: {why}", n + 1);
            }
        }
    }
}

#[test]
fn the_top_level_is_the_map() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut top: Vec<String> = std::fs::read_dir(src).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    top.sort();
    assert_eq!(top, ["api", "core", "elements", "host", "local", "main.rs", "shells", "structure.rs", "ui"], "a new top-level folder is a new idea: add it to the map in main.rs first");
}

#[test]
fn the_core_is_the_plain_language() {
    for folder in ["core", "elements", "host"] {
        never_in(folder, "dioxus", "the UI library draws; it does not decide");
    }
}

#[test]
fn the_wire_is_one_folder() {
    only_in("#[server]", &["api"], "a window asks the host only through api/");
}

#[test]
fn only_the_api_reaches_the_host() {
    for folder in ["core", "elements", "ui", "shells"] {
        never_in(folder, "crate::host", "core and elements do not know the machine; ui and shells ask through api/");
    }
}

#[test]
fn the_core_does_not_know_who_draws_or_asks() {
    for folder in ["core", "elements", "host"] {
        for needle in ["crate::ui", "crate::api", "crate::shells", "crate::local"] {
            never_in(folder, needle, "dependencies point inward: shells → ui → api → host → elements → core");
        }
    }
}

#[test]
fn only_the_host_touches_the_machine() {
    for folder in ["core", "elements", "api", "ui", "shells"] {
        for needle in ["std::fs::", "tokio::fs::", "process::Command", ".is_file()", ".is_dir()", ".exists()", "read_dir(", ".metadata(", "canonicalize("] {
            never_in(folder, needle, "disk and processes are the host's; the rest goes through a port (core/store.rs, core/files.rs)");
        }
    }
}

#[test]
fn places_is_the_only_reader_of_the_environment() {
    only_in("env::var", &["core/places.rs"], "every root and secret is named once");
    only_in("ASKK_", &["core/places.rs"], "every root and secret is named once");
}

#[test]
fn each_mac_face_is_one_file() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/shells/mac");
    let mut faces: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    faces.sort();
    assert_eq!(faces, ["companion.rs", "dock.rs", "mod.rs", "notch.rs", "tray.rs", "window.rs"], "a new face is a new file here and a new field in core/surfaces.rs");
}

#[test]
fn no_harness_is_named_outside_its_adapter() {
    for name in ["\"claude\"", "\"codex\"", "\"muse\""] {
        only_in(name, &["host/harness"], "a harness kind is one file there; the rest of the app learns the kinds by asking");
    }
}

// ---- Rules that keep one core good for every build (docs/maintenance.md) ----

#[test]
fn the_core_names_no_runtime() {
    for folder in ["core", "elements"] {
        for needle in ["tokio::", "std::thread", "wasm_bindgen", "web_sys"] {
            never_in(folder, needle, "how work is run differs per build: hand it to a port (core/tasks.rs) and let host/ or local/ run it");
        }
    }
}

#[test]
fn the_core_does_not_know_the_build() {
    for folder in ["core", "elements"] {
        for needle in ["cfg(feature", "cfg(not(feature", "cfg(any(feature", "cfg(all(feature"] {
            never_in(folder, needle, "code that exists in one build only does nothing, silently, in the others: the core is the same in every build, and what differs sits behind a port");
        }
    }
}

#[test]
fn the_tab_is_a_host_and_nothing_else_knows_it() {
    // The page the tab draws for itself may use the features (plain values and words, the
    // same ones every UI shows), but no other UI's drawing.
    for needle in ["crate::host", "crate::ui::web", "crate::ui::terminal", "crate::shells"] {
        never_in("local", needle, "the tab stands where host/ stands: it may use core and elements, and its page asks through api/ and reads ui/features like any window");
    }
    for folder in ["api", "ui", "shells"] {
        never_in(folder, "crate::local", "a window asks through api/, whoever the host is");
    }
}

// ---- Rules for a service that never stops ----

#[test]
fn a_lock_never_stops_the_service() {
    for needle in [".lock().unwrap()", ".read().unwrap()", ".write().unwrap()", ".lock().expect("] {
        only_in(needle, &[], "a panic while a lock is held would make every later use panic too: take it with held() (core/held.rs)");
    }
}

/// How often the code under `folder` may stop the program instead of returning an error.
fn stops(folder: &str) -> Vec<String> {
    let mut out = vec![];
    for (rel, code) in sources() {
        if !rel.starts_with(&format!("{folder}/")) {
            continue;
        }
        for (n, l) in code.lines().enumerate() {
            if [".unwrap()", ".expect(", "panic!(", "unreachable!(", "todo!(", "unimplemented!("].iter().any(|p| l.contains(p)) {
                out.push(format!("{rel}:{}: {}", n + 1, l.trim()));
            }
        }
    }
    out
}

/// A debt list: a number may go down (then lower it here), never up.
#[test]
fn errors_are_returned_not_thrown() {
    let mut wrong = vec![];
    for (folder, most) in [("core", 10), ("elements", 1), ("host", 10), ("api", 4), ("ui", 0), ("shells", 0), ("local", 0)] {
        let found = stops(folder);
        if found.len() > most {
            wrong.push(format!("{folder}/ may stop the program in at most {most} places and does in {}. Return the error with its reason instead (`?`, `map_err`), so the service keeps running and says what went wrong:\n  {}", found.len(), found.join("\n  ")));
        } else if found.len() < most {
            wrong.push(format!("{folder}/ is down to {} such places: lower its number in structure.rs so it stays there", found.len()));
        }
    }
    assert!(wrong.is_empty(), "\n{}", wrong.join("\n"));
}

// ---- Rules that keep a file readable in one sitting ----

/// Lines of code in a file, without its tests and comments.
fn size(code: &str) -> usize {
    code.lines().filter(|l| !l.trim().is_empty()).count()
}

#[test]
fn a_file_is_read_in_one_sitting() {
    const MOST: usize = 450;
    // Files already longer: each may shrink (then lower or remove its line), never grow.
    let debts = [("core/engine.rs", 608)];
    let mut wrong = vec![];
    for (rel, code) in sources() {
        let n = size(&code);
        let most = debts.iter().find(|(f, _)| *f == rel).map(|(_, m)| *m).unwrap_or(MOST);
        if n > most {
            wrong.push(format!("{rel} has {n} lines of code (most: {most})"));
        }
    }
    assert!(wrong.is_empty(), "\n{}\nA file answers one question: split it by the questions it answers, and add the new file to the table in its folder's mod.rs", wrong.join("\n"));
}

// ---- Rules for the UI: a page is a value, a view is a template ----

#[test]
fn every_view_a_page_may_name_is_drawn() {
    let (_, draws) = sources().into_iter().find(|(rel, _)| rel == "ui/web/views/mod.rs").expect("ui/web/views/mod.rs");
    for name in crate::core::node::VIEWS {
        assert!(draws.contains(&format!("\"{name}\" =>")), "the view `{name}` is in core::node::VIEWS, so a page may name it, but ui/web/views/mod.rs (`Builtin`) does not draw it");
    }
}

#[test]
fn a_feature_draws_nothing() {
    // ui/features says what a person can do, in plain values and words. How it is shown (a
    // page, lines in a terminal) is decided by the UI that shows it, so no drawing library
    // and no other UI may be named here.
    never_in("ui/features/", "dioxus", "a feature is plain values and words; drawing belongs to ui/web");
    never_in("ui/features/", "rsx!", "a feature is plain values and words; drawing belongs to ui/web");
    never_in("ui/features/", "crate::ui::web", "a feature does not know which UI shows it");
    never_in("ui/features/", "crate::ui::terminal", "a feature does not know which UI shows it");
}

#[test]
fn the_terminal_is_lines_only() {
    // The terminal shows the same features as text. It draws no page, knows no other UI, and
    // like every UI it asks through api/ and never reaches the host itself.
    never_in("ui/terminal/", "dioxus", "the terminal writes lines; pages belong to ui/web");
    never_in("ui/terminal/", "crate::ui::web", "the terminal and the pages share features, not each other");
    never_in("ui/terminal/", "crate::host", "a UI asks through api/");
}

/// The questions (functions) of `crate::api` that `code` names. A shape (`ChatTurn`, `Mode`)
/// starts with a capital letter and is not a question; a function does not.
fn asks(code: &str) -> Vec<String> {
    let mut out = vec![];
    for (at, _) in code.match_indices("crate::api::") {
        let rest = &code[at + "crate::api::".len()..];
        // `crate::api::{a, B}` names several things; `crate::api::a` names one.
        let names: Vec<&str> = match rest.strip_prefix('{') {
            Some(list) => list.split('}').next().unwrap_or_default().split(',').collect(),
            None => vec![rest.split(|c: char| !(c.is_alphanumeric() || c == '_')).next().unwrap_or_default()],
        };
        out.extend(names.into_iter().map(str::trim).filter(|n| n.chars().next().is_some_and(|c| c.is_lowercase())).map(String::from));
    }
    out
}

#[test]
fn a_component_only_shows_what_it_is_given() {
    // A component (ui/web/components) and a kit part (ui/web/kit) are given the object and the
    // values they show, and draw them. They do not ask the service, do not wait for an answer,
    // do not reach into a view, and a component reads nothing shared behind its back. A view
    // asks and hands the answer down. Naming a shape from api/ or core/ for what a component
    // is given (`Run`, `Mode`, `Chip`) is not asking, and is allowed.
    //
    // A debt list, the same way as the others: a file's number may go down, never up.
    let debts: [(&str, usize); 0] = [];
    let mut wrong = vec![];
    for (rel, code) in sources() {
        let component = rel.starts_with("ui/web/components/");
        if !component && !rel.starts_with("ui/web/kit/") {
            continue;
        }
        let mut found: Vec<String> = asks(&code).into_iter().map(|q| format!("asks `crate::api::{q}`")).collect();
        for (needle, why) in [
            ("use_server_future", "waits for an answer from the service"),
            ("use_resource", "waits for an answer"),
            ("use_live", "listens to the service"),
            ("crate::ui::web::views", "reaches into a view"),
            ("GlobalSignal", "reads something shared by the whole app"),
            ("Signal::global", "reads something shared by the whole app"),
        ] {
            found.extend(code.lines().filter(|l| l.contains(needle)).map(|_| format!("{why} (`{needle}`)")));
        }
        // A kit part made of several pieces shares its own state between them; a component of
        // this app is handed what it needs.
        if component {
            found.extend(code.lines().filter(|l| l.contains("use_context")).map(|_| "reads something shared behind its back (`use_context`)".to_string()));
        }
        let most = debts.iter().find(|(f, _)| *f == rel).map(|(_, m)| *m).unwrap_or(0);
        if found.len() > most {
            wrong.push(format!("{rel} breaks the rule in {} places (most: {most}):\n    {}", found.len(), found.join("\n    ")));
        } else if found.len() < most {
            wrong.push(format!("{rel} is down to {} such places: lower its number in structure.rs", found.len()));
        }
    }
    assert!(wrong.is_empty(), "\n{}\nA component takes the object and the values to show as its props. Ask in the view (ui/web/views) and hand the answer down; take the words about a run from ui/features", wrong.join("\n"));
    assert_eq!(asks("use crate::api::{media_picture, Chip};\nlet a = crate::api::engine_paths();\nuse crate::api::Mode;"), ["media_picture", "engine_paths"], "the check itself tells a question from a shape");
}

#[test]
fn the_kit_is_standard_parts_and_nothing_else() {
    // A kit part (ui/web/kit) is a standard part taken from a registry. It knows nothing of this
    // app (no api, no core, no component of ours), it says where it came from, and it names
    // tokens, never a colour of its own, so one theme change reaches every part.
    let mut wrong = vec![];
    for (rel, code) in sources() {
        if !rel.starts_with("ui/web/kit/") || rel == "ui/web/kit/mod.rs" {
            continue;
        }
        // The whole file, comments too (`sources` leaves comments out).
        let whole = std::fs::read_to_string(Path::new("src").join(&rel)).unwrap_or_default();
        if !whole.starts_with("//! From rust-ui.com") {
            wrong.push(format!("{rel}: the first line must say where the part came from"));
        }
        for banned in ["crate::api", "crate::core", "crate::host", "crate::local", "crate::ui::web::components", "crate::ui::web::views"] {
            if code.contains(banned) {
                wrong.push(format!("{rel}: a kit part must not know `{banned}`"));
            }
        }
        for colour in ["oklch(", "rgb(", "hsl(", "-[#"] {
            if code.contains(colour) {
                wrong.push(format!("{rel}: `{colour}` is a colour of its own; name a token (see tailwind.css)"));
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn looks_live_in_the_stylesheet() {
    // Inline style is for a number worked out at run time (a position, a size). These files
    // have such numbers; the count may go down, never up, and no other file gets any.
    let debts = [("ui/web/figure.rs", 11), ("ui/web/views/canvas.rs", 2), ("ui/web/views/prompt.rs", 2), ("ui/web/render.rs", 1), ("ui/web/app.rs", 1), ("ui/web/views/companion.rs", 1), ("ui/web/views/loops.rs", 1), ("ui/web/views/ide.rs", 1)];
    let mut wrong = vec![];
    for (rel, code) in sources() {
        if !rel.starts_with("ui/") {
            continue;
        }
        let n = code.lines().filter(|l| l.contains("style:")).count();
        let most = debts.iter().find(|(f, _)| *f == rel).map(|(_, m)| *m).unwrap_or(0);
        if n > most {
            wrong.push(format!("{rel} sets `style:` in {n} places (most: {most})"));
        }
    }
    assert!(wrong.is_empty(), "\n{}\nGive the element a class and put the look in assets/styling, so every page changes together", wrong.join("\n"));
}

/// Every question as (`answers file`, `name`): the `pub async fn`s of the answers files.
fn questions() -> Vec<(String, String)> {
    let mut out = vec![];
    for (rel, code) in sources() {
        if rel.starts_with("api/") && rel.ends_with("answers.rs") {
            for l in code.lines() {
                if let Some(name) = l.strip_prefix("pub async fn ").and_then(|n| n.split('(').next()) {
                    out.push((rel.clone(), name.to_string()));
                }
            }
        }
    }
    out
}

#[test]
fn every_question_can_be_asked_by_any_ui() {
    let all = sources();
    let (_, table) = all.iter().find(|(rel, _)| rel == "api/ask.rs").expect("api/ask.rs");
    let mut missing = vec![];
    let found = questions();
    assert!(found.len() > 50, "the answers files were not found where this test looks (api/answers.rs, api/<file>/answers.rs)");
    for (rel, name) in found {
        // The answers of `api/talk/answers.rs` are wired in `api/talk.rs`; those of `api/answers.rs` in `api/mod.rs`.
        let wired_in = if rel == "api/answers.rs" { "api/mod.rs".to_string() } else { rel.replace("/answers.rs", ".rs") };
        let (_, wire) = all.iter().find(|(r, _)| *r == wired_in).expect("the file that wires these answers");
        if !wire.contains(&format!("    {name}(")) {
            missing.push(format!("{name}: no line in `wire!` in {wired_in}, so no Dioxus window can ask it"));
        }
        if !table.contains(&format!(" {name}(")) {
            missing.push(format!("{name}: no line in the table in api/ask.rs, so no other UI can ask it"));
        }
    }
    assert!(missing.is_empty(), "an answer in {{api}}/answers.rs needs one line in each list:\n{}", missing.join("\n"));
}

#[test]
fn an_answer_is_a_plain_function() {
    for (rel, code) in sources() {
        if rel.starts_with("api/") && rel.ends_with("answers.rs") {
            for needle in ["dioxus", "ServerFnError", "#[server]", "axum"] {
                if let Some(n) = code.lines().position(|l| l.contains(needle)) {
                    panic!("{rel}:{}: `{needle}` in an answers file. An answer is a plain function returning `Result<_, String>`, the same for every UI and every host; the wire is the file beside it", n + 1);
                }
            }
        }
    }
}

/// The answers still reach into `host/` where the core has no port yet. Each such line keeps
/// that answer away from the tab. A debt list: a number may go down, never up.
#[test]
fn the_answers_ask_the_core_not_the_host() {
    let debts = [("api/rooms/answers.rs", 6), ("api/sessions/answers.rs", 4), ("api/talk/answers.rs", 4), ("api/answers.rs", 2), ("api/models/answers.rs", 1)];
    let mut wrong = vec![];
    for (rel, code) in sources() {
        if !rel.starts_with("api/") {
            continue;
        }
        let n = code.lines().filter(|l| l.contains("crate::host")).count();
        let most = debts.iter().find(|(f, _)| *f == rel).map(|(_, m)| *m).unwrap_or(0);
        if n > most {
            wrong.push(format!("{rel} names `crate::host` in {n} lines (most: {most})"));
        } else if n < most {
            wrong.push(format!("{rel} is down to {n} such lines: lower its number in structure.rs"));
        }
    }
    assert!(wrong.is_empty(), "\n{}\nAsk through a port in core/ (as `core/world.rs`, `core/tables.rs` do) and let each host provide it", wrong.join("\n"));
}

// ---- Rules for the service and its clients (docs/service.md) ----

#[test]
fn the_service_is_found_and_ended_in_one_place() {
    // A client learns where the service is from its record, and the record has one reader and
    // one writer. Nothing may stop the service but its owner: the program is ended on purpose
    // only where the command line is read, and where `askk stop` is answered.
    only_in("\"service.json\"", &["host/service.rs"], "the service's record has one reader and writer: ask host/service.rs (`record`, `running`)");
    only_in("process::exit", &["main.rs", "host/service.rs"], "the service runs for as long as the machine does: return the error as a sentence; only `askk stop` (host/service.rs) ends it");
}

#[test]
fn a_hand_edit_is_noticed_and_read_again_in_one_place() {
    // Whether a file was changed by a person is decided by looking at it from outside
    // (host/watch.rs, through the store on disk), and what a changed file means is decided
    // once (core/reread.rs). A second way of noticing would disagree with the first.
    only_in(".stamp(", &["host/watch.rs", "host/store.rs"], "ask `core::reread::reload()`: it looks, reads again, and marks the change for every window");
    only_in("reread::apply(", &["core/reread.rs"], "every reader of the home goes through `core::reread::reload()`, so each change is read and told once");
}

#[test]
fn what_a_new_hello_means_is_decided_once() {
    // Same service, restarted, rebuilt or gone: every UI must decide alike, so no UI compares
    // two hellos itself. It asks `ui/features/service.rs` (`seen`).
    for folder in ["ui/web", "ui/terminal", "shells", "local"] {
        for needle in [".started !=", ".build !=", ".started ==", ".build =="] {
            never_in(folder, needle, "hold the two hellos against each other with `ui::features::service::seen`, as every other UI does");
        }
    }
}
