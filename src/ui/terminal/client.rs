//! # Client: the full screen on a real terminal, asking a real service
//!
//! `app.rs` knows what to show and what to ask; this file is the two ends it has no hands
//! for: the terminal a person sits at (keys, the mouse, the cells), and the door to the
//! service (`api/`, through [`Door`]). Like herdr's client it is only the screen: what runs,
//! runs in the service, and leaving ([`Want::Leave`]) changes nothing there.
//!
//! | who | does |
//! | --- | --- |
//! | one thread | reads keys and the mouse, and hands each on as it happens |
//! | the feed | holds the question `changes` open and hands on what changed; says when the service is away, back, or was restarted |
//! | the typist | sends what was typed, in order; keys typed while a question is under way go together in the next one |
//! | every other question | is asked beside the others, so a slow answer holds up nothing; the same thing is never asked twice at once |
use super::app::{App, Got, Key, Mouse, Want};
use super::draw::{self, TALK};
use super::{layout, Door};
use crate::api::{Changed, ChatTurn};
use crate::core::boxes::SessionBox;
use crate::core::run::Run;
use crate::core::screen::Screen;
use crate::core::session::{self, Session};
use crate::ui::features::talk;
use crate::ui::features::terminals::{inside, Inside};
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

/// The boxes are not asked for more often than this, however fast a terminal's screen changes.
const BOXES_EVERY: Duration = Duration::from_millis(250);

/// What happened, and the name of the read it answers (so the same read can be asked again).
type Landed = (Option<String>, Got);

/// A key as the app names it.
fn key(e: event::KeyEvent) -> Option<Key> {
    if e.kind == KeyEventKind::Release {
        return None;
    }
    let name = match e.code {
        KeyCode::Char(c) => c.to_string(),
        KeyCode::F(n) => format!("F{n}"),
        other => match other {
            KeyCode::Enter => "Enter",
            KeyCode::Backspace => "Backspace",
            KeyCode::Tab | KeyCode::BackTab => "Tab",
            KeyCode::Esc => "Escape",
            KeyCode::Up => "ArrowUp",
            KeyCode::Down => "ArrowDown",
            KeyCode::Left => "ArrowLeft",
            KeyCode::Right => "ArrowRight",
            KeyCode::Home => "Home",
            KeyCode::End => "End",
            KeyCode::PageUp => "PageUp",
            KeyCode::PageDown => "PageDown",
            KeyCode::Delete => "Delete",
            KeyCode::Insert => "Insert",
            _ => return None,
        }
        .to_string(),
    };
    let held = |m: KeyModifiers| e.modifiers.contains(m);
    Some(Key { name, ctrl: held(KeyModifiers::CONTROL), alt: held(KeyModifiers::ALT), shift: held(KeyModifiers::SHIFT) || e.code == KeyCode::BackTab })
}

/// What a terminal event is to the app; `None` for what it has no use for.
fn happened(e: Event) -> Option<Got> {
    Some(match e {
        Event::Key(k) => Got::Key(key(k)?),
        Event::Paste(text) => Got::Paste(text),
        Event::Resize(cols, rows) => Got::Size(cols, rows),
        Event::Mouse(m) => Got::Mouse(match m.kind {
            MouseEventKind::Down(MouseButton::Left) => Mouse::Down(m.column, m.row),
            MouseEventKind::Drag(MouseButton::Left) => Mouse::Drag(m.column, m.row),
            MouseEventKind::Up(_) => Mouse::Up,
            MouseEventKind::ScrollUp => Mouse::Wheel(true, m.column, m.row),
            MouseEventKind::ScrollDown => Mouse::Wheel(false, m.column, m.row),
            _ => return None,
        }),
        _ => return None,
    })
}

