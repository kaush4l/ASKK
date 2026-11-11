//! # alert
//! A long-running observation that wakes the engine on an event. Config:
//! `source: {tool, args}` (returns a number), `every_ms` (poll period), `when` (predicate),
//! `wake` (input sent to the engine; `{value}` is replaced), `keep` (series length, default 500).
//! State: `series`, `fired`, `was` (edge trigger: fires when `when` turns true, not while it
//! stays true), `pending`.
//!
//! `when` is `term op term`, op one of `> < >= <= ==`, term a number or an indicator over the
//! series: `last`, `sma(n)`, `ema(n)`, `min(n)`, `max(n)`, `change(n)`, `pct(n)`.
//! Stock example: source `quote {symbol: AAPL}`, every 60000, when `sma(5) > sma(20)`,
//! wake `AAPL 5/20 golden cross at {value}`.
use crate::core::{read, value, Call, Component, Event, Spec, Watch};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Polls `source` every `every_ms`, keeps a series, wakes the engine with `wake` when `when` turns true.";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    #[serde(default)]
    source: Call,
    #[serde(default)]
    every_ms: u64,
    #[serde(default)]
    when: String,
    #[serde(default)]
    wake: String,
    #[serde(default)]
    keep: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    #[serde(default)]
    series: Vec<f64>,
    #[serde(default)]
    fired: u64,
    #[serde(default)]
    was: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending: Option<String>,
}

pub struct Alert {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let cfg: Cfg = read(&s.config)?;
    if !cfg.when.is_empty() {
        Pred::parse(&cfg.when)?;
    }
    Ok(Box::new(Alert { name: s.name, cfg, st: read(&s.state)? }))
}

#[derive(Debug, PartialEq)]
enum Term {
    Num(f64),
    Ind(String, usize),
}

#[derive(Debug, PartialEq)]
pub struct Pred {
    lhs: Term,
    op: String,
    rhs: Term,
}

fn term(s: &str) -> Result<Term, String> {
    let s = s.trim();
    if let Ok(n) = s.parse() {
        return Ok(Term::Num(n));
    }
    let (name, arg) = match s.split_once('(') {
        Some((n, rest)) => (n.trim(), rest.trim_end_matches(')').trim()),
        None => (s, ""),
    };
    if !["last", "sma", "ema", "min", "max", "change", "pct"].contains(&name) {
        return Err(format!("unknown indicator '{name}'"));
    }
    let n = if arg.is_empty() { 1 } else { arg.parse().map_err(|_| format!("bad window '{arg}'"))? };
    Ok(Term::Ind(name.into(), n))
}

impl Pred {
    pub fn parse(s: &str) -> Result<Self, String> {
        for op in [">=", "<=", "==", ">", "<"] {
            if let Some((l, r)) = s.split_once(op) {
                return Ok(Pred { lhs: term(l)?, op: op.into(), rhs: term(r)? });
            }
        }
        Err(format!("no comparison in '{s}'"))
    }

    /// `None` when the series is too short to say.
    pub fn eval(&self, xs: &[f64]) -> Option<bool> {
        let (a, b) = (value_of(&self.lhs, xs)?, value_of(&self.rhs, xs)?);
        Some(match self.op.as_str() {
            ">" => a > b,
            "<" => a < b,
            ">=" => a >= b,
            "<=" => a <= b,
            _ => (a - b).abs() < f64::EPSILON,
        })
    }
}

fn value_of(t: &Term, xs: &[f64]) -> Option<f64> {
    let (name, n) = match t {
        Term::Num(v) => return Some(*v),
        Term::Ind(name, n) => (name.as_str(), *n),
    };
    let last = *xs.last()?;
    let win = |k: usize| (xs.len() >= k && k > 0).then(|| &xs[xs.len() - k..]);
    match name {
        "last" => Some(last),
        "sma" => win(n).map(|w| w.iter().sum::<f64>() / n as f64),
        "ema" => win(n).map(|_| {
            let k = 2.0 / (n as f64 + 1.0);
            xs.iter().skip(1).fold(xs[0], |e, x| x * k + e * (1.0 - k))
        }),
        "min" => win(n).map(|w| w.iter().cloned().fold(f64::INFINITY, f64::min)),
        "max" => win(n).map(|w| w.iter().cloned().fold(f64::NEG_INFINITY, f64::max)),
        "change" => (xs.len() > n).then(|| last - xs[xs.len() - 1 - n]),
        "pct" => (xs.len() > n).then(|| (last - xs[xs.len() - 1 - n]) / xs[xs.len() - 1 - n] * 100.0),
        _ => None,
    }
}

