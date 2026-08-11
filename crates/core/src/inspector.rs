//! `SpaceInspector` — the shared space as a person can see it: the workspace
//! path, the settled facts, the noticeboard (plan, "UI shape"; Python
//! counterpart `core/space.py`). Its own module, like every other panel, so
//! the component that owns facts and notes owns nothing else.
//!
//! It shows THIS process's space, read back from the shared store on every
//! pass — so a fact a sub-agent recorded in its own Worker appears here
//! without the page being told to look.

use agent::{Space, NOTE_LIMIT};
use kernel::{ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("space".into()),
        name: "Shared space".into(),
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
        ("GET", "/space") => panel(ctx),
        _ => error_fragment(404, "space: unknown subroute"),
    }
}

fn line(class: &str, text: &str) -> Fragment {
    FragmentBuilder::new("p").class(class).text(text).build()
}

fn panel(ctx: &Ctx) -> Response {
    let Some(space) = &ctx.space else {
        return html(
            200,
            line(
                "pending",
                "This agent's file names no space, so it works alone. Add `space: <name>` \
                 to public/agents/<agent>/agent.md to put it in one.",
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
        .attr("data-space", &space.name)
        .attr("data-facts", &space.facts.len().to_string())
        .attr("data-notes", &space.notes.len().to_string())
        .child(line(
            "space-name",
            &format!(
                "Space: {} — shared with every agent whose file names it.",
                space.name
            ),
        ))
        .child(line(
            "space-path",
            &format!(
                "Workspace: {} — named, not writable from this browser yet.",
                space.path()
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

/// The noticeboard, oldest first — each note already carries the name of the
/// agent that left it, because the tool bound the author, not the model.
fn notes(space: &Space) -> Fragment {
    if space.notes.is_empty() {
        return line("pending", "No notes yet.");
    }
    let mut list = FragmentBuilder::new("ul").class("space-notes");
    for note in &space.notes {
        list = list.child(FragmentBuilder::new("li").text(note).build());
    }
    FragmentBuilder::new("section")
        .attr("aria-label", "Recent notes")
        .child(FragmentBuilder::new("h3").text("Recent notes").build())
        .child(list.build())
        .build()
}
