//! # Terminal: askk as lines in a terminal
//!
//! The same questions a page asks, shown as text. It asks through a [`Door`]:
//!
//! | door | who answers | use |
//! | --- | --- | --- |
//! | [`Door::Here`] | this process: it is the host (`askk terminal`) | the app as one terminal process |
//! | [`Door::There`] | a running askk server, over `/ask` (`askk terminal --to http://127.0.0.1:8090`) | a terminal beside the long-running service |
//!
//! What you type is a question for the chosen engine, or a command:
//!
//! ```text
//! /engines        every engine          /history   the conversation kept
//! /use <path>     choose an engine      /steps     what the last run did
//! /can            what this build can do  /quit
//! ```
//!
//! Nothing here decides what a line says about a run: that is `ui/features/talk.rs`.
use crate::api::ChatTurn;
use crate::core::caps::Cap;
use crate::core::run::Run;
use crate::ui::features::talk;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// Where the terminal asks.
pub enum Door {
    Here,
    /// The address of an askk server (`http://127.0.0.1:8090`).
    There(String),
}

impl Door {
    async fn ask<T: serde::de::DeserializeOwned>(&self, name: &str, args: Value) -> Result<T, String> {
        let v = match self {
            Door::Here => crate::api::ask::ask(name, args).await?,
            Door::There(base) => {
                let at = format!("{}/ask/{name}", base.trim_end_matches('/').trim_end_matches("/ask"));
                let res = reqwest::Client::new().post(&at).json(&args).send().await.map_err(|e| format!("no askk server answered at {base} ({e}). Start one with ./scripts/run.sh"))?;
                let v: Value = res.json().await.map_err(|e| format!("the server's reply could not be read: {e}"))?;
                match v.get("error").and_then(Value::as_str) {
                    Some(e) => return Err(e.to_string()),
                    None => v["ok"].clone(),
                }
            }
        };
        serde_json::from_value(v).map_err(|e| format!("the answer to '{name}' is not what this terminal expects: {e}"))
    }
}

/// One terminal session's memory: the engines there are and the one chosen.
pub struct Session {
    door: Door,
    engines: Vec<String>,
    chosen: Option<usize>,
}

impl Session {
    /// Open the door: learn the engines and choose the first one to talk to.
    pub async fn open(door: Door, engine: Option<String>) -> Result<Session, String> {
        let engines: Vec<String> = door.ask("engine_paths", json!({})).await?;
        let chosen = match engine {
            Some(path) => Some(engines.iter().position(|e| *e == path).ok_or_else(|| format!("no engine '{path}'. There are: {}", engines.join(", ")))?),
            None => talk::first_choice(&engines),
        };
        Ok(Session { door, engines, chosen })
    }

    fn engine(&self) -> Result<String, String> {
        self.chosen.and_then(|i| self.engines.get(i).cloned()).ok_or_else(|| "no engine is booted, so there is no one to ask".to_string())
    }

    /// The first lines a person sees.
    pub async fn greeting(&self) -> String {
        let caps: Vec<Cap> = self.door.ask("capabilities", json!({})).await.unwrap_or_default();
        let has: Vec<&str> = caps.iter().filter(|c| c.here).map(|c| c.name.as_str()).collect();
        let whom = self.engine().unwrap_or_else(|e| e);
        format!("askk · {} engines · this build has: {}\ntalking to {whom}   (/engines /use <path> /history /steps /can /quit)", self.engines.len(), has.join(", "))
    }

    /// What the last run did, as lines.
    async fn steps(&self) -> Result<Vec<String>, String> {
        let path = self.engine()?;
        let runs: Vec<Run> = self.door.ask("engine_runs", json!({"path": path})).await?;
        let Some(last) = runs.last() else { return Ok(vec!["this engine has not run yet".into()]) };
        let run: Run = self.door.ask("engine_run", json!({"path": path, "id": last.id})).await?;
        Ok(talk::stages(&run))
    }

    /// Answer one line a person typed. `None` means they asked to leave.
    pub async fn line(&mut self, line: &str) -> Option<Result<String, String>> {
        let line = line.trim();
        let (word, rest) = line.split_once(' ').unwrap_or((line, ""));
        Some(match word {
            "" => Ok(String::new()),
            "/quit" | "/exit" => return None,
            "/engines" => Ok(self.engines.iter().enumerate().map(|(i, e)| format!("{} {e}", if Some(i) == self.chosen { "→" } else { " " })).collect::<Vec<_>>().join("\n")),
            "/use" => match self.engines.iter().position(|e| e == rest.trim()) {
                Some(i) => {
                    self.chosen = Some(i);
                    Ok(format!("talking to {}", self.engines[i]))
                }
                None => Err(format!("no engine '{}'. /engines lists them", rest.trim())),
            },
            "/can" => self.door.ask::<Vec<Cap>>("capabilities", json!({})).await.map(|caps| caps.iter().map(|c| format!("{} {}: {}", if c.here { "✓" } else { "—" }, c.name, c.note)).collect::<Vec<_>>().join("\n")),
            "/steps" => self.steps().await.map(|l| l.join("\n")),
            "/history" => match self.engine() {
                Ok(path) => self.door.ask::<Vec<ChatTurn>>("engine_chat", json!({"path": path})).await.map(|chat| talk::turns(chat).into_iter().map(|(who, text)| format!("{who}: {text}")).collect::<Vec<_>>().join("\n")),
                Err(e) => Err(e),
            },
            w if w.starts_with('/') => Err(format!("'{w}' is not a command. There are: /engines /use <path> /history /steps /can /quit")),
            _ => self.question(line).await,
        })
    }

    /// Ask the chosen engine; show what its loop did, then its answer.
    pub async fn question(&self, text: &str) -> Result<String, String> {
        let path = self.engine()?;
        let answer: String = self.door.ask("run_engine", json!({"path": path, "input": text})).await?;
        let steps = self.steps().await.unwrap_or_default();
        Ok(format!("{}\n\n{answer}", steps.join("\n")))
    }
}

/// Read lines until the input ends or the person leaves. An error is said and the session
/// goes on: a terminal left open for days must not end because one question failed.
pub fn talk_until_done(rt: &tokio::runtime::Runtime, mut session: Session, input: impl BufRead, mut out: impl Write) {
    let _ = writeln!(out, "{}", rt.block_on(session.greeting()));
    let _ = write!(out, "> ");
    let _ = out.flush();
    for line in input.lines() {
        let Ok(line) = line else { break };
        match rt.block_on(session.line(&line)) {
            None => break,
            Some(Ok(said)) if said.is_empty() => {}
            Some(Ok(said)) => {
                let _ = writeln!(out, "{said}");
            }
            Some(Err(e)) => {
                let _ = writeln!(out, "could not: {e}");
            }
        }
        let _ = write!(out, "> ");
        let _ = out.flush();
    }
    let _ = writeln!(out);
}
