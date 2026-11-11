//! # Figure: what a teacher puts on the board
//!
//! A figure is a **value**, never a picture and never code: the engine says *what* to show and
//! the UI draws it (`ui/figure.rs`). Four kinds, each a fixed structure checked when it is made
//! ([`Figure::validate`]) — a figure that breaks the structure is refused with the reason, so
//! the engine can correct it.
//!
//! | kind | is | made of |
//! | --- | --- | --- |
//! | `plot` | numbers against an axis | `chart` (line, area, bar, scatter), `x`, `series[] {name, y[]}`, `marks[]` |
//! | `graph` | things and how they connect | `nodes[] {id, label}`, `edges[] {from, to, label}`, `layout` (flow, ring) |
//! | `draw` | a free sketch on a 100 × 60 board | `shapes[]`: line, arrow, rect, circle, ellipse, text, path |
//! | `table` | rows and columns | `columns[]`, `rows[][]` |
//!
//! A `plot` or a `table` may take its numbers from real data instead of writing them out:
//! `from` names a file and columns (the arguments of the `data_query` tool, plus `x` and `y`
//! for a plot). The figure keeps the reference; whoever shows it fills it in ([`Figure::fill`]),
//! so it always shows the data as it is now.
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Colours a figure may name; the UI owns what each looks like. Empty = chosen in order.
pub const COLORS: &[&str] = &["ink", "dim", "accent", "blue", "orange", "teal", "amber", "pink", "green", "purple", "red"];
pub const CHARTS: &[&str] = &["line", "area", "bar", "scatter"];
pub const SHAPES: &[&str] = &["line", "arrow", "rect", "circle", "ellipse", "text", "path"];
pub const LAYOUTS: &[&str] = &["flow", "ring"];

/// The board a `draw` is made on, when it names no size.
pub const BOARD: (f64, f64) = (100.0, 60.0);

const MAX_SERIES: usize = 8;
const MAX_POINTS: usize = 2000;
const MAX_NODES: usize = 60;
const MAX_EDGES: usize = 160;
const MAX_SHAPES: usize = 240;
const MAX_COLUMNS: usize = 12;
const MAX_ROWS: usize = 200;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Figure {
    Plot(Plot),
    Graph(Graph),
    Draw(Draw),
    Table(Table),
}

/// The kinds, as written.
pub const KINDS: &[&str] = &["plot", "graph", "draw", "table"];

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Series {
    #[serde(default)]
    pub name: String,
    /// One value per `x`; `null` = no value there.
    #[serde(default)]
    pub y: Vec<Option<f64>>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
}

/// A line across a plot with a word on it: at `x` (upright) or at `y` (level).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub x: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Plot {
    pub title: String,
    /// line (default) | area | bar | scatter
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub chart: String,
    /// The shared axis: labels or numbers. Empty = 1, 2, 3…
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub x: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub series: Vec<Series>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub x_label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub y_label: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
    /// The point of the figure, in one line (drawn under it).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// Real data instead of written numbers: `{file, x: column, y: [columns], …}`.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub from: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dash: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    pub title: String,
    #[serde(default)]
    pub nodes: Vec<GNode>,
    #[serde(default)]
    pub edges: Vec<Edge>,
    /// flow (default: left to right, by what leads to what) | ring
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub layout: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

