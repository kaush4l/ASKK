//! # whiteboard
//! The board a teacher draws on while explaining. It gives the engine four drawing tools, one
//! per kind of [`Figure`] — `plot` (numbers against an axis), `graph` (things and how they
//! connect), `draw` (a free sketch), `table` (rows and columns) — and `wipe`. A figure is a
//! value in a fixed structure: one that breaks it is refused with the reason, so the engine
//! corrects it and draws again.
//!
//! Drawing a figure with the title of one already there replaces it (a teacher corrects the
//! drawing). The prompt lists what is on the board, so the engine can point at it or wipe it.
//! Each figure remembers the run that drew it, so the conversation shows it where it was drawn.
//!
//! A `plot` or `table` may take real data: `from: {file, x, y}` names a data file (see the
//! `data_query` tool, which this element calls to check the reference). The figure keeps the
//! reference, not a copy, and shows the data as it is when looked at.
//!
//! ```json
//! {"kind": "whiteboard", "config": {"max": 24}}
//! ```
use crate::core::figure::{Figure, Shown, CHARTS, COLORS, KINDS, LAYOUTS, SHAPES};
use crate::core::node::Node;
use crate::core::{read, value, Component, Event, Fut, Spec, Tool, Toolbox};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

const DOC: &str = "The teacher's board: plot, graph, draw, table put a figure on it (a validated value the UI draws; the same title replaces); wipe removes. Prompt: what is on the board.";

/// The tool that answers a figure's `from` (a shared tool the engine must select).
pub const QUERY: &str = "data_query";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    /// Figures kept on the board (default 24); the oldest go first.
    #[serde(default, skip_serializing_if = "is_zero")]
    max: usize,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    figures: Vec<Shown>,
    /// The run in progress (or the last one): what a new figure is tied to.
    #[serde(default, skip_serializing_if = "is_none")]
    run: u64,
}

fn is_none(n: &u64) -> bool {
    *n == 0
}

pub struct Whiteboard {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let st: St = read(&s.state)?;
    if let Some(bad) = st.figures.iter().find_map(|f| f.figure.validate().err()) {
        return Err(format!("a figure in its state breaks the structure: {bad}"));
    }
    Ok(Box::new(Whiteboard { name: s.name, cfg: read(&s.config)?, st }))
}

/// What a `data_query` result holds: `(columns, rows)`.
pub fn table_of(result: &Value) -> Result<(Vec<String>, Vec<Vec<Value>>), String> {
    let v: Value = match result {
        Value::String(s) => serde_json::from_str(s).map_err(|e| format!("data: {e}"))?,
        v => v.clone(),
    };
    let columns: Vec<String> = serde_json::from_value(v["columns"].clone()).map_err(|_| "data: no columns")?;
    let rows: Vec<Vec<Value>> = serde_json::from_value(v["rows"].clone()).map_err(|_| "data: no rows")?;
    Ok((columns, rows))
}