/// An engine's or a session's pane as lines: the conversation, then what the last run did.
/// The same lines the lines mode writes (`layout.rs`), with the same colours.
async fn talk_lines(door: &Door, box_id: &str) -> Result<Vec<String>, String> {
    let lines = match inside(box_id) {
        Inside::Engine(path) => {
            let chat: Vec<ChatTurn> = door.ask("engine_chat", json!({"path": path})).await?;
            let mut lines = layout::turn_lines(TALK, &talk::turns(chat));
            let runs: Vec<Run> = door.ask("engine_runs", json!({"path": path})).await.unwrap_or_default();
            if let Some(last) = runs.last() {
                let run: Run = door.ask("engine_run", json!({"path": path, "id": last.id})).await.unwrap_or_else(|_| last.clone());
                lines.push(layout::rule(TALK));
                lines.extend(layout::run_lines(TALK, &run));
            }
            lines
        }
        Inside::Session(id) => {
            let all: Vec<Session> = door.ask("sessions", json!({})).await?;
            let s = all.into_iter().find(|s| s.id == id).ok_or_else(|| format!("session {id} is no longer kept"))?;
            let turns: Vec<(String, String)> = s.turns.iter().map(|t| (t.who.clone(), t.text.clone())).collect();
            let mut lines = layout::turn_lines(TALK, &turns);
            match s.state {
                session::State::Busy => lines.push(layout::heading(TALK, "its agent is working…")),
                session::State::Failed => lines.push(layout::failed(TALK, &s.error)),
                session::State::Idle => {}
            }
            lines
        }
        _ => vec![],
    };
    // A turn of several lines is several rows.
    Ok(lines.iter().flat_map(|l| l.split('\n')).map(String::from).collect())
}

/// Ask what the app wants, and say what came of it. `None`: it went well and there is
/// nothing to show for it.
async fn answer(door: &Door, want: Want) -> Result<Option<Got>, String> {
    Ok(match want {
        Want::Boxes => Some(Got::Boxes(door.ask::<Vec<SessionBox>>("boxes", json!({})).await?)),
        Want::Screen(id) => Some(Got::Screen(id.clone(), door.ask::<Screen>("terminal_screen", json!({"id": id})).await?)),
        Want::Talk(box_id) => Some(Got::Talk(box_id.clone(), talk_lines(door, &box_id).await?)),
        // The person's own shell, in the workspace.
        Want::Open { pane, cols, rows } => Some(Got::Opened(pane, door.ask::<String>("terminal_open", json!({"command": "", "place": "", "cols": cols, "rows": rows})).await?)),
        Want::Resize { id, cols, rows } => {
            door.ask::<()>("terminal_resize", json!({"id": id, "cols": cols, "rows": rows})).await?;
            None
        }
        Want::Close(id) => {
            door.ask::<()>("terminal_close", json!({"id": id})).await?;
            Some(Got::Said(format!("terminal {id} was ended, and its program with it")))
        }
        Want::Say { box_id, text } => match inside(&box_id) {
            Inside::Engine(path) => {
                door.ask::<String>("run_engine", json!({"path": path, "input": text})).await?;
                Some(Got::Said(format!("{path} answered")))
            }
            Inside::Session(id) => {
                door.ask::<()>("session_prompt", json!({"id": id, "text": text})).await?;
                None
            }
            _ => None,
        },
        Want::Type { .. } | Want::Leave => None,
    })
}

/// The name of a read, by which a second ask of the same thing is told from the first.
fn read(want: &Want) -> Option<String> {
    match want {
        Want::Boxes => Some("boxes".into()),
        Want::Screen(id) => Some(format!("screen {id}")),
        Want::Talk(box_id) => Some(format!("talk {box_id}")),
        _ => None,
    }
}

/// Who asks the service for the app.
struct Asker {
    door: Arc<Door>,
    landed: UnboundedSender<Landed>,
    typed: UnboundedSender<(String, String)>,
    /// The reads under way, and the ones asked for again meanwhile.
    flying: BTreeSet<String>,
    again: BTreeMap<String, Want>,
}

impl Asker {
    fn ask(&mut self, want: Want, after: Duration) {
        let name = read(&want);
        if let Some(name) = &name {
            // The same read is under way: once it lands, it is asked once more.
            if !self.flying.insert(name.clone()) {
                self.again.insert(name.clone(), want);
                return;
            }
        }
        if let Want::Type { id, keys } = want {
            let _ = self.typed.send((id, keys));
            return;
        }
        let (door, landed) = (self.door.clone(), self.landed.clone());
        tokio::spawn(async move {
            tokio::time::sleep(after).await;
            let got = match answer(&door, want).await {
                Ok(Some(got)) => got,
                Ok(None) if name.is_none() => return,
                // A read that brought nothing still has to be told as landed.
                Ok(None) => Got::Changed(vec![]),
                Err(e) => Got::Failed(e),
            };
            let _ = landed.send((name, got));
        });
    }

    /// A read landed: what was asked for again meanwhile is asked now.
    fn landed(&mut self, name: &str) {
        self.flying.remove(name);
        if let Some(want) = self.again.remove(name) {
            let after = if want == Want::Boxes { BOXES_EVERY } else { Duration::ZERO };
            self.ask(want, after);
        }
    }
}