fn zero(n: &f64) -> bool {
    *n == 0.0
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    /// line | arrow | rect | circle | ellipse | text | path
    pub shape: String,
    #[serde(default, skip_serializing_if = "zero")]
    pub x: f64,
    #[serde(default, skip_serializing_if = "zero")]
    pub y: f64,
    /// line, arrow: where it ends.
    #[serde(default, skip_serializing_if = "zero")]
    pub x2: f64,
    #[serde(default, skip_serializing_if = "zero")]
    pub y2: f64,
    /// rect, ellipse: width and height.
    #[serde(default, skip_serializing_if = "zero")]
    pub w: f64,
    #[serde(default, skip_serializing_if = "zero")]
    pub h: f64,
    /// circle: radius.
    #[serde(default, skip_serializing_if = "zero")]
    pub r: f64,
    /// text: the words; any other shape: a label at its middle.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// path: the points it goes through.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<(f64, f64)>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fill: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dash: bool,
    /// text: letter height in board units (default 3).
    #[serde(default, skip_serializing_if = "zero")]
    pub size: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Draw {
    pub title: String,
    /// The board's size in its own units; 0 = [`BOARD`]. The origin is the top left.
    #[serde(default, skip_serializing_if = "zero")]
    pub width: f64,
    #[serde(default, skip_serializing_if = "zero")]
    pub height: f64,
    #[serde(default)]
    pub shapes: Vec<Shape>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

impl Draw {
    pub fn size(&self) -> (f64, f64) {
        (if self.width > 0.0 { self.width } else { BOARD.0 }, if self.height > 0.0 { self.height } else { BOARD.1 })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Table {
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Vec<Value>>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// Real data instead of written rows: `{file, columns?, …}`.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub from: Value,
}

/// A figure and the run that drew it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Shown {
    /// The run's id ([`super::run::Run::id`]); 0 = not known.
    #[serde(default)]
    pub run: u64,
    pub figure: Figure,
}

fn color(c: &str, what: &str) -> Result<(), String> {
    if c.is_empty() || COLORS.contains(&c) {
        Ok(())
    } else {
        Err(format!("{what}: colour '{c}' is not one of {}", COLORS.join(", ")))
    }
}

fn one_of(v: &str, list: &[&str], what: &str) -> Result<(), String> {
    if v.is_empty() || list.contains(&v) {
        Ok(())
    } else {
        Err(format!("{what} '{v}' is not one of {}", list.join(", ")))
    }
}

/// A value as a number: a number, or text that reads as one.
pub fn number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace(',', "").parse().ok(),
        _ => None,
    }
    .filter(|n: &f64| n.is_finite())
}

/// A value as a word for an axis or a cell.
pub fn word(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() != 0.0 => format!("{:.4}", f).trim_end_matches('0').trim_end_matches('.').to_string(),
            _ => n.to_string(),
        },
        v => v.to_string(),
    }
}

