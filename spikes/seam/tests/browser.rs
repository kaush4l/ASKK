//! Headless-browser proof (wasm-pack test): the seam's fragment lands in a
//! real DOM, and vendored htmx can drive the whole loop — hx-get click ->
//! htmx:beforeRequest intercepted -> `handle()` -> fragment swapped in.
#![cfg(target_arch = "wasm32")]

use spike_seam::{handle, Request};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn doc() -> web_sys::Document {
    web_sys::window().unwrap().document().unwrap()
}

/// Append a fresh container — never clobber body.innerHTML: the test harness
/// keeps its own output element there, and wiping it hangs the runner.
fn container() -> web_sys::Element {
    let div = doc().create_element("div").unwrap();
    doc().body().unwrap().append_child(&div).unwrap();
    div
}

/// Claim 1: handle()'s fragment is valid HTML that lands in the DOM.
#[wasm_bindgen_test]
fn fragment_lands_in_dom() {
    let res = handle(Request::get("/panel"));
    container().set_inner_html(&res.body);
    let panel = doc().get_element_by_id("panel").expect("panel in DOM");
    assert!(panel.text_content().unwrap().contains("Hello from the Rust core."));
}

async fn tick(ms: i32) {
    let p = js_sys::Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms)
            .unwrap();
    });
    wasm_bindgen_futures::JsFuture::from(p).await.unwrap();
}

/// Claim 2: real htmx (the vendored file, injected via eval) issues the
/// request for an hx-get click, our interceptor answers from `handle()`, and
/// the fragment appears in the target — the exact transport of §5 Option B.
#[wasm_bindgen_test]
async fn htmx_click_swaps_fragment_from_handle() {
    // Inject the vendored htmx. The glue's eval is strict-mode direct eval,
    // so `var htmx` stays eval-scoped — export it to window in the same eval.
    let src = concat!(
        include_str!("../../../web/vendor/htmx.min.js"),
        "\n;window.htmx = htmx; htmx"
    );
    let htmx = js_sys::eval(src).expect("htmx evals to the global");

    let body = doc().body().unwrap();
    container().set_inner_html(
        "<div id=\"app\"><button id=\"go\" hx-get=\"/panel\" \
         hx-target=\"#out\" hx-swap=\"innerHTML\"></button>\
         <div id=\"out\"></div></div>",
    );

    // Transport: cancel htmx's network request, answer from the seam.
    let interceptor = Closure::<dyn FnMut(web_sys::Event)>::new(|evt: web_sys::Event| {
        evt.prevent_default();
        let detail = js_sys::Reflect::get(&evt, &"detail".into()).unwrap();
        let cfg = js_sys::Reflect::get(&detail, &"requestConfig".into()).unwrap();
        let path = js_sys::Reflect::get(&cfg, &"path".into())
            .unwrap()
            .as_string()
            .unwrap();
        let res = handle(Request::get(&path));
        doc().get_element_by_id("out").unwrap().set_inner_html(&res.body);
    });
    body.add_event_listener_with_callback("htmx:beforeRequest", interceptor.as_ref().unchecked_ref())
        .unwrap();

    // htmx.process(app) wires the hx-* attributes, then click.
    let process = js_sys::Reflect::get(&htmx, &"process".into()).unwrap();
    let app = doc().get_element_by_id("app").unwrap();
    process
        .dyn_ref::<js_sys::Function>()
        .unwrap()
        .call1(&htmx, &app)
        .expect("htmx.process");
    doc()
        .get_element_by_id("go")
        .unwrap()
        .dyn_ref::<web_sys::HtmlElement>()
        .unwrap()
        .click();

    tick(50).await; // let htmx fire the event chain
    let out = doc().get_element_by_id("out").unwrap();
    assert!(
        out.inner_html().contains("Hello from the Rust core."),
        "htmx-driven swap delivered the handle() fragment, got: {}",
        out.inner_html()
    );
    interceptor.forget(); // test-scope leak, fine
}
