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
//! | file | holds |
//! | --- | --- |
//! | this file | the door, the session (what is asked, in which order), the loop that reads lines |
//! | `layout.rs` | what every line looks like: head, run, answer, commands; with colour or plain |
//!
//! Nothing here decides what a line says about a run: that is `ui/features/` (`talk.rs`, `run.rs`).
//!
//! Colour and emphasis are used only when the lines go to a terminal a person is looking at.
//! Sent to a file or another program (a pipe), or with `NO_COLOR` set, the same lines are
//! plain text, so a script can read them.
pub mod layout;
use crate::api::{Busy, ChatTurn};
use crate::core::caps::Cap;
use crate::core::run::Run;
use crate::ui::features::{run as words, talk};
use layout::Look;
use serde_json::{json, Value};
use std::io::{BufRead, IsTerminal, Write};

/// How often the terminal looks at a run that is going, to show where it is.
const LOOK_EVERY_MS: u64 = 200;

/// Whether this process's lines may carry colour: only on a terminal, and not when the
/// person asked for none (`NO_COLOR`, the convention of no-color.org) or the terminal says it
/// cannot (`TERM=dumb`). The environment is read through the one door for it.
fn look() -> Look {
    let named = |name: &str| crate::core::places::secret(name);
    Look { styled: std::io::stdout().is_terminal() && named("NO_COLOR").is_none() && named("TERM").as_deref() != Some("dumb") }
}

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
    look: Look,
}

impl Session {
    /// Open the door: learn the engines and choose the first one to talk to.
    pub async fn open(door: Door, engine: Option<String>) -> Result<Session, String> {
        let engines: Vec<String> = door.ask("engine_paths", json!({})).await?;
        let chosen = match engine {
            Some(path) => Some(engines.iter().position(|e| *e == path).ok_or_else(|| format!("no engine '{path}'. There are: {}", engines.join(", ")))?),
            None => talk::first_choice(&engines),
        };
        Ok(Session { door, engines, chosen, look: look() })
    }

    fn engine(&self) -> Result<String, String> {
        self.chosen.and_then(|i| self.engines.get(i).cloned()).ok_or_else(|| "no engine is booted, so there is no one to ask".to_string())
    }

    /// The first lines a person sees: who is being talked to and how it is, what this build
    /// has, the commands.
    pub async fn greeting(&self) -> String {
        let caps: Vec<Cap> = self.door.ask("capabilities", json!({})).await.unwrap_or_default();
        let whom = self.engine().unwrap_or_else(|e| e);
        let busy: Vec<Busy> = self.door.ask("busy", json!({})).await.unwrap_or_default();
        let (activity, detail) = busy.iter().find(|b| b.path == whom).map(|b| (b.activity.as_str(), b.detail.as_str())).unwrap_or_default();
        layout::greeting(self.look, &whom, &words::doing(activity, detail), words::at_work(activity), self.engines.len(), &caps)
    }

    /// The last run in full, if the engine has run and its record is kept.
    async fn last_run(&self) -> Result<Option<Run>, String> {
        let path = self.engine()?;
        let runs: Vec<Run> = self.door.ask("engine_runs", json!({"path": path})).await?;
        match runs.last() {
            Some(last) => self.door.ask("engine_run", json!({"path": path, "id": last.id})).await.map(Some),
            None => Ok(None),
        }
    }

    /// What the last run did, as lines.
    async fn steps(&self) -> Result<Vec<String>, String> {
        Ok(match self.last_run().await? {
            Some(run) => layout::run_lines(self.look, &run),
            None => vec!["this engine has not run yet".into()],
        })
    }

    /// Answer one line a person typed. `None` means they asked to leave.
    pub async fn line(&mut self, line: &str) -> Option<Result<String, String>> {
        let line = line.trim();
        let (word, rest) = line.split_once(' ').unwrap_or((line, ""));
        Some(match word {
            "" => Ok(String::new()),
            "/quit" | "/exit" => return None,
            "/engines" => Ok(layout::engine_lines(self.look, &self.engines, self.chosen).join("\n")),
            "/use" => match self.engines.iter().position(|e| e == rest.trim()) {
                Some(i) => {
                    self.chosen = Some(i);
                    Ok(format!("talking to {}", self.engines[i]))
                }
                None => Err(format!("no engine '{}'. /engines lists them", rest.trim())),
            },
            "/can" => self.door.ask::<Vec<Cap>>("capabilities", json!({})).await.map(|caps| layout::cap_lines(self.look, &caps).join("\n")),
            "/steps" => self.steps().await.map(|l| l.join("\n")),
            "/history" => match self.engine() {
                Ok(path) => self.door.ask::<Vec<ChatTurn>>("engine_chat", json!({"path": path})).await.map(|chat| layout::turn_lines(self.look, &talk::turns(chat)).join("\n")),
                Err(e) => Err(e),
            },
            w if w.starts_with('/') => Err(format!("'{w}' is not a command. There are: /engines /use <path> /history /steps /can /quit")),
            // After an answer, the commands again: the last line always says what can be typed.
            _ => self.question(line).await.map(|said| format!("{said}\n{}\n{}", layout::rule(self.look), layout::commands(self.look))),
        })
    }

    /// Ask the chosen engine; show what its loop did, then its answer set apart.
    pub async fn question(&self, text: &str) -> Result<String, String> {
        let path = self.engine()?;
        let answer: String = self.working(&path, self.door.ask("run_engine", json!({"path": path, "input": text}))).await?;
        let run = self.last_run().await.unwrap_or_default();
        Ok(layout::asked(self.look, run.as_ref(), &answer))
    }

    /// Wait for `work` (a run of the engine at `path`). On a terminal a person is looking at,
    /// one line says where the run is while it goes, written over itself and wiped at the end;
    /// anywhere else nothing is written until the work is done.
    async fn working<T>(&self, path: &str, work: impl std::future::Future<Output = T>) -> T {
        if !self.look.styled {
            return work.await;
        }
        let mut work = std::pin::pin!(work);
        let started = web_time::Instant::now();
        let mut out = std::io::stdout();
        loop {
            let tick = std::pin::pin!(tokio::time::sleep(std::time::Duration::from_millis(LOOK_EVERY_MS)));
            match futures::future::select(work.as_mut(), tick).await {
                futures::future::Either::Left((done, _)) => {
                    let _ = write!(out, "\r\x1b[2K");
                    let _ = out.flush();
                    return done;
                }
                futures::future::Either::Right(_) => {
                    let runs: Vec<Run> = self.door.ask("engine_runs", json!({"path": path})).await.unwrap_or_default();
                    if let Some(run) = runs.last().filter(|r| r.running()) {
                        let _ = write!(out, "\r\x1b[2K{}", layout::live_line(self.look, run, started.elapsed().as_millis() as u64));
                        let _ = out.flush();
                    }
                }
            }
        }
    }
}

/// Read lines until the input ends or the person leaves. An error is said and the session
/// goes on: a terminal left open for days must not end because one question failed.
pub fn talk_until_done(rt: &tokio::runtime::Runtime, mut session: Session, input: impl BufRead, mut out: impl Write) {
    let look = session.look;
    let _ = writeln!(out, "{}", rt.block_on(session.greeting()));
    let _ = write!(out, "{}", layout::prompt(look));
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
                let _ = writeln!(out, "{}", layout::failed(look, &e));
            }
        }
        let _ = write!(out, "{}", layout::prompt(look));
        let _ = out.flush();
    }
    let _ = writeln!(out);
}