impl Figure {
    /// Read a figure of `kind` from a tool's arguments.
    pub fn read(kind: &str, args: &Value) -> Result<Figure, String> {
        let mut v = match args {
            Value::Object(_) => args.clone(),
            _ => return Err(format!("{kind}: the arguments must be named (title, …)")),
        };
        v["kind"] = kind.into();
        let f: Figure = serde_json::from_value(v).map_err(|e| format!("{kind}: {e}"))?;
        f.validate()?;
        Ok(f)
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Figure::Plot(_) => "plot",
            Figure::Graph(_) => "graph",
            Figure::Draw(_) => "draw",
            Figure::Table(_) => "table",
        }
    }

    pub fn title(&self) -> &str {
        match self {
            Figure::Plot(p) => &p.title,
            Figure::Graph(g) => &g.title,
            Figure::Draw(d) => &d.title,
            Figure::Table(t) => &t.title,
        }
    }

    /// The data reference, when the figure takes its numbers from a file.
    pub fn from(&self) -> Option<&Value> {
        match self {
            Figure::Plot(p) => Some(&p.from),
            Figure::Table(t) => Some(&t.from),
            _ => None,
        }
        .filter(|v| !v.is_null())
    }

    /// One line: what it is and how much it holds.
    pub fn line(&self) -> String {
        let what = match self {
            Figure::Plot(p) if !p.from.is_null() => format!("{} of {}", if p.chart.is_empty() { "line" } else { &p.chart }, p.from["file"].as_str().unwrap_or("data")),
            Figure::Plot(p) => format!("{}, {} series, {} points", if p.chart.is_empty() { "line" } else { &p.chart }, p.series.len(), p.series.iter().map(|s| s.y.len()).max().unwrap_or(0)),
            Figure::Graph(g) => format!("{} nodes, {} edges", g.nodes.len(), g.edges.len()),
            Figure::Draw(d) => format!("{} shapes", d.shapes.len()),
            Figure::Table(t) if !t.from.is_null() => format!("rows of {}", t.from["file"].as_str().unwrap_or("data")),
            Figure::Table(t) => format!("{} columns, {} rows", t.columns.len(), t.rows.len()),
        };
        format!("{} '{}' ({what})", self.kind(), self.title())
    }

    /// The structure every figure keeps.
    pub fn validate(&self) -> Result<(), String> {
        let title = self.title().trim();
        if title.is_empty() || title.chars().count() > 120 {
            return Err(format!("{}: a title is needed (at most 120 characters): it names the figure", self.kind()));
        }
        match self {
            Figure::Plot(p) => {
                one_of(&p.chart, CHARTS, "plot: chart")?;
                if !p.from.is_null() {
                    if p.from["file"].as_str().is_none_or(str::is_empty) {
                        return Err("plot: from needs a file".into());
                    }
                    if p.from["y"].as_array().is_none_or(|a| a.is_empty() || a.len() > MAX_SERIES || a.iter().any(|c| !c.is_string())) {
                        return Err(format!("plot: from needs y: the column names to plot (1 to {MAX_SERIES})"));
                    }
                    return Ok(());
                }
                if p.series.is_empty() || p.series.len() > MAX_SERIES {
                    return Err(format!("plot: 1 to {MAX_SERIES} series are needed (or from: real data)"));
                }
                for s in &p.series {
                    color(&s.color, "plot: series")?;
                    if s.y.is_empty() || s.y.len() > MAX_POINTS {
                        return Err(format!("plot: series '{}' needs 1 to {MAX_POINTS} values in y", s.name));
                    }
                    if !p.x.is_empty() && s.y.len() != p.x.len() {
                        return Err(format!("plot: series '{}' has {} values but x has {}", s.name, s.y.len(), p.x.len()));
                    }
                    if s.y.iter().flatten().any(|n| !n.is_finite()) {
                        return Err(format!("plot: series '{}' has a value that is not a number", s.name));
                    }
                }
                if p.chart == "scatter" && p.x.iter().any(|v| number(v).is_none()) {
                    return Err("plot: a scatter needs numbers in x".into());
                }
                Ok(())
            }
            Figure::Graph(g) => {
                one_of(&g.layout, LAYOUTS, "graph: layout")?;
                if g.nodes.is_empty() || g.nodes.len() > MAX_NODES {
                    return Err(format!("graph: 1 to {MAX_NODES} nodes are needed"));
                }
                if g.edges.len() > MAX_EDGES {
                    return Err(format!("graph: at most {MAX_EDGES} edges"));
                }
                let mut seen = std::collections::BTreeSet::new();
                for n in &g.nodes {
                    color(&n.color, "graph: node")?;
                    if n.id.trim().is_empty() || !seen.insert(n.id.as_str()) {
                        return Err(format!("graph: node id '{}' is empty or used twice", n.id));
                    }
                }
                match g.edges.iter().find(|e| !seen.contains(e.from.as_str()) || !seen.contains(e.to.as_str())) {
                    Some(e) => Err(format!("graph: edge {} → {} names a node that is not in nodes", e.from, e.to)),
                    None => Ok(()),
                }
            }
            Figure::Draw(d) => {
                if d.shapes.is_empty() || d.shapes.len() > MAX_SHAPES {
                    return Err(format!("draw: 1 to {MAX_SHAPES} shapes are needed"));
                }
                let (w, h) = d.size();
                if !(10.0..=1000.0).contains(&w) || !(10.0..=1000.0).contains(&h) {
                    return Err("draw: width and height are 10 to 1000 (leave them out for 100 × 60)".into());
                }
                for (i, s) in d.shapes.iter().enumerate() {
                    let at = format!("draw: shape {} ({})", i + 1, s.shape);
                    if !SHAPES.contains(&s.shape.as_str()) {
                        return Err(format!("{at}: not one of {}", SHAPES.join(", ")));
                    }
                    color(&s.color, &at)?;
                    let nums = [s.x, s.y, s.x2, s.y2, s.w, s.h, s.r, s.size];
                    if nums.iter().chain(s.points.iter().flat_map(|p| [&p.0, &p.1])).any(|n| !n.is_finite()) {
                        return Err(format!("{at}: every number must be finite"));
                    }
                    let missing = match s.shape.as_str() {
                        "text" if s.text.trim().is_empty() => "text",
                        "path" if s.points.len() < 2 => "at least two points",
                        "circle" if s.r <= 0.0 => "r",
                        "rect" | "ellipse" if s.w <= 0.0 || s.h <= 0.0 => "w and h",
                        "line" | "arrow" if s.x == s.x2 && s.y == s.y2 => "x2, y2 (where it ends)",
                        _ => "",
                    };
                    if !missing.is_empty() {
                        return Err(format!("{at}: needs {missing}"));
                    }
                }
                Ok(())
            }
            Figure::Table(t) => {
                if !t.from.is_null() {
                    return if t.from["file"].as_str().is_none_or(str::is_empty) { Err("table: from needs a file".into()) } else { Ok(()) };
                }
                if t.columns.is_empty() || t.columns.len() > MAX_COLUMNS {
                    return Err(format!("table: 1 to {MAX_COLUMNS} columns are needed (or from: real data)"));
                }
                if t.rows.len() > MAX_ROWS {
                    return Err(format!("table: at most {MAX_ROWS} rows"));
                }
                match t.rows.iter().position(|r| r.len() != t.columns.len()) {
                    Some(i) => Err(format!("table: row {} has {} cells but there are {} columns", i + 1, t.rows[i].len(), t.columns.len())),
                    None => Ok(()),
                }
            }
        }
    }

    /// Put real data into a figure that names it with `from`: a plot takes its `x` column as
    /// the axis and each `y` column as a series; a table takes the columns and rows as they are.
    pub fn fill(&mut self, columns: &[String], rows: &[Vec<Value>]) -> Result<(), String> {
        let at = |name: &str| columns.iter().position(|c| c == name).ok_or_else(|| format!("no column '{name}' (there are: {})", columns.join(", ")));
        match self {
            Figure::Plot(p) => {
                let rows = &rows[..rows.len().min(MAX_POINTS)];
                if let Some(x) = p.from["x"].as_str().filter(|x| !x.is_empty()) {
                    let i = at(x)?;
                    p.x = rows.iter().map(|r| r[i].clone()).collect();
                    if p.x_label.is_empty() {
                        p.x_label = x.into();
                    }
                }
                let ys: Vec<String> = p.from["y"].as_array().into_iter().flatten().filter_map(|c| c.as_str().map(String::from)).collect();
                p.series = ys.iter().map(|name| at(name).map(|i| Series { name: name.clone(), y: rows.iter().map(|r| number(&r[i])).collect(), color: String::new() })).collect::<Result<_, _>>()?;
                Ok(())
            }
            Figure::Table(t) => {
                t.columns = columns.iter().take(MAX_COLUMNS).cloned().collect();
                t.rows = rows.iter().take(MAX_ROWS).map(|r| r.iter().take(MAX_COLUMNS).cloned().collect()).collect();
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn err(kind: &str, v: Value) -> String {
        Figure::read(kind, &v).unwrap_err()
    }

    #[test]
    fn a_figure_is_read_from_named_arguments_and_round_trips() {
        let f = Figure::read("plot", &json!({"title": "Growth", "x": ["a", "b"], "series": [{"name": "s", "y": [1, 2.5]}]})).unwrap();
        assert_eq!((f.kind(), f.title()), ("plot", "Growth"));
        assert_eq!(f.line(), "plot 'Growth' (line, 1 series, 2 points)");
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v["kind"], "plot");
        assert_eq!(serde_json::from_value::<Figure>(v).unwrap(), f);
    }

    #[test]
    fn a_figure_that_breaks_the_structure_is_refused_with_the_reason() {
        assert!(err("plot", json!({"series": [{"y": [1]}]})).contains("title"));
        assert!(err("plot", json!({"title": "t"})).contains("series"));
        assert!(err("plot", json!({"title": "t", "x": [1, 2, 3], "series": [{"name": "s", "y": [1]}]})).contains("1 values but x has 3"));
        assert!(err("plot", json!({"title": "t", "chart": "pie", "series": [{"y": [1]}]})).contains("not one of line"));
        assert!(err("plot", json!({"title": "t", "chart": "scatter", "x": ["a"], "series": [{"y": [1]}]})).contains("numbers in x"));
        assert!(err("graph", json!({"title": "t", "nodes": [{"id": "a"}], "edges": [{"from": "a", "to": "b"}]})).contains("not in nodes"));
        assert!(err("graph", json!({"title": "t", "nodes": [{"id": "a"}, {"id": "a"}]})).contains("used twice"));
        assert!(err("draw", json!({"title": "t", "shapes": [{"shape": "star"}]})).contains("not one of line"));
        assert!(err("draw", json!({"title": "t", "shapes": [{"shape": "circle", "x": 5, "y": 5}]})).contains("needs r"));
        assert!(err("draw", json!({"title": "t", "shapes": [{"shape": "text", "x": 5, "y": 5, "text": "hi", "color": "neon"}]})).contains("colour 'neon'"));
        assert!(err("table", json!({"title": "t", "columns": ["a", "b"], "rows": [[1]]})).contains("row 1 has 1 cells"));
        assert!(err("plot", json!("just text")).contains("named"));
    }

    #[test]
    fn real_data_fills_a_plot_and_a_table() {
        let mut p = Figure::read("plot", &json!({"title": "Commits", "from": {"file": "commits.csv", "x": "day", "y": ["commits", "lines"]}})).unwrap();
        assert_eq!(p.from().unwrap()["file"], "commits.csv");
        let cols = ["day".to_string(), "commits".into(), "lines".into()];
        let rows = vec![vec![json!("mon"), json!(3), json!("1,200")], vec![json!("tue"), json!("x"), json!(40)]];
        p.fill(&cols, &rows).unwrap();
        let Figure::Plot(pl) = &p else { panic!() };
        assert_eq!(pl.x, vec![json!("mon"), json!("tue")]);
        assert_eq!(pl.series[0].y, vec![Some(3.0), None], "what is not a number is a gap");
        assert_eq!(pl.series[1].y, vec![Some(1200.0), Some(40.0)], "numbers written as text are read");
        assert_eq!(pl.x_label, "day");
        let mut bad = Figure::read("plot", &json!({"title": "t", "from": {"file": "f.csv", "y": ["nope"]}})).unwrap();
        assert!(bad.fill(&cols, &rows).unwrap_err().contains("no column 'nope'"));
        let mut t = Figure::read("table", &json!({"title": "Rows", "from": {"file": "commits.csv"}})).unwrap();
        t.fill(&cols, &rows).unwrap();
        let Figure::Table(tb) = &t else { panic!() };
        assert_eq!((tb.columns.len(), tb.rows.len()), (3, 2));
    }

    #[test]
    fn values_read_as_numbers_and_words() {
        assert_eq!(number(&json!("12.5")), Some(12.5));
        assert_eq!(number(&json!("n/a")), None);
        assert_eq!([word(&json!(3)), word(&json!(2.50)), word(&json!("x")), word(&Value::Null)], ["3", "2.5", "x", ""]);
    }
}
