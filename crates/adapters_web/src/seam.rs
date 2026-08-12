//! The seam as a RUST caller sees it: `ui`'s Dioxus handlers call
//! `core::handle` through here with no JSON hop and no second wire format
//! (I4). Split from `lib.rs`, which is the composition root, so both hold the
//! 200-line rule (I12).
//!
//! Everything a Worker has to say reaches the log HERE, on the way past. That
//! is the one door (I8), and it is also why the page keeps a heartbeat: a
//! Worker's facts land only when something calls the seam.

use std::rc::Rc;

use crate::{js_err, WebApp};

impl WebApp {
    /// Every agent loaded in this browser — the UI needs the list to give each
    /// one its own conversation (increment 07).
    pub fn agent_names(&self) -> Vec<String> {
        core::agent_names(&self.app.borrow())
    }

    /// The seam for a Rust caller — the `ui` crate's Dioxus event handlers
    /// (I4: same `core::handle`, no JSON hop, no second wire format). `&self`
    /// because the mutation is behind the `RefCell` the async half shares.
    pub fn handle(&self, req: kernel::Request) -> kernel::Response {
        // Worker lifecycle facts arrive on a JS callback, where the app is
        // already borrowed by whatever handler is running; they are queued
        // there and land in the log HERE, through the one status door (I8).
        for (agent, status, detail) in self.workers.take_reports() {
            core::report_agent(&mut self.app.borrow_mut(), &agent, status, &detail);
        }
        // …and what each Worker last said about its own window, so a sub-agent's
        // pane shows a number IT reported and not one this side guessed.
        // …and any agent a Worker WROTE (increment 11): the create-agent
        // superagent runs in its own Worker, so the agent it authored reaches
        // the page's roster through the same one-door discipline.
        for (name, text, author) in self.workers.take_authored() {
            core::report_authored(&mut self.app.borrow_mut(), &name, &text, &author);
        }
        for (agent, window, summary) in self.workers.take_memory() {
            let mut app = self.app.borrow_mut();
            core::report_memory(&mut app, &agent, window, summary.as_deref());
        }
        let response = core::handle(&mut self.app.borrow_mut(), req);
        // An agent authored (or deleted) by that request needs its Worker
        // started (or stopped) before anyone can talk to it — increment 11's
        // "initialized in place, no reload" (`roster.rs`).
        self.sync_workers();
        let app = Rc::clone(&self.app);
        wasm_bindgen_futures::spawn_local(async move {
            if let Err(e) = core::drive(app).await {
                web_sys::console::error_1(&js_err(e));
            }
        });
        response
    }
}
