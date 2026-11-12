//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in four ways. A tab says it is a tab (`role`, `aria-selected`, `aria-controls`), which the original left out. The arrow keys, Home and End move between tabs, and only the chosen tab takes the Tab key. Only the chosen tab's content is drawn, so a page behind a tab does no work until it is opened. And a row of tabs has one mark that slides to the chosen tab (`TabsIndicator`) instead of a mark that blinks on each. Where it sits is the stylesheet's work (`tailwind.css`), with no measuring here: in a browser that can tie one element's place to another's, the mark takes the chosen tab's place and width; in any other, the tabs are columns of one width and the mark's place is the chosen tab's number. A row with too little room shortens its labels (a label inside a `span`) before it scrolls sideways.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum TabsVariant {
    #[default]
    Default,
    Line,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum TabsOrientation {
    #[default]
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy)]
struct TabsCtx {
    active: Signal<String>,
    /// The tabs in the order they are drawn, for the arrow keys: each trigger adds its value
    /// once, as it is first drawn. A plain list, not a signal: adding to it redraws nothing.
    order: CopyValue<Vec<String>>,
    horizontal: bool,
}

#[derive(Clone, Copy)]
struct TabsListCtx {
    variant: TabsVariant,
}

#[component]
pub fn Tabs(
    #[props(into, optional)] class: Option<String>,
    #[props(into, optional)] default_value: Option<String>,
    #[props(default = TabsOrientation::Horizontal)] orientation: TabsOrientation,
    children: Element,
) -> Element {
    let active = use_signal(|| default_value.unwrap_or_default());
    let order = use_hook(|| CopyValue::new(Vec::<String>::new()));
    let is_horizontal = orientation == TabsOrientation::Horizontal;
    provide_context(TabsCtx { active, order, horizontal: is_horizontal });

    let class = tw_merge!(
        "group/tabs flex gap-2",
        if is_horizontal { "flex-col" } else { "flex-row" },
        class.as_deref().unwrap_or("")
    );

    rsx! {
        div {
            class: "{class}",
            "data-name": "Tabs",
            "data-orientation": if is_horizontal { "Horizontal" } else { "Vertical" },
            {children}
        }
    }
}

#[component]
pub fn TabsList(
    #[props(into, optional)] class: Option<String>,
    #[props(default = TabsVariant::Default)] variant: TabsVariant,
    children: Element,
) -> Element {
    provide_context(TabsListCtx { variant });
    let TabsCtx { mut active, order, horizontal } = use_context::<TabsCtx>();
    let is_line = variant == TabsVariant::Line;
    // The outside may scroll sideways on a narrow screen; the row inside is as wide as its tabs,
    // each a column as wide as the widest. (`inline-grid`, because this app's pages have a
    // class of their own called `grid`.)
    let class = tw_merge!(
        "group/tabs-list flex w-fit max-w-full overflow-x-auto rounded-lg p-[3px] text-muted-foreground [scrollbar-width:none]",
        if is_line { "bg-transparent rounded-none p-0" } else { "bg-muted" },
        class.as_deref().unwrap_or("")
    );
    let row = if horizontal { "relative inline-grid min-w-full grid-flow-col [grid-auto-columns:minmax(0,1fr)] items-stretch" } else { "relative flex h-fit w-full flex-col" };
    // Arrow keys move between tabs (left and right in a row, up and down in a column).
    let step = move |e: KeyboardEvent| {
        let tabs = order.read().clone();
        let Some(i) = tabs.iter().position(|v| *v == *active.peek()) else { return };
        let (back, on) = if horizontal { (Key::ArrowLeft, Key::ArrowRight) } else { (Key::ArrowUp, Key::ArrowDown) };
        let key = e.key();
        let to = if key == on {
            (i + 1) % tabs.len()
        } else if key == back {
            (i + tabs.len() - 1) % tabs.len()
        } else if key == Key::Home {
            0
        } else if key == Key::End {
            tabs.len() - 1
        } else {
            return;
        };
        e.prevent_default();
        active.set(tabs[to].clone());
        // The chosen tab is the one the keyboard is on.
        document::eval(&format!("document.getElementById('tab-{}')?.focus()", tabs[to].replace(' ', "-")));
    };

    rsx! {
        div { class: "{class}", "data-name": "TabsList", "data-variant": if is_line { "Line" } else { "Default" },
            div {
                class: "{row}",
                role: "tablist",
                "aria-orientation": if horizontal { "horizontal" } else { "vertical" },
                onkeydown: step,
                {children}
                // The one mark of the row: it sits under the chosen tab and slides when another
                // is chosen. After the tabs, so the first tab is the row's first child.
                if horizontal {
                    span {
                        "data-name": "TabsIndicator",
                        "aria-hidden": "true",
                        class: if is_line {
                            "pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-foreground"
                        } else {
                            "pointer-events-none absolute inset-y-0 left-0 rounded-md bg-background shadow-[var(--elev-1)] dark:bg-input/30"
                        },
                    }
                }
            }
        }
    }
}