/// One drawing tool: reads its arguments as a figure of its kind and checks it.
struct Put(&'static str);

impl Tool for Put {
    fn name(&self) -> String {
        self.0.into()
    }
    fn description(&self) -> String {
        match self.0 {
            "plot" => "put a chart on the board: numbers against an axis. Write the numbers, or take real data with from",
            "graph" => "put a diagram on the board: things (nodes) and how they connect (edges); a concept map, a flow, a hierarchy",
            "draw" => "sketch freely on the board, a 100 wide × 60 high grid with (0,0) at the top left: geometry, a labelled picture, an idea in shapes",
            _ => "put a table on the board. Write the rows, or take real data with from",
        }
        .into()
    }
    fn args(&self) -> Value {
        let colors = COLORS.join("|");
        match self.0 {
            "plot" => json!({
                "title": "names the figure",
                "chart": CHARTS.join("|"),
                "x": ["labels or numbers"],
                "series": [{"name": "text", "y": ["one number per x"]}],
                "x_label": "?", "y_label": "?",
                "marks": [{"x": "an x value (or y: number)", "text": "what to notice there"}],
                "note": "the point of the figure, one line",
                "from": {"file": "a data file, instead of x and series", "x": "column", "y": ["columns"], "where": "?", "group": "?", "agg": "?", "sort": "?", "limit": "?"}
            }),
            "graph" => json!({
                "title": "names the figure",
                "nodes": [{"id": "short", "label": "shown", "color": format!("?{colors}")}],
                "edges": [{"from": "id", "to": "id", "label": "?", "dash": "?true"}],
                "layout": LAYOUTS.join("|"),
                "note": "the point, one line"
            }),
            "draw" => json!({
                "title": "names the figure",
                "shapes": [{"shape": SHAPES.join("|"), "x": "0-100", "y": "0-60", "x2": "line/arrow end", "y2": "", "w": "rect/ellipse", "h": "", "r": "circle", "text": "words, centred on x,y (on another shape: a label at its middle)", "points": [["x", "y"]], "color": format!("?{colors}"), "fill": "?true", "dash": "?true", "size": "?text height, default 3"}],
                "note": "the point, one line"
            }),
            _ => json!({"title": "names the figure", "columns": ["text"], "rows": [["cell"]], "note": "?", "from": {"file": "a data file, instead of columns and rows", "columns": "?", "where": "?", "sort": "?", "limit": "?"}}),
        }
    }
    fn invoke(&self, args: Value, tools: Toolbox) -> Fut<Result<Value, String>> {
        let kind = self.0;
        Box::pin(async move {
            let mut f = Figure::read(kind, &args)?;
            if let Some(from) = f.from().cloned() {
                // Checked against the real data now, so a wrong file or column is corrected
                // while drawing; the check is not a call of the engine's own (not logged).
                let quiet = Toolbox(tools.0.clone(), None);
                let got = quiet.call(QUERY, from).await.map_err(|e| format!("{kind}: from: {e}"))?;
                let (columns, rows) = table_of(&got)?;
                f.fill(&columns, &rows).map_err(|e| format!("{kind}: from: {e}"))?;
                return Ok(json!(format!("on the board: {} — {} rows of real data", f.line(), rows.len())));
            }
            Ok(json!(format!("on the board: {}", f.line())))
        })
    }
}

impl Whiteboard {
    fn max(&self) -> usize {
        if self.cfg.max == 0 { 24 } else { self.cfg.max }
    }
}

impl Component for Whiteboard {
    fn kind(&self) -> &'static str { "whiteboard" }
    fn unique(&self) -> bool { true }
    fn category(&self) -> &'static str { "action" }
    fn icon(&self) -> &'static str { "chart" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::World }
    fn abilities(&self) -> Vec<String> { self.tools().iter().map(|t| t.name()).collect() }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { if self.st == St::default() { Value::Null } else { value(&self.st) } }
    fn figures(&self) -> Vec<Shown> { self.st.figures.clone() }
    fn view(&self) -> Node {
        let n = self.st.figures.len();
        let head = Node::new("muted").text(&if n == 0 { "empty board".to_string() } else { format!("{n} figure{} on the board", if n == 1 { "" } else { "s" }) });
        Node::new("tile").label(&self.name).text("whiteboard").child(head).children(self.st.figures.iter().rev().take(3).rev().map(|s| Node::figure(&s.figure)).collect())
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Started { run } => self.st.run = *run,
            Event::Cleared => self.st.figures.clear(),
            Event::Called { tool, args, result } if !result.starts_with("error") => {
                if KINDS.contains(&tool.as_str()) {
                    let Ok(figure) = Figure::read(tool, args) else { return };
                    let shown = Shown { run: self.st.run, figure };
                    // The same title is the same figure, drawn again: it takes the old one's place.
                    match self.st.figures.iter_mut().find(|f| f.figure.title() == shown.figure.title()) {
                        Some(old) => *old = shown,
                        None => self.st.figures.push(shown),
                    }
                    let extra = self.st.figures.len().saturating_sub(self.max());
                    self.st.figures.drain(..extra);
                } else if tool == "wipe" {
                    match args["title"].as_str().filter(|t| !t.trim().is_empty()) {
                        Some(t) => self.st.figures.retain(|f| f.figure.title() != t.trim()),
                        None => self.st.figures.clear(),
                    }
                }
            }
            _ => {}
        }
    }
    fn prompt(&self) -> Option<String> {
        if self.st.figures.is_empty() {
            return Some("The board is empty. The user sees whatever you put on it, beside your words.".into());
        }
        let list: Vec<String> = self.st.figures.iter().enumerate().map(|(i, s)| format!("{}. {}", i + 1, s.figure.line())).collect();
        Some(format!("On the board now (the user sees these; draw with the same title to replace one, wipe to remove):\n{}", list.join("\n")))
    }
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        let titles: Vec<String> = self.st.figures.iter().map(|f| f.figure.title().to_string()).collect();
        let mut out: Vec<Arc<dyn Tool>> = KINDS.iter().map(|k| Arc::new(Put(k)) as Arc<dyn Tool>).collect();
        out.push(crate::core::tool("wipe", "remove one figure from the board by its title, or clear the board (no title)", json!({"title": "?a figure's title"}), move |a| {
            match a["title"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                Some(t) if !titles.iter().any(|x| x == t) => Err(format!("no figure titled '{t}' on the board")),
                Some(t) => Ok(json!(format!("wiped '{t}'"))),
                None => Ok(json!("board cleared")),
            }
        }));
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::core::held::Held;
    use super::*;
    use crate::core::engine::tests::{file, reply, spec, Scripted};
    use crate::core::{tool, Engine};

    fn board() -> Box<dyn Component> {
        new(Spec { kind: "whiteboard".into(), name: "board".into(), config: json!({"max": 2}), ..Default::default() }).unwrap()
    }

    fn called(b: &mut Box<dyn Component>, tool: &str, args: Value) {
        b.on(&Event::Called { tool: tool.into(), args, result: "on the board".into() });
    }

    #[test]
    fn figures_go_on_the_board_tied_to_their_run_and_the_same_title_replaces() {
        let mut b = board();
        assert!(b.prompt().unwrap().contains("empty"));
        b.on(&Event::Started { run: 7 });
        called(&mut b, "plot", json!({"title": "Growth", "series": [{"name": "a", "y": [1, 2]}]}));
        called(&mut b, "graph", json!({"title": "Parts", "nodes": [{"id": "a"}, {"id": "b"}], "edges": [{"from": "a", "to": "b"}]}));
        b.on(&Event::Started { run: 9 });
        called(&mut b, "plot", json!({"title": "Growth", "series": [{"name": "a", "y": [1, 2, 3]}]}));
        let f = b.figures();
        assert_eq!(f.iter().map(|s| (s.run, s.figure.title())).collect::<Vec<_>>(), [(9, "Growth"), (7, "Parts")], "redrawn in place, by the new run");
        assert!(b.prompt().unwrap().contains("1. plot 'Growth' (line, 1 series, 3 points)"));
        called(&mut b, "table", json!({"title": "T", "columns": ["a"], "rows": [[1]]}));
        assert_eq!(b.figures().len(), 2, "the oldest figure leaves a full board");
        b.on(&Event::Called { tool: "plot".into(), args: json!({"title": "Bad"}), result: "error: plot: 1 to 8 series".into() });
        assert!(!b.figures().iter().any(|s| s.figure.title() == "Bad"), "a refused figure is not drawn");
        called(&mut b, "wipe", json!({"title": "T"}));
        assert_eq!(b.figures().len(), 1);
        let back = new(b.spec()).unwrap();
        assert_eq!(back.figures(), b.figures(), "the board survives a restart");
        called(&mut b, "wipe", json!({}));
        assert!(b.figures().is_empty());
    }

    #[tokio::test]
    async fn the_drawing_tools_refuse_what_breaks_the_structure_and_check_real_data() {
        let b = board();
        let data = tool(QUERY, "rows of a file", Value::Null, |a| {
            if a["file"] == "commits.csv" { Ok(json!({"columns": ["day", "commits"], "rows": [["mon", 3], ["tue", 5]], "total": 2})) } else { Err(format!("no data file '{}'", a["file"].as_str().unwrap_or_default())) }
        });
        let tb = Toolbox::new(b.tools().into_iter().chain([data])).logged();
        assert_eq!(tb.names(), ["data_query", "draw", "graph", "plot", "table", "wipe"]);
        assert!(tb.call("plot", json!({"title": "t", "chart": "pie", "series": [{"y": [1]}]})).await.unwrap_err().contains("not one of line"));
        let ok = tb.call("plot", json!({"title": "Commits", "chart": "bar", "from": {"file": "commits.csv", "x": "day", "y": ["commits"]}})).await.unwrap();
        assert!(ok.as_str().unwrap().contains("2 rows of real data"), "{ok}");
        assert!(tb.call("plot", json!({"title": "t", "from": {"file": "commits.csv", "y": ["lines"]}})).await.unwrap_err().contains("no column 'lines'"));
        assert!(tb.call("table", json!({"title": "t", "from": {"file": "nope.csv"}})).await.unwrap_err().contains("no data file"));
        assert!(tb.call("wipe", json!({"title": "nothing"})).await.unwrap_err().contains("no figure titled"));
        let logged: Vec<String> = tb.drain().into_iter().filter_map(|e| match e { Event::Called { tool, .. } => Some(tool), _ => None }).collect();
        assert!(!logged.contains(&QUERY.to_string()), "checking the data is not a call of the engine's own: {logged:?}");
    }

    /// The whole loop: the model draws, the board holds the figure, the next prompt lists it.
    #[tokio::test]
    async fn an_engine_draws_while_it_explains() {
        let infer = Scripted::new(&["plan: show it\nact: [draw(title: \"Right triangle\", shapes: [{\"shape\": \"path\", \"points\": [[10, 50], [70, 50], [70, 10], [10, 50]]}, {\"shape\": \"text\", \"x\": 40, \"y\": 55, \"text\": \"a\"}], note: \"a² + b² = c²\")]", "answer: see the board"]);
        let e = Engine::new(file("guru"), "guru".into(), vec![spec("whiteboard", "board", Value::Null), spec("history", "h", Value::Null), reply()], vec![], vec![], infer.clone()).unwrap();
        assert_eq!(e.run("why does pythagoras hold?").await.unwrap(), "see the board");
        let figs: Vec<Shown> = e.elements.held().iter().flat_map(|c| c.figures()).collect();
        assert_eq!(figs.len(), 1);
        assert_eq!(figs[0].run, e.runs().last().unwrap().id, "the figure knows the run that drew it");
        assert!(infer.prompts.held()[1].contains("1. draw 'Right triangle' (2 shapes)"));
    }
}
