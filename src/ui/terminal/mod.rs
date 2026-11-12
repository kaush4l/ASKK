//! # Terminal: askk in a terminal
//!
//! The same questions a page asks, shown in a terminal, in one of two ways:
//!
//! | way | when | what it is |
//! | --- | --- | --- |
//! | the full screen | a person sits at a real terminal (`askk terminal`) | a client of the service like herdr's: a sidebar of every box, tabs of split panes, a terminal box live in a pane, keys after `ctrl+b`, the mouse; leaving it leaves everything running |
//! | lines | the lines go to a pipe or a file, a question is given on the command line, or `--lines` is said | what you type is a question or a command, and the answer is written under it: what a script reads |
//!
//! Both ask through a [`Door`]:
//!
//! | door | who answers | use |
//! | --- | --- | --- |
//! | [`Door::Here`] | this process: it is the host (`askk terminal`) | the app as one terminal process |
//! | [`Door::There`] | a running askk server, over `/ask` (`askk terminal --to http://127.0.0.1:8090`) | a terminal beside the long-running service |
//!
//! In lines, what you type is a question for the chosen engine, or a command:
//!
//! ```text
//! /engines        every engine          /history   the conversation kept
//! /use <path>     choose an engine      /steps     what the last run did
//! /can            what this build can do  /boxes     every session, what needs you first
//! /quit
//! ```
//!
//! | file | holds |
//! | --- | --- |
//! | this file | the door, the lines session (what is asked, in which order), the loop that reads lines |
//! | `layout.rs` | what every line looks like: head, run, answer, commands; with colour or plain |
//! | `panes.rs` | the full screen's tabs of split panes, as plain values |
//! | `events.rs` | what the full screen is told (a key, an answer, a change) and what it asks for |
//! | `app.rs` | the full screen's whole behaviour: what happened in, what to ask out |
//! | `picture.rs` | the app as the values that are drawn: the panes in view, the tabs, the foot |
//! | `draw.rs` | the full screen as cells, from values |
//! | `client.rs` | the real terminal (keys, mouse, cells) and the real service, around `app.rs` |
//!
//! Nothing here decides what a line says about a run, in which order the boxes come, or what
//! a key sends: that is `ui/features/` (`talk.rs`, `run.rs`, `boxes.rs`, `terminals.rs`).
//!
//! Colour and emphasis are used only when the lines go to a terminal a person is looking at.
//! Sent to a file or another program (a pipe), or with `NO_COLOR` set, the same lines are
//! plain text, so a script can read them.
pub mod app;
pub mod client;
pub mod draw;
pub mod events;
pub mod layout;
pub mod panes;
mod picture;
use crate::api::{Busy, ChatTurn};
use crate::core::caps::Cap;
use crate::core::run::Run;
use crate::core::boxes::SessionBox;
use crate::ui::features::boxes::{line as box_line, order, Seen};
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
    Look { styled: std::io::stdout().is_terminal() && !crate::core::places::plain_lines() }
}

/// Where the terminal asks.
pub enum Door {
    Here,
    /// The address of an askk server (`http://127.0.0.1:8090`).
    There(String),
}

/// The one connection to a server: asked again and again (every key typed is a question),
/// it stays open between questions.
fn http() -> &'static reqwest::Client {
    static HTTP: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    HTTP.get_or_init(reqwest::Client::new)
}

impl Door {
    pub(crate) async fn ask<T: serde::de::DeserializeOwned>(&self, name: &str, args: Value) -> Result<T, String> {
        let v = match self {
            Door::Here => crate::api::ask::ask(name, args).await?,
            Door::There(base) => {
                let at = format!("{}/ask/{name}", base.trim_end_matches('/').trim_end_matches("/ask"));
                let res = http().post(&at).json(&args).send().await.map_err(|e| format!("no askk server answered at {base} ({e}). Start one with ./scripts/run.sh"))?;
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
            // The same list the page's pill shows, in the same order. A terminal keeps no
            // memory of what it saw, so nothing here is "done": it is idle or it is not.
            "/boxes" => self.door.ask::<Vec<SessionBox>>("boxes", json!({})).await.map(|boxes| {
                let seen = Seen::default();
                order(&boxes, &seen).iter().map(|b| format!(" {}", box_line(b, &seen))).collect::<Vec<_>>().join("\n")
            }),
            "/history" => match self.engine() {
                Ok(path) => self.door.ask::<Vec<ChatTurn>>("engine_chat", json!({"path": path})).await.map(|chat| layout::turn_lines(self.look, &talk::turns(chat)).join("\n")),
                Err(e) => Err(e),
            },
            w if w.starts_with('/') => Err(format!("'{w}' is not a command. There are: /engines /use <path> /history /steps /boxes /can /quit")),
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

/// Be the full screen for a person at a real terminal, until they leave (`client.rs`). The
/// first pane shows the engine named, else the one a person talks to first.
pub fn full_screen(rt: &tokio::runtime::Runtime, door: Door, engine: Option<String>) -> Result<(), String> {
    let host = match &door {
        Door::Here => "its own host".to_string(),
        Door::There(base) => base.trim_start_matches("http://").trim_start_matches("https://").trim_end_matches('/').to_string(),
    };
    rt.block_on(async {
        let engines: Vec<String> = door.ask("engine_paths", json!({})).await?;
        let first = match engine {
            Some(path) if engines.contains(&path) => Some(path),
            Some(path) => return Err(format!("no engine '{path}'. There are: {}", engines.join(", "))),
            None => talk::first_choice(&engines).and_then(|i| engines.get(i).cloned()),
        };
        client::run(door, first.map(|path| crate::ui::features::terminals::engine_box(&path)).unwrap_or_default(), host).await
    })
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
