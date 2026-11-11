//! # Figure: the one place a [`Figure`] value becomes a drawing
//!
//! The engine says what to show; this file decides how it looks. A figure is drawn as SVG
//! (plot, graph, draw) or a table, inside one frame: its title, the drawing, its note.
//!
//! The layout is plain arithmetic kept apart from the drawing ([`nice`], [`layers`], [`clip`],
//! [`arrow`]) so it is tested without a browser. Colours are names the stylesheet owns
//! (`--fig-1` … `--fig-8` in series order; `ink`, `dim`, `accent`): a series keeps its colour
//! by its position, never by its rank, and text is never drawn in a series colour.
use crate::core::figure::{number, word, Draw, Figure, Graph, Plot, Shape, Table};
use crate::core::node::Node;
use dioxus::prelude::*;

/// A colour name as a CSS value; an unnamed mark takes the series slot `i` (0-based).
pub fn tone(name: &str, i: usize) -> String {
    match name {
        "ink" => "var(--fg)".into(),
        "dim" => "var(--muted)".into(),
        "accent" => "var(--accent)".into(),
        "blue" => "var(--fig-1)".into(),
        "orange" => "var(--fig-2)".into(),
        "amber" => "var(--fig-4)".into(),
        "teal" => "var(--fig-3)".into(),
        "pink" => "var(--fig-5)".into(),
        "green" => "var(--fig-6)".into(),
        "purple" => "var(--fig-7)".into(),
        "red" => "var(--fig-8)".into(),
        _ => format!("var(--fig-{})", i % 8 + 1),
    }
}

/// An axis from `lo` to `hi` in about `want` clean steps: `(first tick, last tick, step)`.
pub fn nice(lo: f64, hi: f64, want: usize) -> (f64, f64, f64) {
    let (lo, hi) = if hi > lo { (lo, hi) } else { (lo - 1.0, lo + 1.0) };
    let raw = (hi - lo) / want.max(1) as f64;
    let mag = 10f64.powf(raw.log10().floor());
    let step = [1.0, 2.0, 2.5, 5.0, 10.0].iter().map(|m| m * mag).find(|s| *s >= raw).unwrap_or(10.0 * mag);
    ((lo / step).floor() * step, (hi / step).ceil() * step, step)
}

/// A tick the short way: 950, 1.5K, 20K, 3.2M.
pub fn tick(v: f64) -> String {
    let a = v.abs();
    let short = |x: f64, unit: &str| format!("{}{unit}", format!("{x:.1}").trim_end_matches('0').trim_end_matches('.'));
    if a >= 1e9 { short(v / 1e9, "B") } else if a >= 1e6 { short(v / 1e6, "M") } else if a >= 1e4 { short(v / 1e3, "K") } else { format!("{v:.2}").trim_end_matches('0').trim_end_matches('.').to_string() }
}

/// Which column each node of a flow sits in: a node comes after everything that leads to it
/// (edges that close a cycle are not counted). Returns the columns, each a list of node indexes.
pub fn layers(g: &Graph) -> Vec<Vec<usize>> {
    let n = g.nodes.len();
    let at = |id: &str| g.nodes.iter().position(|x| x.id == id);
    let edges: Vec<(usize, usize)> = g.edges.iter().filter_map(|e| Some((at(&e.from)?, at(&e.to)?))).filter(|(a, b)| a != b).collect();
    // Depth-first: an edge to a node still being walked closes a cycle and is left out.
    let mut state = vec![0u8; n];
    let mut keep: Vec<(usize, usize)> = vec![];
    fn walk(v: usize, edges: &[(usize, usize)], state: &mut [u8], keep: &mut Vec<(usize, usize)>) {
        state[v] = 1;
        for (a, b) in edges.iter().filter(|(a, _)| *a == v) {
            if state[*b] == 1 {
                continue;
            }
            keep.push((*a, *b));
            if state[*b] == 0 {
                walk(*b, edges, state, keep);
            }
        }
        state[v] = 2;
    }
    for v in 0..n {
        if state[v] == 0 {
            walk(v, &edges, &mut state, &mut keep);
        }
    }
    let mut col = vec![0usize; n];
    for _ in 0..n {
        for (a, b) in &keep {
            col[*b] = col[*b].max(col[*a] + 1);
        }
    }
    let mut out: Vec<Vec<usize>> = vec![vec![]; col.iter().max().map_or(0, |m| m + 1)];
    for (v, c) in col.iter().enumerate() {
        out[*c].push(v);
    }
    out
}

