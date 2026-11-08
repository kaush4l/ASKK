use dioxus::prelude::*;

/// Line icons on a 24px grid, one stroke weight, drawn in `currentColor`. Names are data
/// (`icon` in a route's `page.json`); an unknown name draws a dot.
pub const ICONS: &[(&str, &str)] = &[
    ("chat", "M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"),
    ("branch", "M7 3v12M7 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM17 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 9c0 5-10 3-10 6"),
    ("engine", "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6zM10 10h4v4h-4z"),
    ("grid", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"),
    ("cube", "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"),
    ("shapes", "M10 4H4v6h6zM17 3.5l3.5 6h-7zM7 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM14 14h6v6h-6z"),
    ("palette", "M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 12.5h0M10 8h0M15 8h0"),
    ("layout", "M4 4h16v16H4zM4 9h16M10 9v11"),
    ("routes", "M4 6h16M4 12h16M4 18h10"),
    ("sidebar", "M4 4h16v16H4zM9 4v16"),
    ("close", "M6 6l12 12M18 6L6 18"),
    ("dot", "M12 11.5h0"),
];

#[component]
pub fn Icon(name: String, #[props(default = 20)] size: u32) -> Element {
    let d = ICONS.iter().find(|(n, _)| *n == name).or(ICONS.iter().find(|(n, _)| *n == "dot")).map(|(_, d)| *d).unwrap_or_default();
    rsx! {
        svg { class: "icon", width: "{size}", height: "{size}", view_box: "0 0 24 24", fill: "none", stroke: "currentColor",
            stroke_width: "1.75", stroke_linecap: "round", stroke_linejoin: "round", "aria-hidden": "true",
            path { d: "{d}" }
        }
    }
}
