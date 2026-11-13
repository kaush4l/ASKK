//! Dioxus web shell — App, routes, Home, Blog.
//!
//! One component per core idea, same names as the core where they map.
//! The shell renders state and sends proposed actions; it never decides.
//! Tailwind classes are used in `rsx!`; the plain-CSS fallback lives in
//! `assets/main.css` and the Tailwind source in `input.css`.

use dioxus::prelude::*;
use layer_shared::ServerData;

/// Server function — Axum only, and the reason the server is Axum.
/// In 0.7 this is written like an Axum route: `#[get(path)]`.
/// On the server build this body runs; on the WASM build calling it
/// becomes an HTTP GET to `/api/server-data` on the Axum server.
/// With Actix this did not work — `#[server]` functions are built on
/// Axum, so Actix needed hand-written routes instead.
#[get("/api/server-data")]
pub async fn get_server_data() -> Result<ServerData, ServerFnError> {
    Ok(ServerData {
        message: "Hello from the Axum server!".to_string(),
        count: 0,
        events: 1,
    })
}

/// Routes — router: true.
#[derive(Clone, Routable, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[rustfmt::skip]
pub enum Route {
    #[route("/")]
    Home {},
    #[route("/blog/:id")]
    Blog { id: i32 },
}

#[component]
pub fn App() -> Element {
    rsx! {
        Router::<Route> {}
    }
}

#[component]
pub fn Home() -> Element {
    let mut count = use_signal(|| 0);
    let mut server_text = use_signal(|| "Server data lives at /api/server-data — fetch it, don't bake it in.".to_string());

    rsx! {
        div { class: "min-h-screen bg-slate-100 text-slate-900",
            div { class: "mx-auto max-w-2xl p-6",
                h1 { class: "text-3xl font-bold", "Layer Fullstack — High-Five counter" }
                p { class: "mt-2 text-slate-600",
                    "Workspace + fullstack (Axum SSR) + router + Tailwind + terminal. "
                    "This counter is UI state: it lives in a signal and resets on refresh. "
                    "Server state lives in the Axum server / shared core."
                }
                div { class: "mt-6 rounded bg-white p-6 shadow",
                    p { class: "text-xl", "Count: {count}" }
                    div { class: "mt-4 flex gap-2",
                        button {
                            class: "rounded bg-violet-600 px-4 py-2 text-white",
                            onclick: move |_| count += 1,
                            "Up high!"
                        }
                        button {
                            class: "rounded bg-slate-200 px-4 py-2",
                            onclick: move |_| count -= 1,
                            "Down low!"
                        }
                        Link {
                            to: Route::Blog { id: count() },
                            class: "rounded bg-slate-200 px-4 py-2",
                            "Go to blog {count}"
                        }
                    }
                    p { class: "mt-4 text-sm text-slate-500", "{server_text}" }
                    button {
                        class: "mt-2 rounded bg-violet-600 px-4 py-2 text-sm text-white",
                        onclick: move |_| async move {
                            match get_server_data().await {
                                Ok(data) => server_text.set(format!("{} — count {} ({} events)", data.message, data.count, data.events)),
                                Err(e) => server_text.set(format!("Server function failed: {e}")),
                            }
                        },
                        "Get server data (#[server] via Axum)"
                    }
                }
            }
        }
    }
}

#[component]
pub fn Blog(id: i32) -> Element {
    // Plain <a>, not Dioxus `Link`: Blog is also rendered standalone by
    // the Actix server (`/blog/:id` renders Blog directly), and `Link`
    // panics without a parent Router. Home is rendered inside the
    // Router, so its `Link` is fine.
    rsx! {
        div { class: "min-h-screen bg-slate-100 text-slate-900",
            div { class: "mx-auto max-w-2xl p-6",
                h1 { class: "text-3xl font-bold", "Blog post {id}" }
                p { class: "mt-2 text-slate-600", "Routed by dioxus-router: /blog/:id." }
                a { href: "/", class: "mt-4 inline-block rounded bg-violet-600 px-4 py-2 text-white", "Back to counter" }
            }
        }
    }
}