#[component]
pub fn TabsTrigger(
    #[props(into)] value: String,
    #[props(into, optional)] class: Option<String>,
    children: Element,
) -> Element {
    let TabsCtx { mut active, mut order, horizontal } = use_context::<TabsCtx>();
    let list_ctx = use_context::<TabsListCtx>();
    let is_line = list_ctx.variant == TabsVariant::Line;
    let val = value.clone();
    // Say once that this tab exists, so the row knows how many tabs it has and where each is.
    use_hook(|| {
        if !order.read().contains(&val) {
            order.write().push(val.clone());
        }
    });
    let is_active = active() == val;

    let merged = tw_merge!(
        "relative z-[1] inline-flex min-h-[var(--hit-sm)] min-w-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap cursor-pointer select-none touch-manipulation [-webkit-tap-highlight-color:transparent] [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0",
        "transition-[color,transform] duration-[var(--motion-fast)] ease-[var(--ease-out)] active:scale-[var(--press-scale)] active:duration-[var(--motion-press)]",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        "group-data-[orientation=Vertical]/tabs:w-full group-data-[orientation=Vertical]/tabs:justify-start",
        if is_active { "text-foreground" } else { "text-foreground/60 hover:text-foreground" },
        // A column of tabs has no sliding mark: the chosen one is marked in place.
        if !horizontal && is_active { if is_line { "border-r-foreground rounded-none" } else { "bg-background shadow-[var(--elev-1)] dark:bg-input/30" } } else { "" },
        class.as_deref().unwrap_or("")
    );
    let id = value.replace(' ', "-");

    rsx! {
        button {
            class: "{merged}",
            "data-name": "TabsTrigger",
            role: "tab",
            r#type: "button",
            id: "tab-{id}",
            "aria-selected": "{is_active}",
            "aria-controls": "tabpanel-{id}",
            tabindex: if is_active { "0" } else { "-1" },
            "data-state": if is_active { "Active" } else { "Inactive" },
            onclick: move |_| active.set(value.clone()),
            {children}
        }
    }
}

#[component]
pub fn TabsContent(
    #[props(into)] value: String,
    #[props(into, optional)] class: Option<String>,
    children: Element,
) -> Element {
    let TabsCtx { active, .. } = use_context::<TabsCtx>();
    let is_active = active() == value;

    let class = tw_merge!(
        "flex-1 text-sm outline-none",
        "group-data-[orientation=Horizontal]/tabs:mt-2 group-data-[orientation=Vertical]/tabs:ml-4",
        if is_active { "" } else { "hidden" },
        class.as_deref().unwrap_or("")
    );
    let id = value.replace(' ', "-");

    rsx! {
        div { class: "{class}", "data-name": "TabsContent", role: "tabpanel", id: "tabpanel-{id}", "aria-labelledby": "tab-{id}",
            if is_active {
                {children}
            }
        }
    }
}