/// Where the line from a box's middle `(cx, cy)` toward `(tx, ty)` leaves the box (`w` × `h`).
pub fn clip(cx: f64, cy: f64, w: f64, h: f64, tx: f64, ty: f64) -> (f64, f64) {
    let (dx, dy) = (tx - cx, ty - cy);
    if dx == 0.0 && dy == 0.0 {
        return (cx, cy);
    }
    let k = (w / 2.0 / dx.abs().max(1e-9)).min(h / 2.0 / dy.abs().max(1e-9));
    (cx + dx * k, cy + dy * k)
}

/// The three corners of an arrow head of `size` at `(x2, y2)`, pointing away from `(x1, y1)`.
pub fn arrow(x1: f64, y1: f64, x2: f64, y2: f64, size: f64) -> String {
    let a = (y2 - y1).atan2(x2 - x1);
    let p = |turn: f64| (x2 - size * (a + turn).cos(), y2 - size * (a + turn).sin());
    let (l, r) = (p(0.45), p(-0.45));
    format!("{x2:.2},{y2:.2} {:.2},{:.2} {:.2},{:.2}", l.0, l.1, r.0, r.1)
}

/// A figure node, drawn. A node whose value is not a figure says so.
#[component]
pub fn FigureView(node: Node) -> Element {
    let fig: Result<Figure, String> = serde_json::from_value(node.data.clone()).map_err(|e| e.to_string());
    match fig {
        Ok(f) => {
            let note = match &f {
                Figure::Plot(p) => p.note.clone(),
                Figure::Graph(g) => g.note.clone(),
                Figure::Draw(d) => d.note.clone(),
                Figure::Table(t) => t.note.clone(),
            };
            rsx! {
                figure { class: "fig fig-{f.kind()}", "aria-label": "{f.title()}",
                    figcaption { class: "fig-title", "{f.title()}" span { class: "fig-kind", "{f.kind()}" } }
                    match f.clone() {
                        Figure::Plot(p) => rsx! { PlotView { plot: p } },
                        Figure::Graph(g) => rsx! { GraphView { graph: g } },
                        Figure::Draw(d) => rsx! { DrawView { draw: d } },
                        Figure::Table(t) => rsx! { TableView { table: t } },
                    }
                    if !note.is_empty() { p { class: "fig-note", "{note}" } }
                    if !node.note.is_empty() { p { class: "fig-note fig-warn", "{node.note}" } }
                }
            }
        }
        Err(e) => rsx! { p { class: "dim", "not a figure: {e}" } },
    }
}

const W: f64 = 480.0;
const H: f64 = 260.0;
const LEFT: f64 = 46.0;
const RIGHT: f64 = 14.0;
const TOP: f64 = 12.0;
const BOTTOM: f64 = 34.0;

/// The first `n` letters of a label.
fn short(text: &str, n: usize) -> String {
    text.chars().take(n).collect()
}

/// A series' value at `i` as a tooltip or table cell shows it.
fn cell(ys: &[Option<f64>], i: usize, gap: &str) -> String {
    ys.get(i).copied().flatten().map(tick).unwrap_or_else(|| gap.to_string())
}

/// Points as an SVG `points` attribute.
fn points(pts: &[(f64, f64)]) -> String {
    pts.iter().map(|p| format!("{},{}", p.0, p.1)).collect::<Vec<_>>().join(" ")
}

/// A bar from the baseline `y0` to `y1`: square at the baseline, rounded at the data end.
fn bar(x: f64, w: f64, y0: f64, y1: f64) -> String {
    let r = 4f64.min(w / 2.0).min((y0 - y1).abs());
    let s = if y1 <= y0 { 1.0 } else { -1.0 };
    format!("M{x:.1},{y0:.1} L{x:.1},{:.1} Q{x:.1},{y1:.1} {:.1},{y1:.1} L{:.1},{y1:.1} Q{:.1},{y1:.1} {:.1},{:.1} L{:.1},{y0:.1} Z", y1 + s * r, x + r, x + w - r, x + w, x + w, y1 + s * r, x + w)
}

