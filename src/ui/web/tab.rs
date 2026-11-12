//! The tab build has no server, so nothing renders a page before it reaches the browser and
//! nothing is hydrated. The views still say `use_server_future`: here it is the same future,
//! run in the tab, and the view waits (suspends) until its first answer, as it would on a
//! server. An answer's error is its sentence.
use dioxus::prelude::*;
use std::future::Future;

pub type ServerFnError = String;

pub fn use_server_future<T, F>(f: impl FnMut() -> F + 'static) -> Result<Resource<T>, RenderError>
where
    T: Clone + 'static,
    F: Future<Output = T> + 'static,
{
    let r = use_resource(f);
    r.suspend()?;
    Ok(r)
}
