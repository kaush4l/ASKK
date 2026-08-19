//! WHAT THE PAGE ASKED FOR, as opposed to what the agent decided. Everything
//! here arrives as an `EventKind::Custom` a person's click produced: save this
//! file, open that folder, run this command, stop the one that is running. None
//! of it enters `agent::step` — it is not an agent turn — but each runs through
//! the same tool gate the agent's own calls run through, under the same grant,
//! and leaves the same `ToolInvoked` fact behind. So the pane can only show
//! what the agent would have been told, and a stop from a button and a stop the
//! model asked for are one recorded fact.

use std::cell::RefCell;
use std::rc::Rc;

use crate::app::App;

/// Serve one request, answering whether it WAS one. `false` means the event is
/// not the page asking for something and belongs to the agent loop.
pub(super) async fn serve(app: &Rc<RefCell<App>>, kind: &str, payload_json: &str) -> bool {
    match kind {
        crate::files::pane::SAVE_REQUEST => save(app, payload_json).await,
        crate::files::pane::OPEN_REQUEST => open(app, payload_json).await,
        crate::proc::pane::PANE_REQUEST => processes(app, payload_json).await,
        // STOP (R11-1b). It is served by a `drive` OTHER than the one wedged
        // inside the command — the seam spawns one per request and that loop
        // borrows the app only between awaits, which is exactly what makes an
        // interrupt reachable while a command is running.
        crate::terminal::pane::STOP_REQUEST => crate::workspace::gesture::stop_command(app).await,
        crate::terminal::pane::EXEC_REQUEST => exec(app, payload_json).await,
        crate::chat::pane::TURN_STOPPED => stop_waiting(app, payload_json),
        _ => return false,
    }
    true
}

/// Write what the editor holds back to the workspace it came from.
async fn save(app: &Rc<RefCell<App>>, payload_json: &str) {
    let (path, contents) =
        serde_json::from_str::<(String, String)>(payload_json).unwrap_or_default();
    crate::workspace::gesture::save_typed(app, &path, &contents).await;
}

/// Read a file or list a folder for the Files pane. A payload that is not the
/// pair is the path itself, and a bare path is a folder — that is what the pane
/// asks for when it has nothing else to say.
async fn open(app: &Rc<RefCell<App>>, payload_json: &str) {
    let (path, folder) = serde_json::from_str::<(String, bool)>(payload_json)
        .unwrap_or_else(|_| (payload_json.to_string(), true));
    crate::workspace::gesture::open_typed(app, &path, folder).await;
}

/// The Processes pane asked what is running — and, when it names one, asked to
/// STOP it first (R10-6). The listing always follows, so the pane it refreshes
/// shows the world after the stop rather than the one before it.
async fn processes(app: &Rc<RefCell<App>>, payload_json: &str) {
    let name = serde_json::from_str::<String>(payload_json).unwrap_or_default();
    if !name.is_empty() {
        crate::workspace::gesture::stop_process(app, &name).await;
    }
    crate::workspace::gesture::list_processes(app).await;
}

/// Run a command a PERSON typed into the terminal (increment 10), IN FLIGHT
/// where a projection can see it (R2-8): the pane's own "running…" lived in
/// component state and died with the component the moment you switched view.
async fn exec(app: &Rc<RefCell<App>>, payload_json: &str) {
    let command =
        serde_json::from_str::<String>(payload_json).unwrap_or_else(|_| payload_json.to_string());
    app.borrow_mut().running.push(command.clone());
    crate::workspace::gesture::run_typed(app, &command).await;
    let mut a = app.borrow_mut();
    if let Some(i) = a.running.iter().position(|c| *c == command) {
        a.running.remove(i);
    }
}

/// The person stopped waiting (11b walk): the turn is over, so the task is
/// cleared exactly as a failed turn clears it — and the swap `reconcile` was
/// deferring can land. Only when the turn that ended is THIS agent's: a stop on
/// a Worker's pane ends the wait in the log the page projects, and clearing the
/// lead's task on it would abandon a turn nobody ended (12b).
fn stop_waiting(app: &Rc<RefCell<App>>, payload_json: &str) {
    let named = crate::chat::pane::stopped_agent(payload_json);
    if named.is_empty() || named == app.borrow().me() {
        app.borrow_mut().agent.task = None;
    }
}

/// WHOSE MESSAGE IS THIS. A message ADDRESSED TO ANOTHER AGENT never enters
/// this engine (increment 07): its turn runs on that agent's own Worker and is
/// recorded in that agent's own history, so two conversations on one page
/// cannot cross. It is not pumped for the same reason — a pumped foreign
/// message puts someone else's words into this agent's paper — so this answers
/// `true` and the caller drops it. A message that IS this agent's claims it:
/// the agent enters Working the moment a person speaks to it, and `turns`
/// counts exactly these entries (Python `State.set`: `turns + (status is
/// WORKING)`).
pub(super) async fn ran_elsewhere(app: &Rc<RefCell<App>>, goal: &str, to: &str) -> bool {
    // The borrow ends on this line, before the await below: guards never live
    // across one, which is what keeps a request from wedging the whole seam.
    let mine = { to.is_empty() || to == app.borrow().me() };
    if !mine {
        let _ = crate::batch::run_on(app, to, goal, true).await;
        return true;
    }
    let me = app.borrow().me().to_string();
    app.borrow_mut().set_status(&me, kernel::Status::Working, "");
    false
}