#[component]
fn PlotView(plot: Plot) -> Element {
    let mut hover = use_signal(|| None::<usize>);
    let chart = if plot.chart.is_empty() { "line".to_string() } else { plot.chart.clone() };
    let n = plot.series.iter().map(|s| s.y.len()).max().unwrap_or(0).max(plot.x.len());
    if n == 0 {
        return rsx! { p { class: "dim", "no data to plot" } };
    }
    let values: Vec<f64> = plot.series.iter().flat_map(|s| s.y.iter().flatten().copied()).chain(plot.marks.iter().filter_map(|m| m.y)).collect();
    let (vmin, vmax) = values.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), v| (l.min(*v), h.max(*v)));
    let (vmin, vmax) = if values.is_empty() { (0.0, 1.0) } else { (vmin, vmax) };
    // Bars and areas grow from zero; a line may start where its data does.
    let from_zero = chart == "bar" || chart == "area" || (vmin >= 0.0 && vmin <= (vmax - vmin) * 0.5);
    let (lo, hi, step) = nice(if from_zero { vmin.min(0.0) } else { vmin }, if from_zero { vmax.max(0.0) } else { vmax }, 5);
    let (pw, ph) = (W - LEFT - RIGHT, H - TOP - BOTTOM);
    let y = move |v: f64| TOP + (hi - v) / (hi - lo) * ph;
    // The x axis: by value when every x is a number (and the chart is not bars), else by place.
    let xnum: Vec<f64> = plot.x.iter().filter_map(number).collect();
    let by_value = chart != "bar" && xnum.len() == n && n > 1 && xnum.windows(2).all(|w| w[1] >= w[0]) && xnum[n - 1] > xnum[0];
    let band = pw / n as f64;
    let xs: Vec<f64> = (0..n).map(|i| if by_value { LEFT + (xnum[i] - xnum[0]) / (xnum[n - 1] - xnum[0]) * pw } else { LEFT + (i as f64 + 0.5) * band }).collect();
    let label = |i: usize| plot.x.get(i).map(word).unwrap_or_else(|| (i + 1).to_string());
    let ticks: Vec<f64> = (0..=((hi - lo) / step).round() as usize).map(|k| lo + k as f64 * step).collect();
    let every = n.div_ceil(8).max(1);
    let m = plot.series.len().max(1);
    let group = band * 0.72;
    let bw = ((group - 2.0 * (m as f64 - 1.0)) / m as f64).clamp(1.0, 24.0);
    let color = |i: usize| tone(&plot.series[i].color, i);
    let path_of = |ys: &[Option<f64>]| -> String {
        let mut d = String::new();
        let mut pen = false;
        for (i, v) in ys.iter().enumerate() {
            match v {
                Some(v) => {
                    d.push_str(&format!("{}{:.1},{:.1} ", if pen { "L" } else { "M" }, xs[i], y(*v)));
                    pen = true;
                }
                None => pen = false,
            }
        }
        d
    };
    let area_of = |ys: &[Option<f64>]| -> String {
        let pts: Vec<(f64, f64)> = ys.iter().enumerate().filter_map(|(i, v)| v.map(|v| (xs[i], y(v)))).collect();
        match (pts.first(), pts.last()) {
            (Some(a), Some(b)) => format!("M{:.1},{:.1} {} L{:.1},{:.1} Z", a.0, y(0f64.clamp(lo, hi)), pts.iter().map(|p| format!("L{:.1},{:.1}", p.0, p.1)).collect::<Vec<_>>().join(" "), b.0, y(0f64.clamp(lo, hi))),
            _ => String::new(),
        }
    };
    let mark_x = |v: &serde_json::Value| -> Option<f64> {
        if by_value {
            number(v).map(|x| LEFT + (x - xnum[0]) / (xnum[n - 1] - xnum[0]) * pw)
        } else {
            plot.x.iter().position(|x| word(x) == word(v)).map(|i| xs[i])
        }
    };
    // One hover target per x (thinned when there are very many points).
    let stride = n.div_ceil(400).max(1);
    let hits: Vec<(usize, f64, f64)> = (0..n).step_by(stride).map(|i| {
        let l = if i == 0 { LEFT } else { (xs[i] + xs[i - stride.min(i)]) / 2.0 };
        let r = if i + stride >= n { W - RIGHT } else { (xs[i] + xs[i + stride]) / 2.0 };
        (i, l, (r - l).max(1.0))
    }).collect();
    let tip = hover().filter(|i| *i < n);
    let cap_y = |v: f64| if v >= 0.0 { y(v) - 5.0 } else { y(v) + 13.0 };
    let mark_text_x = |x: f64| if x > W * 0.7 { x - 5.0 } else { x + 5.0 };
    let base = y(0f64.clamp(lo, hi));
    rsx! {
        if plot.series.len() > 1 {
            div { class: "fig-legend",
                for (i, s) in plot.series.iter().enumerate() {
                    span { class: "fig-key", i { style: "background:{color(i)}" } "{s.name}" }
                }
            }
        }
        div { class: "fig-plot", onmouseleave: move |_| hover.set(None),
            svg { view_box: "0 0 {W} {H}", role: "img", "aria-label": "{plot.title}",
                for t in ticks.iter() {
                    line { class: "fig-grid", x1: "{LEFT}", x2: "{W - RIGHT}", y1: "{y(*t):.1}", y2: "{y(*t):.1}" }
                    text { class: "fig-tick", x: "{LEFT - 6.0}", y: "{y(*t) + 3.5:.1}", text_anchor: "end", "{tick(*t)}" }
                }
                line { class: "fig-axis", x1: "{LEFT}", x2: "{W - RIGHT}", y1: "{base:.1}", y2: "{base:.1}" }
                for i in (0..n).step_by(every) {
                    text { class: "fig-tick", x: "{xs[i]:.1}", y: "{H - BOTTOM + 14.0}", text_anchor: "middle", "{short(&label(i), 12)}" }
                }
                if !plot.x_label.is_empty() { text { class: "fig-axis-label", x: "{LEFT + pw / 2.0}", y: "{H - 4.0}", text_anchor: "middle", "{plot.x_label}" } }
                if !plot.y_label.is_empty() { text { class: "fig-axis-label", x: "{LEFT - 40.0}", y: "{TOP - 2.0}", "{plot.y_label}" } }
                for (i, s) in plot.series.iter().enumerate() {
                    if chart == "bar" {
                        for (k, v) in s.y.iter().enumerate() {
                            if let Some(v) = v {
                                path { d: "{bar(xs[k] - (bw * m as f64 + 2.0 * (m as f64 - 1.0)) / 2.0 + i as f64 * (bw + 2.0), bw, base, y(*v))}", style: "fill:{color(i)}" }
                            }
                        }
                    } else if chart == "scatter" {
                        for (k, v) in s.y.iter().enumerate() {
                            if let Some(v) = v {
                                circle { class: "fig-dot", cx: "{xs[k]:.1}", cy: "{y(*v):.1}", r: "4.5", style: "fill:{color(i)}" }
                            }
                        }
                    } else {
                        if chart == "area" { path { d: "{area_of(&s.y)}", style: "fill:{color(i)};fill-opacity:.12" } }
                        path { class: "fig-line", d: "{path_of(&s.y)}", style: "stroke:{color(i)}" }
                        if let Some((k, v)) = s.y.iter().enumerate().rev().find_map(|(k, v)| v.map(|v| (k, v))) {
                            circle { class: "fig-dot", cx: "{xs[k]:.1}", cy: "{y(v):.1}", r: "4", style: "fill:{color(i)}" }
                        }
                    }
                }
                // The single-series bar chart says its values on the caps when there is room.
                if chart == "bar" && plot.series.len() == 1 && n <= 14 {
                    for (k, v) in plot.series[0].y.iter().enumerate() {
                        if let Some(v) = v {
                            text { class: "fig-value", x: "{xs[k]:.1}", y: "{cap_y(*v):.1}", text_anchor: "middle", "{tick(*v)}" }
                        }
                    }
                }
                // Each mark's words sit on their own line, so marks close together stay readable.
                for (k, mk) in plot.marks.iter().enumerate() {
                    if let Some(x) = mark_x(&mk.x) {
                        line { class: "fig-mark", x1: "{x:.1}", x2: "{x:.1}", y1: "{TOP}", y2: "{H - BOTTOM}" }
                        text { class: "fig-mark-text", x: "{mark_text_x(x):.1}", y: "{TOP + 10.0 + 13.0 * (k % 6) as f64}", text_anchor: if x > W * 0.7 { "end" } else { "start" }, "{mk.text}" }
                    } else if let Some(v) = mk.y {
                        line { class: "fig-mark", x1: "{LEFT}", x2: "{W - RIGHT}", y1: "{y(v):.1}", y2: "{y(v):.1}" }
                        text { class: "fig-mark-text", x: "{W - RIGHT - 4.0}", y: "{y(v) - 5.0:.1}", text_anchor: "end", "{mk.text}" }
                    }
                }
                if let Some(i) = tip {
                    line { class: "fig-cross", x1: "{xs[i]:.1}", x2: "{xs[i]:.1}", y1: "{TOP}", y2: "{H - BOTTOM}" }
                }
                for (i, l, w) in hits.iter().copied() {
                    rect { class: "fig-hit", x: "{l:.1}", y: "{TOP}", width: "{w:.1}", height: "{ph}", onmouseenter: move |_| hover.set(Some(i)) }
                }
            }
            if let Some(i) = tip {
                div { class: if xs[i] > W * 0.6 { "fig-tip left" } else { "fig-tip" }, style: "left:{xs[i] / W * 100.0:.2}%",
                    b { "{label(i)}" }
                    for (k, s) in plot.series.iter().enumerate() {
                        span { class: "fig-key", i { style: "background:{color(k)}" } "{s.name}" em { {cell(&s.y, i, "–")} } }
                    }
                }
            }
        }
        details { class: "fig-data",
            summary { "Data" }
            div { class: "fig-scroll",
                table {
                    thead { tr { th { if plot.x_label.is_empty() { "x" } else { "{plot.x_label}" } } for s in plot.series.iter() { th { "{s.name}" } } } }
                    tbody {
                        for i in 0..n.min(200) {
                            tr { td { "{label(i)}" } for s in plot.series.iter() { td { class: "num", {cell(&s.y, i, "")} } } }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn GraphView(graph: Graph) -> Element {
    let n = graph.nodes.len();
    let name = |i: usize| if graph.nodes[i].label.is_empty() { graph.nodes[i].id.clone() } else { graph.nodes[i].label.clone() };
    let size = |i: usize| ((name(i).chars().count() as f64 * 7.4 + 26.0).clamp(72.0, 190.0), 36.0);
    let widest = (0..n).map(|i| size(i).0).fold(72.0, f64::max);
    // Middles of the nodes, and the drawing's size.
    let (pos, w, h): (Vec<(f64, f64)>, f64, f64) = if graph.layout == "ring" {
        let r = (n as f64 * (widest + 24.0) / std::f64::consts::TAU).max(90.0);
        let (w, h) = (2.0 * r + widest + 32.0, 2.0 * r + 36.0 + 40.0);
        ((0..n).map(|i| { let a = std::f64::consts::TAU * i as f64 / n as f64 - std::f64::consts::FRAC_PI_2; (w / 2.0 + r * a.cos(), h / 2.0 + r * a.sin()) }).collect(), w, h)
    } else {
        let cols = layers(&graph);
        let tall = cols.iter().map(Vec::len).max().unwrap_or(1) as f64;
        let (gap_x, gap_y) = (widest + 64.0, 62.0);
        let (w, h) = (cols.len() as f64 * gap_x - 64.0 + 32.0, tall * gap_y + 24.0);
        let mut pos = vec![(0.0, 0.0); n];
        for (c, col) in cols.iter().enumerate() {
            for (j, v) in col.iter().enumerate() {
                pos[*v] = (16.0 + widest / 2.0 + c as f64 * gap_x, h / 2.0 + (j as f64 - (col.len() as f64 - 1.0) / 2.0) * gap_y);
            }
        }
        (pos, w, h)
    };
    let at = |id: &str| graph.nodes.iter().position(|x| x.id == id);
    let edges: Vec<(f64, f64, f64, f64, String, bool)> = graph.edges.iter().filter_map(|e| {
        let (a, b) = (at(&e.from)?, at(&e.to)?);
        if a == b { return None; }
        let (sa, sb) = (size(a), size(b));
        let (x1, y1) = clip(pos[a].0, pos[a].1, sa.0, sa.1, pos[b].0, pos[b].1);
        let (x2, y2) = clip(pos[b].0, pos[b].1, sb.0 + 6.0, sb.1 + 6.0, pos[a].0, pos[a].1);
        Some((x1, y1, x2, y2, e.label.clone(), e.dash))
    }).collect();
    rsx! {
        div { class: "fig-scroll",
            // Never drawn smaller than four fifths of its own size: a long flow scrolls sideways instead of shrinking its words.
            svg { view_box: "0 0 {w:.0} {h:.0}", style: "min-width:{w * 0.8:.0}px", role: "img", "aria-label": "{graph.title}",
                for (x1, y1, x2, y2, label, dash) in edges.iter().cloned() {
                    line { class: if dash { "fig-edge dash" } else { "fig-edge" }, x1: "{x1:.1}", y1: "{y1:.1}", x2: "{x2:.1}", y2: "{y2:.1}" }
                    polygon { class: "fig-head", points: "{arrow(x1, y1, x2, y2, 9.0)}" }
                    if !label.is_empty() { text { class: "fig-edge-text", x: "{(x1 + x2) / 2.0:.1}", y: "{(y1 + y2) / 2.0 - 4.0:.1}", text_anchor: "middle", "{label}" } }
                }
                for i in 0..n {
                    rect { class: "fig-node", x: "{pos[i].0 - size(i).0 / 2.0:.1}", y: "{pos[i].1 - 18.0:.1}", width: "{size(i).0:.1}", height: "36", rx: "9", style: "--c:{tone(&graph.nodes[i].color, 0)}" }
                    text { class: "fig-node-text", x: "{pos[i].0:.1}", y: "{pos[i].1 + 4.5:.1}", text_anchor: "middle", "{short(&name(i), 24)}" }
                }
            }
        }
    }
}

#[component]
fn DrawView(draw: Draw) -> Element {
    let (w, h) = draw.size();
    let size = |s: &Shape| if s.size > 0.0 { s.size } else { 3.0 };
    // Where a label sits on a shape that is not text: its middle.
    let middle = |s: &Shape| match s.shape.as_str() {
        "line" | "arrow" => ((s.x + s.x2) / 2.0, (s.y + s.y2) / 2.0 - 1.5),
        "rect" => (s.x + s.w / 2.0, s.y + s.h / 2.0),
        "ellipse" => (s.x, s.y),
        "path" => s.points.get(s.points.len() / 2).map(|p| (p.0, p.1 - 1.5)).unwrap_or((s.x, s.y)),
        _ => (s.x, s.y),
    };
    rsx! {
        svg { class: "fig-board", view_box: "0 0 {w} {h}", role: "img", "aria-label": "{draw.title}",
            for (i, s) in draw.shapes.iter().enumerate() {
                {
                    let c = tone(if s.color.is_empty() { "ink" } else { &s.color }, i);
                    let cls = format!("fig-shape{}{}", if s.fill { " filled" } else { "" }, if s.dash { " dash" } else { "" });
                    let (mx, my) = middle(s);
                    rsx! {
                        g { style: "--c:{c}",
                            match s.shape.as_str() {
                                "line" => rsx! { line { class: "{cls}", x1: "{s.x}", y1: "{s.y}", x2: "{s.x2}", y2: "{s.y2}" } },
                                "arrow" => rsx! {
                                    line { class: "{cls}", x1: "{s.x}", y1: "{s.y}", x2: "{s.x2}", y2: "{s.y2}" }
                                    polygon { class: "fig-shape-head", points: "{arrow(s.x, s.y, s.x2, s.y2, 2.4)}" }
                                },
                                "rect" => rsx! { rect { class: "{cls}", x: "{s.x}", y: "{s.y}", width: "{s.w}", height: "{s.h}", rx: ".8" } },
                                "circle" => rsx! { circle { class: "{cls}", cx: "{s.x}", cy: "{s.y}", r: "{s.r}" } },
                                "ellipse" => rsx! { ellipse { class: "{cls}", cx: "{s.x}", cy: "{s.y}", rx: "{s.w / 2.0}", ry: "{s.h / 2.0}" } },
                                "path" => rsx! { polyline { class: "{cls}", points: "{points(&s.points)}" } },
                                _ => rsx! {},
                            }
                            if !s.text.is_empty() {
                                text { class: if s.shape == "text" { "fig-shape-text own" } else { "fig-shape-text" }, x: "{mx}", y: "{my}", font_size: "{size(s)}", text_anchor: "middle", dominant_baseline: "middle", "{s.text}" }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn TableView(table: Table) -> Element {
    // A column is numbers when every filled cell in it is one.
    let numeric: Vec<bool> = (0..table.columns.len()).map(|i| table.rows.iter().filter_map(|r| r.get(i)).filter(|v| !v.is_null()).all(|v| v.is_number())).collect();
    rsx! {
        div { class: "fig-scroll",
            table {
                thead { tr { for (i, c) in table.columns.iter().enumerate() { th { class: if numeric[i] { "num" } else { "" }, "{c}" } } } }
                tbody {
                    for r in table.rows.iter() {
                        tr { for (i, v) in r.iter().enumerate() { td { class: if numeric.get(i).copied().unwrap_or(false) { "num" } else { "" }, "{word(v)}" } } }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_axis_takes_clean_steps_and_short_ticks() {
        assert_eq!(nice(0.0, 97.0, 5), (0.0, 100.0, 20.0));
        assert_eq!(nice(3.0, 4.2, 5), (3.0, 4.25, 0.25));
        assert_eq!(nice(5.0, 5.0, 5), (4.0, 6.0, 0.5), "a flat series still has an axis");
        assert_eq!([tick(950.0), tick(1500.0), tick(20_000.0), tick(3_200_000.0), tick(0.25)], ["950", "1500", "20K", "3.2M", "0.25"]);
    }

    #[test]
    fn a_flow_puts_each_node_after_what_leads_to_it_even_in_a_cycle() {
        let g = |edges: &[(&str, &str)]| -> Graph {
            let nodes: Vec<_> = ["a", "b", "c", "d"].iter().map(|id| json!({"id": id})).collect();
            let edges: Vec<_> = edges.iter().map(|(f, t)| json!({"from": f, "to": t})).collect();
            serde_json::from_value(json!({"title": "t", "nodes": nodes, "edges": edges})).unwrap()
        };
        assert_eq!(layers(&g(&[("a", "b"), ("b", "c"), ("a", "c"), ("c", "d")])), vec![vec![0], vec![1], vec![2], vec![3]], "c comes after b, not beside it");
        assert_eq!(layers(&g(&[("a", "b"), ("a", "c")])), vec![vec![0, 3], vec![1, 2]], "a node nothing leads to starts a flow");
        assert_eq!(layers(&g(&[("a", "b"), ("b", "c"), ("c", "a")])), vec![vec![0, 3], vec![1], vec![2]], "the edge that closes a cycle does not push anything");
    }

    #[test]
    fn edges_leave_boxes_at_their_border_and_arrows_point_along_the_line() {
        assert_eq!(clip(0.0, 0.0, 100.0, 40.0, 200.0, 0.0), (50.0, 0.0));
        assert_eq!(clip(0.0, 0.0, 100.0, 40.0, 0.0, -90.0), (0.0, -20.0));
        assert_eq!(arrow(0.0, 0.0, 10.0, 0.0, 2.0).split(' ').next(), Some("10.00,0.00"), "the tip is the end of the line");
        assert_eq!(tone("", 9), "var(--fig-2)", "an unnamed series takes its slot");
        assert_eq!(tone("ink", 3), "var(--fg)");
    }
}
