//! `Files` — the workspace folder, browsable (15G). It owns no capability:
//! every listing and every read is the `list_files` / `read_file` tool going
//! through the gate the agent's own calls do, so the pane is a projection of
//! `ToolInvoked` facts (I8) and an agent working here updates it as it goes.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::listing::{follow, read, served, Listing};
use crate::ui::Card;

/// One read of the folder this pane is on, and of no other.
fn here(at: &str) -> Request {
    Request::get("/files").with_header("x-at", at)
}

#[component]
pub fn Files(
    web: Signal<Option<Rc<WebApp>>>,
    /// Bumped by every projection, which is what makes an agent's own writes
    /// appear here while it is still working.
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// WHICH FOLDER THIS PANE IS ON (`x-at`, R4-2). The RAIL's signal rather
    /// than this pane's, because the Processes pane points it at a process's
    /// own folder to open a log (R10-6): one editor in this view.
    mut at: Signal<String>,
) -> Element {
    let mut panel = use_signal(Listing::default);
    // One watcher at a time: each tick is a full trip through the seam.
    let watching = use_signal(|| false);
    // WATCH for the listing the async half is producing, asking for no second
    // one — `listing::follow` owns the loop (I12).
    let watch = move || follow(web, agent, at, panel, watching);
    // One handler per row, told the PATH rather than an index into a list it
    // would have to rebuild to interpret. The crumbs press it too (R16-P1-4).
    let mut open = move |(path, folder): (String, bool)| {
        if folder {
            at.set(path.clone());
        }
        // The listing runs in the async half, so this watches for a CHANGE
        // rather than quiet: a cold page takes as long as the disk does.
        panel.set(read(
            web,
            &agent(),
            Request::post_form(
                "/files",
                &[("path", path.as_str()), ("kind", if folder { "folder" } else { "file" })],
            ),
        ));
        // …against what the POST answered: it is scoped to the NEW folder.
        watch();
    };
    // The projection, and WHEN to ask the workspace for a new one (R3-19).
    // Re-reading on every tick shows the agent's own `list_files`; ASKING is
    // gated on WHAT HAS HAPPENED IN THE WORKSPACE — `x-workspace-at`, the count
    // of `exec` and `write_file` facts, which rides the listing this pane
    // already reads, so there is no second clock and no extra trip. IT USED TO
    // BE THE AGENT'S STATUS STAMP (R14-P1-3), which a person typing into the
    // Commands box never moves: the command ran, the Commands pane showed the
    // file in its own `ls -la`, and this pane went on showing the listing from
    // before it. The log is what both panes project, so both follow it.
    let mut listed_at = use_signal(|| None::<usize>);
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        // `peek`, never a read: `open` below writes it, and an effect that
        // subscribed to it would re-run itself for ever.
        let folder = at.peek().clone();
        panel.set(read(web, &agent(), here(&folder)));
        // NOT FOR AN AGENT WHOSE FOLDER THIS IS NOT (R7-4). The core answers
        // the GET with an ordinary grey sentence and REFUSES the POST, so asking
        // anyway painted a normal configuration in error red. R5-1's guard.
        if !served(&panel.peek().html) {
            return;
        }
        let now = panel.peek().stamp;
        if *listed_at.peek() == Some(now) {
            return;
        }
        listed_at.set(Some(now));
        // BOUND FIRST: `open((at.peek().clone(), …))` holds the borrow across
        // the call, and `open` writes `at` — a RefCell panic at mount.
        let folder = at.peek().clone();
        let mut open = open;
        open((folder, true));
    });
    // What the editor holds, and for which file. `None` means "showing what is
    // on disk": a draft belongs to one path, and switching files must not carry
    // your edit to the next one.
    let mut draft = use_signal(|| None::<(String, String)>);
    let shown = panel.read().clone();
    let editing = draft.read().clone().filter(|(path, _)| *path == shown.open);
    let text = match &editing {
        Some((_, text)) => text.clone(),
        None => shown.body.clone(),
    };
    let dirty = editing.is_some() && text != shown.body;
    let mut save = move |path: String, text: String| {
        let Some(app) = web.peek().clone() else { return };
        app.handle(
            Request::post_form("/files", &[("path", path.as_str()), ("contents", text.as_str())])
                .with_header("x-agent", &agent()),
        );
        draft.set(None);
        // The write and the re-read BOTH happen in the async half, so this only
        // watches: asking logged the same call twice (R5-12) — `path` unused.
        let _ = path;
        watch();
    };
    // WHETHER THIS AGENT HAS A FOLDER HERE AT ALL (R5-1): no root button to
    // press and no editor to type in when the core will not serve one.
    let browsable = served(&shown.html);
    rsx! {
        // Named for the view it is in, so the nav confirms the click (F6).
        Card { title: "Files", aria_label: "Files in the folder",
            div { class: "file-form",
                if browsable {
                    // WHERE YOU ARE (R16-P1-4), pressing the rows' own handler.
                    crate::crumbs::Crumbs { at: at(), on_open: move |path: String| open((path, true)) }
                    button {
                        class: "file-entry root",
                        onclick: move |_| open((".".to_string(), true)),
                        "⟳ List the whole folder"
                    }
                }
                // A SELECTED STATE (R5-9): no class, no `aria-current`, no
                // weight said which row was open. `.file-entry.current` has
                // been in `workspace.css` since the artifact shelf; this pane
                // simply never asked for it.
                div { class: "file-list", aria_label: "Entries",
                    for item in shown.entries.iter().cloned() {
                        button {
                            key: "{item.path}",
                            class: match (item.path == shown.open, item.name.ends_with('/')) {
                                (true, _) => "file-entry current",
                                (false, true) => "file-entry folder",
                                (false, false) => "file-entry",
                            },
                            aria_current: (item.path == shown.open).then_some("true"),
                            onclick: move |_| open((item.path.clone(), item.name.ends_with('/') || item.name == "..")),
                            "{item.name}"
                        }
                    }
                }
                div { aria_live: "polite", dangerous_inner_html: "{shown.html}" }
                // The editor: "you can change what the agent wrote and save
                // it", not an IDE — and READ-ONLY for a machine record
                // (R11-12). `fileedit.rs` owns both modes.
                if browsable && !shown.open.is_empty() {
                    crate::fileedit::FileEdit {
                        open: shown.open.clone(),
                        text: text.clone(),
                        dirty,
                        on_input: {
                            let path = shown.open.clone();
                            move |v: String| draft.set(Some((path.clone(), v)))
                        },
                        on_discard: move |_| draft.set(None),
                        on_save: move |(path, body): (String, String)| save(path, body),
                    }
                }
            }
        }
    }
}
