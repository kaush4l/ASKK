//! `SpaceInspector` — the workspace as a person can see it: the folder's path,
//! the settled facts, the noticeboard (plan, "UI shape"; Python counterpart
//! `core/space.py`). Its own module, like every other panel.
//!
//! It shows THIS process's space, read back from the shared store on every pass
//! — a fact a sub-agent recorded in its own Worker appears without being asked.

use agent::{Space, NOTE_LIMIT};
use kernel::{ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("space".into()),
        name: "Shared facts and notes".into(),
        version: Version(1),
        description: "The facts and notes every agent in this space shares.".into(),
        capabilities: vec![],
        routes: vec![RouteSpec {
            method: "GET".into(),
            path: "/space".into(),
        }],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/space/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn space(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        // WHOSE space (09 walk, finding 3): the pane was global, so selecting
        // the one agent with no space still showed "Space: research".
        ("GET", "/space") => panel(ctx, match req.header("x-agent").unwrap_or_default() {
            "" => &ctx.me,
            named => named,
        }),
        _ => error_fragment(404, "space: unknown subroute"),
    }
}

/// WHETHER THE FILES ARE STILL THERE TOMORROW, in the two words that differ.
/// One wording, one place: `scrollback.rs` says the same thing about the same
/// folder, and the two disagreeing is the defect this fn exists to prevent.
pub(crate) fn kept(durable: bool) -> &'static str {
    match durable {
        true => "What is written there survives a reload.",
        false => "This engine's filesystem is in memory: what is written there is GONE when \
                  the page reloads. Settings names the engine and the other one keeps files.",
    }
}

fn line(class: &str, text: &str) -> Fragment {
    FragmentBuilder::new("p").class(class).text(text).build()
}

fn panel(ctx: &Ctx, who: &str) -> Response {
    // The space a person is asking about is the SELECTED agent's, read from
    // its own file. The contents shown are this page's read of the store, so
    // an agent in a DIFFERENT space is named without its facts being guessed.
    let named = ctx
        .agents
        .iter()
        .find(|s| s.name == who)
        .map(|s| s.space.trim().to_string())
        .unwrap_or_default();
    if named.is_empty() {
        return html(
            200,
            line(
                "pending",
                // The fix is `browsable::GIVE_IT_A_SPACE` — written once, so
                // the Workspace pane says the same words (R10-10).
                &format!(
                    "{who}'s file names no space, so it works alone. {}",
                    crate::browsable::GIVE_IT_A_SPACE
                ),
            )
            .into_html(),
        );
    }
    let Some(space) = ctx.space.as_ref().filter(|s| s.name == named) else {
        return html(
            200,
            line(
                "pending",
                &format!(
                    "{who} works in the {named} space. This page reads the {} \
                     space, so what is in {named} is not shown here.",
                    ctx.space.as_ref().map(|s| s.name.clone()).unwrap_or_else(|| "no".into())
                ),
            )
            .into_html(),
        );
    };
    let footer = format!(
        "Facts and notes are read fresh into every agent's prompt before every turn, so \
         nobody has to be told they changed. The board keeps the newest {NOTE_LIMIT} notes."
    );
    let panel = FragmentBuilder::new("div")
        .id("space")
        .attr("data-agent", who)
        .attr("data-space", &space.name)
        .attr("data-facts", &space.facts.len().to_string())
        .attr("data-notes", &space.notes.len().to_string())
        .child(line(
            "space-name",
            &format!(
                "Space: {} — {who} works here, with every other agent whose file names \
                 it. What they share is the facts and notes below; the folder is this \
                 page's own.",
                space.name
            ),
        ))
        .child(line(
            "space-path",
            // ONE FACT, ONE WORDING (R5-14): the terminal's own disclosure
            // says this in exactly these words.
            &format!(
                "{who}'s folder: {} — a real folder in the Linux that Commands runs in. \
                 Files an agent writes go there, not into the facts and notes above. {}",
                space.path(),
                kept(ctx.durable)
            ),
        ))
        .child(facts(space))
        .child(notes(space))
        .child(line("note", &footer));
    html(200, panel.build().into_html())
}

/// The settled facts — a definition list, because that is what a key and its
/// value are, and a screen reader says "key, value" rather than reading two
/// unrelated paragraphs.
fn facts(space: &Space) -> Fragment {
    if space.facts.is_empty() {
        return line("pending", "No shared facts yet.");
    }
    let mut list = FragmentBuilder::new("dl").class("space-facts");
    for (key, value) in &space.facts {
        list = list
            .child(FragmentBuilder::new("dt").text(key).build())
            .child(FragmentBuilder::new("dd").text(value).build());
    }
    FragmentBuilder::new("section")
        .attr("aria-label", "Shared facts")
        .child(FragmentBuilder::new("h3").text("Shared facts").build())
        .child(list.build())
        .build()
}

/// One note, with its AUTHOR as an element rather than as four characters
/// inside the sentence. The stored line is `[main] …` because that is what the
/// model must read in its prompt; a person scanning a column of them could not
/// find who wrote what (09 walk, finding 4), so here the name is marked up,
/// carried on `data-author`, and the note reads as a note.
fn note_row(note: &str) -> Fragment {
    let split = note
        .strip_prefix('[')
        .and_then(|rest| rest.split_once("] "))
        .map(|(author, said)| (author.to_string(), said.to_string()));
    let Some((author, said)) = split else {
        return FragmentBuilder::new("li").text(note).build();
    };
    FragmentBuilder::new("li")
        .attr("data-author", &author)
        .child(
            FragmentBuilder::new("span")
                .class("note-author")
                .text(&format!("{author}: "))
                .build(),
        )
        .child(FragmentBuilder::new("span").class("note-said").text(&said).build())
        .build()
}

/// The noticeboard, oldest first — each note already carries the name of the
/// agent that left it, because the tool bound the author, not the model.
fn notes(space: &Space) -> Fragment {
    if space.notes.is_empty() {
        return line("pending", "No notes yet.");
    }
    let mut list = FragmentBuilder::new("ul").class("space-notes");
    for note in &space.notes {
        list = list.child(note_row(note));
    }
    FragmentBuilder::new("section")
        .attr("aria-label", "Recent notes")
        .child(FragmentBuilder::new("h3").text("Recent notes").build())
        .child(list.build())
        .build()
}
