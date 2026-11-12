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
    ("maximize", "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"),
    ("minimize", "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7"),
    ("home", "M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"),
    ("settings", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z"),
    ("pencil", "M4 20l4-1 11-11-3-3L5 16zM14 7l3 3"),
    ("flag", "M5 21V4M5 4h11l-2 4 2 4H5"),
    ("database", "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"),
    ("history", "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2"),
    ("reply", "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v5"),
    ("wrench", "M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.5-1.5zM14.5 6.5L13 5a4 4 0 0 0-5 5l-5 5 3 3 5-5"),
    ("layers", "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5"),
    ("eye", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"),
    ("bell", "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"),
    ("file", "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6"),
    ("terminal", "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5"),
    ("split", "M6 4v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v2M18 4v6a4 4 0 0 1-4 4M4 6l2-2 2 2M16 6l2-2 2 2"),
    ("refresh", "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"),
    ("chart", "M4 20V4M4 20h16M8 16l4-5 3 3 5-7"),
    ("clock", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2"),
    ("book", "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"),
    ("routes", "M4 6h16M4 12h16M4 18h10"),
    ("sidebar", "M4 4h16v16H4zM9 4v16"),
    ("close", "M6 6l12 12M18 6L6 18"),
    ("sliders", "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4"),
    ("sun", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"),
    ("moon", "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"),
    ("chevron", "M9 6l6 6-6 6"),
    ("send", "M12 19V5M5 12l7-7 7 7"),
    ("stop", "M7 7h10v10H7z"),
    ("clip", "M20 11.5l-8.2 8.2a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4L14.5 7.5"),
    ("panel", "M4 4h16v16H4zM15 4v16"),
    ("trash", "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5"),
    ("check", "M5 12.5l4.5 4.5L19 7"),
    ("copy", "M9 9h11v11H9zM5 15V4h11"),
    ("pin", "M12 16v6M8 3h8l-1 6 3 4H6l3-4z"),
    ("search", "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4"),
    ("folder", "M3 6h6l2 2h10v11H3z"),
    ("keyboard", "M3 6h18v12H3zM7 10h0M11 10h0M15 10h0M7 14h10"),
    ("plus", "M12 5v14M5 12h14"),
    ("diff", "M8 3v8M4 7h8M4 17h8M16 13v8M14 3l6 6-6 6"),
    ("dot", "M12 11.5h0"),
    ("shield", "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"),
    ("mic", "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"),
    ("archive", "M3 4h18v4H3zM5 8v12h14V8M10 12h4"),
    ("quote", "M6 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"),
    ("undo", "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"),
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
