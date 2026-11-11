//! # Rooms on this machine (server only)
//!
//! Makes a room's seats as sessions, runs a step (each seat that is due is prompted through
//! its own session, one after another, on a task of its own), and asks the desk agent to
//! design a room from a wish. What a room is: `core/room.rs`.
use crate::core::room::{self, Plan, Room};
use crate::host::harness;
use std::sync::Arc;

fn root() -> String {
    crate::core::manifest::manifest().rooms.clone()
}

fn store() -> Arc<dyn crate::core::store::Store> {
    crate::core::store::data()
}

pub fn list() -> Vec<Room> {
    room::list(&*store(), &root())
}

/// Rooms left mid-step by the last run of the host say so.
pub fn recover() {
    room::recover(&*store(), &root());
}

/// Make a room from a plan: one session per seat, then the room itself. A seat can only be
/// given a harness that can run here.
pub fn open(plan: &Plan) -> Result<Room, String> {
    let kinds = harness::usable();
    let kinds: Vec<&str> = kinds.iter().map(String::as_str).collect();
    room::check(plan, &kinds)?;
    let (st, root) = (store(), root());
    let id = room::next_id(&*st, &root);
    let title = room::title(plan, id);
    let mut sessions = vec![];
    for s in &plan.seats {
        sessions.push(harness::open(&s.harness, &format!("{title}: {}", s.name.trim()), "")?.id);
    }
    room::open(&*st, &root, id, plan, &sessions)
}

/// Begin a step and return at once; each seat's line lands in the room as it is said.
pub fn say(id: u64, text: &str) -> Result<(), String> {
    let (st, root) = (store(), root());
    let mut seat = Some(room::say(&*st, &root, id, text)?);
    tokio::spawn(async move {
        while let Some(i) = seat {
            let said = match room::get(&*st, &root, id) {
                Ok(r) => harness::turn(r.seats[i].session, &room::brief(&r, i)).await,
                Err(e) => Err(e),
            };
            seat = room::heard(&*st, &root, id, i, said).unwrap_or_else(|e| {
                eprintln!("askk: room {id}: {e}");
                None
            });
        }
    });
    Ok(())
}

/// The modes and presets this home offers (`modes.json`); a home without the file gets the
/// built-in ones, a file that does not read is an error.
pub fn curation() -> Result<room::Curation, String> {
    let key = &crate::core::manifest::manifest().modes;
    match store().get(key) {
        Some(t) => room::Curation::read(&t).map_err(|e| format!("{key}: {e}")),
        None => Ok(Default::default()),
    }
}

/// The desk agent as a page maker: a session with `kind` turns a wish into a page, which is
/// checked like any page and saved where no page is yet. The page's path comes back.
pub async fn design_view(wish: &str, kind: &str) -> Result<String, String> {
    if wish.trim().is_empty() {
        return Err("say what the page is for".into());
    }
    let desk = harness::open(kind, "desk", "")?;
    let said = harness::turn(desk.id, &room::view_prompt(wish)).await?;
    let (path, page) = room::parse_view(&said)?;
    let routes = &crate::core::manifest::manifest().routes;
    let segs = crate::core::routes::segments(&path)?;
    let st = store();
    // The desk agent adds pages; it never replaces one.
    if st.has(&format!("{routes}/{}/page.json", segs.join("/"))) {
        return Err(format!("a page is already at /{}", segs.join("/")));
    }
    crate::core::routes::save(&*st, routes, &path, &page)
}

/// The desk agent: a session with `kind` turns a wish into a plan, and the room is made.
pub async fn design(wish: &str, kind: &str) -> Result<Room, String> {
    if wish.trim().is_empty() {
        return Err("say what the room is for".into());
    }
    let kinds = harness::usable();
    let kinds: Vec<&str> = kinds.iter().map(String::as_str).collect();
    let desk = harness::open(kind, "desk", "")?;
    let said = harness::turn(desk.id, &room::design_prompt(wish, &kinds)).await?;
    open(&room::parse_plan(&said, &kinds)?)
}
