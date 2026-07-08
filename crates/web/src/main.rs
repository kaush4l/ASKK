//! Dioxus web shell. UI = fold(signals); commands go through the harness.
use dioxus::prelude::*;

fn main() {
    dioxus::launch(app);
}

fn app() -> Element {
    rsx! {
        h1 { "ASKK harness" }
        p { "scaffold — surfaces land in wave 5" }
    }
}
