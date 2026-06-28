//! The active-supervisor registry: a thread-local handle to the [`Supervisor`] that
//! is currently driving a team, so a member's own tool calls (`agent_send`,
//! `agent_progress`, `agent_list`) can reach the SAME live supervisor that is running
//! it. WASM is single-threaded, so the thread-local is effectively a per-tab global.
//!
//! The handle is an `Rc<RefCell<Supervisor>>`: the driver and the messaging tools both
//! borrow it briefly and never across an await, so their accesses interleave safely
//! under cooperative scheduling. Installation is RAII and stack-structured — a nested
//! team run pushes its supervisor and restores the previous one on drop — so a team
//! that itself delegates to another team does not clobber its parent's view.

use std::cell::RefCell;
use std::rc::Rc;

use super::Supervisor;

/// A shared, interior-mutable handle to a supervisor. Cloning shares the same
/// underlying roster.
pub type SupervisorHandle = Rc<RefCell<Supervisor>>;

thread_local! {
    /// The supervisor currently driving a team on this thread, if any.
    static ACTIVE: RefCell<Option<SupervisorHandle>> = const { RefCell::new(None) };
}

/// RAII guard that keeps `handle` installed as the active supervisor and restores the
/// previously-active one (if any) when dropped.
pub struct ActiveGuard {
    previous: Option<SupervisorHandle>,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        ACTIVE.with(|cell| *cell.borrow_mut() = self.previous.take());
    }
}

/// Install `handle` as the active supervisor for the duration of the returned guard,
/// stacking on top of any already-active supervisor.
pub fn install(handle: SupervisorHandle) -> ActiveGuard {
    let previous = ACTIVE.with(|cell| cell.borrow_mut().replace(handle));
    ActiveGuard { previous }
}

/// The active supervisor handle, if one is installed.
pub fn active() -> Option<SupervisorHandle> {
    ACTIVE.with(|cell| cell.borrow().clone())
}

/// Run `f` against the active supervisor, returning its result, or `None` if no team
/// is currently running. The handle is cloned out before borrowing so the
/// thread-local itself is never borrowed across `f`.
pub fn with_active<R>(f: impl FnOnce(&mut Supervisor) -> R) -> Option<R> {
    let handle = active()?;
    let result = f(&mut handle.borrow_mut());
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Agent, agent_from_markdown};
    use crate::supervisor::{AgentStatus, Message};

    /// A handle whose roster is the bundled coder team, spun up via the real path.
    fn coder_handle() -> SupervisorHandle {
        let agents: Vec<Agent> = vec![
            agent_from_markdown("agents/coder/1_planner.md", "---\n---\nPlan.").unwrap(),
            agent_from_markdown("agents/coder/2_coder.md", "---\n---\nWrite code.").unwrap(),
            agent_from_markdown("agents/coder/3_verifier.md", "---\n---\nVerify.").unwrap(),
        ];
        let mut supervisor = Supervisor::new();
        supervisor.spawn_team(&agents, "coder").unwrap();
        Rc::new(RefCell::new(supervisor))
    }

    #[test]
    fn install_exposes_the_handle_and_drop_restores_previous() {
        let outer = coder_handle();
        let guard = install(outer.clone());
        with_active(|sup| sup.set_status("coder-planner", AgentStatus::Queued));
        assert!(active().is_some());

        {
            let inner = coder_handle();
            let _inner_guard = install(inner.clone());
            // Inner is now active; a message routes into inner's roster.
            let routed =
                with_active(|sup| sup.send_to("coder-coder", Message::new("x", "hi")).is_ok());
            assert_eq!(routed, Some(true));
        }

        // Inner guard dropped: outer is active again.
        let routed_outer =
            with_active(|sup| sup.send_to("coder-planner", Message::new("x", "hi")).is_ok());
        assert_eq!(routed_outer, Some(true));

        drop(guard);
        assert!(active().is_none());
    }
}