/// Send what is typed, in the order it was typed. Keys for the same terminal that pile up
/// while a question is under way go together in the next one.
fn typist(door: Arc<Door>, landed: UnboundedSender<Landed>) -> UnboundedSender<(String, String)> {
    let (typed, mut waiting) = unbounded_channel::<(String, String)>();
    tokio::spawn(async move {
        let mut held: Option<(String, String)> = None;
        loop {
            let next = match held.take() {
                Some(next) => Some(next),
                None => waiting.recv().await,
            };
            let Some((id, mut keys)) = next else { break };
            while let Ok((other, more)) = waiting.try_recv() {
                if other == id {
                    keys.push_str(&more);
                } else {
                    held = Some((other, more));
                    break;
                }
            }
            if let Err(e) = door.ask::<()>("terminal_type", json!({"id": id, "keys": keys})).await {
                let _ = landed.send((None, Got::Failed(e)));
            }
        }
    });
    typed
}

/// Follow the change feed for as long as the window is open.
async fn feed(door: Arc<Door>, landed: UnboundedSender<Landed>) {
    let (mut epoch, mut seen, mut away) = (0u64, 0u64, false);
    while !landed.is_closed() {
        match door.ask::<Changed>("changes", json!({"epoch": epoch, "seen": seen})).await {
            Ok(c) => {
                // Another epoch is another run of the service: what this window holds is old.
                let restarted = epoch != 0 && c.epoch != epoch;
                if away || restarted {
                    let _ = landed.send((None, Got::Back(restarted)));
                }
                (epoch, seen, away) = (c.epoch, c.seq, false);
                if !c.keys.is_empty() && !restarted {
                    let _ = landed.send((None, Got::Changed(c.keys.into_iter().map(|(k, _)| k).collect())));
                }
            }
            Err(e) => {
                if !away {
                    let _ = landed.send((None, Got::Away(e)));
                }
                away = true;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

/// Be the full screen until the person leaves. `first` is the box the first pane shows;
/// `host` says who answers, for the head of the sidebar.
pub async fn run(door: Door, first: String, host: String) -> Result<(), String> {
    use ratatui::crossterm::execute;
    let door = Arc::new(door);
    let mut terminal = ratatui::try_init().map_err(|e| format!("this terminal cannot be drawn on as a full screen ({e}); `askk terminal --lines` writes lines instead"))?;
    let _ = execute!(std::io::stdout(), event::EnableMouseCapture, event::EnableBracketedPaste);
    let size = terminal.size().map(|s| (s.width, s.height)).unwrap_or((80, 24));
    let (landed, mut lands) = unbounded_channel::<Landed>();
    let keys = landed.clone();
    let reads = std::thread::Builder::new().name("terminal: keys".into()).spawn(move || {
        while let Ok(e) = event::read() {
            if happened(e).is_some_and(|got| keys.send((None, got)).is_err()) {
                break;
            }
        }
    });
    tokio::spawn(feed(door.clone(), landed.clone()));
    let mut asker = Asker { typed: typist(door.clone(), landed.clone()), door, landed, flying: BTreeSet::new(), again: BTreeMap::new() };
    let mut app = App::new(&host, &first, size.0, size.1);
    app.start().into_iter().for_each(|want| asker.ask(want, Duration::ZERO));
    let outcome = loop {
        if let Err(e) = reads.as_ref() {
            break Err(format!("the keys of this terminal cannot be read: {e}"));
        }
        let drawn = terminal.draw(|frame| {
            let area = frame.area();
            if let Some(cursor) = draw::draw(frame.buffer_mut(), area, &app.picture()) {
                frame.set_cursor_position(cursor);
            }
        });
        if let Err(e) = drawn {
            break Err(format!("the screen could not be drawn: {e}"));
        }
        // Everything that happened since the last look is taken in before drawing again.
        let Some(first) = lands.recv().await else { break Ok(()) };
        let mut all = vec![first];
        while let Ok(more) = lands.try_recv() {
            all.push(more);
        }
        let mut leave = false;
        for (name, got) in all {
            if let Some(name) = &name {
                asker.landed(name);
            }
            for want in app.on(got) {
                match want {
                    Want::Leave => leave = true,
                    want => asker.ask(want, Duration::ZERO),
                }
            }
        }
        if leave {
            break Ok(());
        }
    };
    let _ = execute!(std::io::stdout(), event::DisableBracketedPaste, event::DisableMouseCapture);
    ratatui::restore();
    outcome
}