impl Component for Alert {
    fn kind(&self) -> &'static str { "alert" }
    fn category(&self) -> &'static str { "live" }
    fn icon(&self) -> &'static str { "bell" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::World }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { value(&self.st) }
    fn activity(&self) -> String {
        if self.st.pending.is_some() { "fired".into() } else { "armed".into() }
    }
    fn view(&self) -> crate::core::node::Node {
        let last = self.st.series.last().map(|v| v.to_string()).unwrap_or_else(|| "–".into());
        super::tile(&self.name, "alert", [
            format!("{} every {}ms", self.cfg.source.tool, self.cfg.every_ms),
            format!("when {}", self.cfg.when),
            format!("last {last} · {} polls · fired {}", self.st.series.len(), self.st.fired),
        ])
    }
    fn on(&mut self, ev: &Event) {
        let Event::Observed { name, value } = ev else { return };
        if *name != self.name {
            return;
        }
        let keep = if self.cfg.keep == 0 { 500 } else { self.cfg.keep };
        self.st.series.push(*value);
        if self.st.series.len() > keep {
            self.st.series.drain(..self.st.series.len() - keep);
        }
        let now = Pred::parse(&self.cfg.when).ok().and_then(|p| p.eval(&self.st.series)).unwrap_or(false);
        if now && !self.st.was {
            self.st.fired += 1;
            self.st.pending = Some(self.cfg.wake.replace("{value}", &value.to_string()));
        }
        self.st.was = now;
    }
    fn prompt(&self) -> Option<String> {
        (!self.cfg.when.is_empty()).then(|| {
            format!("watching {} every {}ms; fires when {}; fired {} times", self.cfg.source.tool, self.cfg.every_ms, self.cfg.when, self.st.fired)
        })
    }
    fn watch(&self) -> Option<Watch> {
        (!self.cfg.source.tool.is_empty() && !self.cfg.when.is_empty()).then(|| Watch {
            name: self.name.clone(),
            every_ms: self.cfg.every_ms.max(1000),
            source: self.cfg.source.clone(),
        })
    }
    fn wake(&mut self) -> Option<String> {
        self.st.pending.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn indicators() {
        let xs = [1.0, 2.0, 3.0, 4.0, 5.0];
        let p = |s: &str| Pred::parse(s).unwrap().eval(&xs);
        assert_eq!(p("sma(5) == 3"), Some(true));
        assert_eq!(p("last > max(4)"), Some(false));
        assert_eq!(p("last >= max(4)"), Some(true));
        assert_eq!(p("change(2) == 2"), Some(true));
        assert_eq!(p("pct(4) == 400"), Some(true));
        assert_eq!(p("sma(9) > 0"), None, "not enough data");
        assert!(Pred::parse("rsi(14) > 70").is_err());
        assert!(Pred::parse("sma(5)").is_err());
    }

    #[test]
    fn fires_once_when_the_condition_turns_true() {
        let mut a = new(Spec {
            kind: "alert".into(),
            name: "cross".into(),
            config: json!({"source": {"tool": "quote"}, "every_ms": 60000, "when": "sma(2) > sma(3)", "wake": "cross at {value}"}),
            state: Value::Null,
        })
        .unwrap();
        assert_eq!(a.watch().unwrap().every_ms, 60000);
        let mut wakes = vec![];
        for v in [5.0, 4.0, 3.0, 4.0, 6.0, 7.0, 3.0, 1.0, 8.0, 9.0] {
            a.on(&Event::Observed { name: "cross".into(), value: v });
            wakes.extend(a.wake());
        }
        assert_eq!(wakes, ["cross at 6", "cross at 8"]);
        assert_eq!(a.state()["fired"], 2);
        a.on(&Event::Observed { name: "other".into(), value: 100.0 });
        assert_eq!(a.state()["series"].as_array().unwrap().len(), 10);
    }
}
