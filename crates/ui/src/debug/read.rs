//! ONE READ of the Debug projection: the fragment, and the numbers that ride
//! beside it on headers. The shape `proc::row::read` uses for the process
//! listing, and for its reason — a pane that needs a COUNT should be told it,
//! not made to parse the markup it is about to hand to the browser.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

/// What the core said about the panel it just drew.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Facts {
    pub(crate) turns: usize,
    pub(crate) calls: usize,
    /// Storage writes that failed — `StoreFailed`, which had no reader
    /// anywhere. Above zero means this conversation stopped being saved.
    pub(crate) store_failed: usize,
    /// Whether the agent this pane is about is the one THIS page runs. A
    /// sub-agent's route, stage and model-call facts are in its own Worker's
    /// log, so the pane says so rather than drawing a turn that cost nothing.
    pub(crate) own_log: bool,
}

fn header(res: &kernel::Response, name: &str) -> String {
    res.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

pub(crate) fn read(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> (String, Facts) {
    let Some(app) = web.peek().clone() else {
        return (String::new(), Facts::default());
    };
    let res = app.handle(Request::get("/debug").with_header("x-agent", agent));
    let count = |name: &str| header(&res, name).parse::<usize>().unwrap_or(0);
    let facts = Facts {
        turns: count("x-debug-turns"),
        calls: count("x-model-calls"),
        store_failed: count("x-store-failed"),
        own_log: header(&res, "x-own-log") == "true",
    };
    (res.body, facts)
}
