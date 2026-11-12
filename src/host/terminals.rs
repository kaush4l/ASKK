//! # Terminals, on this machine: the multiplexer
//!
//! The host's side of `core/terminals.rs`. Each terminal is a real pseudo-terminal (a PTY;
//! ConPTY on Windows) with a program in it, and it belongs to this process for the program's
//! whole life: nothing here knows whether a window is looking.
//!
//! | for each terminal | does |
//! | --- | --- |
//! | one thread that reads | takes what the program writes and works out the screen it makes ([`screen_of`]); answers the few questions a program asks its terminal (where the cursor is) |
//! | one thread that types | writes what was typed, in the order it was asked, so a program that is slow to read holds up nobody else |
//! | one thread that waits | notes how the program ended |
//!
//! A change of screen is marked on the change feed (`terminals/<id>`) at once when the
//! terminal was quiet, and then at most every [`PACE`], however fast the program writes.
//!
//! The program is started in a folder under the workspace, through the sandbox this build
//! has (`core/sandbox.rs`), and the box says how it is confined. When this process ends, the
//! terminals end with it: on purpose when the service is asked to stop ([`end_all`]), and by
//! the system's own hang-up when it is ended from outside.
use crate::core::changes;
use crate::core::held::Held;
use crate::core::screen::{Line, Screen, Span};
use crate::core::terminals::{self, Scrolled, Terminal, Terminals};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::num::NonZeroU16;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

/// The shortest time between two marks of one terminal: about 30 a second.
const PACE: Duration = Duration::from_millis(33);
/// How many terminals this process holds at most: a mistake in a script must not fill the machine.
const MOST: usize = 64;
/// How many rows that scrolled off the top of a screen are kept, to be looked back at.
const KEPT_ROWS: usize = 1000;
/// How long the name of the program in front is believed before the system is asked again.
const FRONT_FOR: Duration = Duration::from_millis(500);

/// What a program told its terminal besides what to show, and what the terminal owes it.
#[derive(Default)]
struct Heard {
    title: String,
    /// Answers to questions the program asked its terminal, not yet written back.
    owed: Vec<u8>,
}

impl vt100::Callbacks for Heard {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.title = String::from_utf8_lossy(title).into_owned();
    }
    fn unhandled_csi(&mut self, screen: &mut vt100::Screen, i1: Option<u8>, _: Option<u8>, params: &[&[u16]], c: char) {
        // A program may ask where the cursor is, whether the terminal is well, or what kind
        // it is, and wait for the answer: without one it hangs or draws wrongly.
        let first = params.first().and_then(|p| p.first()).copied().unwrap_or(0);
        match (i1, c, first) {
            (None, 'n', 6) => {
                let (row, col) = screen.cursor_position();
                self.owed.extend(format!("\x1b[{};{}R", row + 1, col + 1).bytes());
            }
            (None, 'n', 5) => self.owed.extend(b"\x1b[0n"),
            (None, 'c', 0) => self.owed.extend(b"\x1b[?1;2c"),
            _ => {}
        }
    }
}

/// A colour as the screen object writes it (`core/screen.rs`).
fn colour(c: vt100::Color) -> String {
    match c {
        vt100::Color::Default => String::new(),
        vt100::Color::Idx(i) => i.to_string(),
        vt100::Color::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
    }
}

/// What the program's bytes made of the screen, as the object every window draws.
fn screen_of(s: &vt100::Screen, title: &str, alive: bool, exit: Option<i32>) -> Screen {
    let (rows, cols) = s.size();
    let (rows, cols) = (rows.get(), cols.get());
    let mut lines = vec![];
    for r in 0..rows {
        let mut line = Line::default();
        for cell in (0..cols).filter_map(|c| s.cell(r, c)).filter(|cell| !cell.is_wide_continuation()) {
            let text = if cell.has_contents() { cell.contents().to_string() } else { " ".to_string() };
            line.push(Span { text, fg: colour(cell.fgcolor()), bg: colour(cell.bgcolor()), bold: cell.bold(), dim: cell.dim(), italic: cell.italic(), underline: cell.underline(), inverse: cell.inverse() });
        }
        // Blanks in the terminal's own look at the end of a row say nothing.
        if let Some(last) = line.spans.last_mut().filter(|l| l.same_look(&Span::default())) {
            last.text.truncate(last.text.trim_end_matches(' ').len());
            if last.text.is_empty() {
                line.spans.pop();
            }
        }
        lines.push(line);
    }
    while lines.last().is_some_and(|l| l.spans.is_empty()) {
        lines.pop();
    }
    let cursor = (!s.hide_cursor()).then(|| {
        let (row, col) = s.cursor_position();
        (col, row)
    });
    Screen { cols, rows, lines, cursor, title: title.to_string(), alive, exit }
}

/// The keys as the program expects them now. A program that draws its own screen (an editor,
/// a pager) asks for the arrow keys in another form; every window sends the usual one and
/// the service, which knows what the program asked for, turns them.
fn as_asked(keys: &str, application_cursor: bool) -> String {
    if !application_cursor {
        return keys.to_string();
    }
    ["A", "B", "C", "D", "H", "F"].iter().fold(keys.to_string(), |k, end| k.replace(&format!("\x1b[{end}"), &format!("\x1bO{end}")))
}

/// A program's name out of the path it was called by: `/bin/zsh` and `-zsh` are `zsh`.
fn name(path: &str) -> String {
    let last = path.trim().rsplit(['/', '\\']).next().unwrap_or_default();
    last.trim_start_matches('-').trim_end_matches(".exe").to_string()
}

/// What is started for `command`, and the name of the program a person would say runs:
/// the person's own shell when no command is named, else the system's shell running the
/// command line (so quotes, pipes and `&&` mean what they mean in a terminal).
fn argv(command: &str, shell: &str) -> (Vec<String>, String) {
    if command.is_empty() {
        // As a terminal starts it: a login shell reads the person's own settings.
        let argv = if cfg!(unix) { vec![shell.to_string(), "-l".to_string()] } else { vec![shell.to_string()] };
        return (argv, name(shell));
    }
    // `KEY=value program …`: the program is the first word that is not a setting.
    let program = command.split_whitespace().find(|w| !w.contains('=')).map(name).unwrap_or_default();
    let argv = if cfg!(unix) { vec!["/bin/sh".to_string(), "-c".to_string(), command.to_string()] } else { vec![shell.to_string(), "/C".to_string(), command.to_string()] };
    (argv, program)
}

/// One terminal this process holds.
struct Live {
    id: String,
    command: String,
    program: String,
    place: String,
    confined: String,
    /// The program the sandbox starts the real one through, when there is one: it is in
    /// front for a moment at the start, and is never what a person would say runs.
    wrapper: String,
    parser: Mutex<vt100::Parser<Heard>>,
    /// The terminal itself; taken away when it is closed.
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    /// The program's process number, which is also its group's (it leads a session of its own).
    #[cfg_attr(not(unix), allow(dead_code))]
    pid: Option<u32>,
    /// What is typed goes to the one thread that writes.
    typed: Mutex<mpsc::Sender<Vec<u8>>>,
    /// Whether the program still runs, and how it ended once it has.
    ended: Mutex<(bool, Option<i32>)>,
    /// The program in front, and when the system was last asked for it.
    front: Mutex<(Option<Instant>, String)>,
    /// A look at the program in front is owed: an answer that was not fresh went out.
    look_owed: AtomicBool,
}

static LIVE: Mutex<BTreeMap<u64, Arc<Live>>> = Mutex::new(BTreeMap::new());
static NEXT: AtomicU64 = AtomicU64::new(1);

fn no(id: &str) -> String {
    format!("no terminal '{id}' is held (it was closed, or the service was restarted since)")
}

fn find(id: &str) -> Result<Arc<Live>, String> {
    id.parse::<u64>().ok().and_then(|n| LIVE.held().get(&n).cloned()).ok_or_else(|| no(id))
}

/// The terminals whose screen changed since the last mark, and the bell that wakes the marker.
struct Marker {
    changed: Mutex<BTreeSet<String>>,
    bell: Condvar,
}

/// Note that the terminal `id` changed. The one marker thread marks it on the change feed:
/// at once when nothing was marked for a while, and then at most every [`PACE`].
fn changed(id: &str) {
    static MARKER: OnceLock<Option<&'static Marker>> = OnceLock::new();
    let marker = MARKER.get_or_init(|| {
        let m: &'static Marker = Box::leak(Box::new(Marker { changed: Mutex::new(BTreeSet::new()), bell: Condvar::new() }));
        let started = std::thread::Builder::new().name("terminals: marks".into()).spawn(move || loop {
            let ids = {
                let mut waiting = m.changed.held();
                while waiting.is_empty() {
                    waiting = m.bell.wait(waiting).unwrap_or_else(PoisonError::into_inner);
                }
                std::mem::take(&mut *waiting)
            };
            ids.iter().for_each(|id| changes::mark(&terminals::key(id)));
            std::thread::sleep(PACE);
        });
        started.is_ok().then_some(m)
    });
    match marker {
        Some(m) => {
            m.changed.held().insert(id.to_string());
            m.bell.notify_one();
        }
        // No thread could be started: every change is marked as it happens.
        None => changes::mark(&terminals::key(id)),
    }
}

impl Live {
    /// Take in what the program wrote.
    fn take(&self, bytes: &[u8]) {
        let owed = {
            let mut p = self.parser.held();
            p.process(bytes);
            std::mem::take(&mut p.callbacks_mut().owed)
        };
        if !owed.is_empty() {
            let _ = self.typed.held().send(owed);
        }
        changed(&self.id);
    }

    fn screen(&self) -> Screen {
        let (alive, exit) = *self.ended.held();
        let p = self.parser.held();
        screen_of(p.screen(), &p.callbacks().title, alive, exit)
    }

    /// The name of the program in front in this terminal now (a shell's child, when it runs
    /// one), where the system can say; else the program it was started with. The system is
    /// asked at most every [`FRONT_FOR`]. An answer given from memory may be old, and nothing
    /// would say so later (a program that sits still marks no change): so the terminal is
    /// marked once more when the memory has run out, and whoever shows it asks again.
    fn in_front(self: &Arc<Self>) -> String {
        let mut front = self.front.held();
        if front.0.is_none_or(|at| at.elapsed() > FRONT_FOR) {
            let now = self.ask_front().filter(|name| *name != self.wrapper).unwrap_or_else(|| self.program.clone());
            *front = (Some(Instant::now()), now);
        } else if !self.look_owed.swap(true, Ordering::SeqCst) {
            let later = self.clone();
            let started = std::thread::Builder::new().name("terminals: look".into()).spawn(move || {
                std::thread::sleep(FRONT_FOR + PACE);
                later.look_owed.store(false, Ordering::SeqCst);
                changed(&later.id);
            });
            if started.is_err() {
                self.look_owed.store(false, Ordering::SeqCst);
            }
        }
        front.1.clone()
    }

    #[cfg(unix)]
    fn ask_front(&self) -> Option<String> {
        let group = self.master.held().as_ref()?.process_group_leader()?;
        let out = std::process::Command::new("ps").args(["-p", &group.to_string(), "-o", "comm="]).output().ok()?;
        Some(name(&String::from_utf8_lossy(&out.stdout))).filter(|n| !n.is_empty())
    }

    /// Windows has no word for "the program in front" that this build asks for.
    #[cfg(not(unix))]
    fn ask_front(&self) -> Option<String> {
        None
    }

    fn told(self: &Arc<Self>) -> Terminal {
        let s = self.screen();
        let said: Vec<String> = s.lines.iter().map(|l| l.text().trim_end().to_string()).filter(|t| !t.trim().is_empty()).collect();
        // The shell that only carries a command is not what a person would say runs.
        let program = if s.alive && self.command.is_empty() { self.in_front() } else { self.program.clone() };
        let agent = crate::host::harness::recognise(&program).map(|(agent, _)| agent).unwrap_or_default();
        Terminal {
            id: self.id.clone(),
            command: self.command.clone(),
            program,
            place: self.place.clone(),
            cols: s.cols,
            rows: s.rows,
            alive: s.alive,
            exit: s.exit,
            last: s.last_line(),
            bottom: said[said.len().saturating_sub(terminals::BOTTOM)..].to_vec(),
            title: s.title,
            confined: self.confined.clone(),
            agent,
        }
    }

    /// End the program and everything it started in this terminal, and let the terminal go.
    fn end(&self) {
        #[cfg(unix)]
        {
            // The program in front and the one the terminal was started with, each with its
            // whole group: asked to leave first, ended a moment later if still there.
            // (A program that has ended has no group any more, and its number may be another's.)
            let front = self.master.held().as_ref().and_then(|m| m.process_group_leader()).map(|g| g.to_string());
            let own = self.pid.filter(|_| self.ended.held().0).map(|p| p.to_string());
            let groups: Vec<String> = front.into_iter().chain(own).map(|g| format!("-{g}")).collect();
            let signal = |how: &str, groups: &[String]| {
                for g in groups {
                    let _ = std::process::Command::new("kill").args([how, g]).stderr(std::process::Stdio::null()).status();
                }
            };
            signal("-HUP", &groups);
            let _ = std::thread::Builder::new().name("terminals: end".into()).spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                signal("-KILL", &groups);
            });
        }
        let _ = self.killer.held().kill();
        self.master.held().take();
    }
}

/// The host's terminals: real pseudo-terminals held by this process.
pub struct Ptys;

/// Start the three threads of a terminal. An error is the sentence to give back.
fn threads(live: &Arc<Live>, mut reader: Box<dyn Read + Send>, mut writer: Box<dyn Write + Send>, typed: mpsc::Receiver<Vec<u8>>, mut child: Box<dyn portable_pty::Child + Send + Sync>) -> Result<(), String> {
    let cannot = |e: std::io::Error| format!("the terminal's own work could not be started: {e}");
    let reads = live.clone();
    std::thread::Builder::new()
        .name(format!("terminal {}: reads", live.id))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                reads.take(&buf[..n]);
            }
        })
        .map_err(cannot)?;
    std::thread::Builder::new()
        .name(format!("terminal {}: types", live.id))
        .spawn(move || {
            for bytes in typed {
                if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
        })
        .map_err(cannot)?;
    let waits = live.clone();
    std::thread::Builder::new()
        .name(format!("terminal {}: waits", live.id))
        .spawn(move || {
            let exit = child.wait().ok().map(|status| status.exit_code() as i32);
            *waits.ended.held() = (false, exit);
            changed(&waits.id);
        })
        .map_err(cannot)?;
    Ok(())
}

impl Terminals for Ptys {
    fn open(&self, command: &str, place: &str, cols: u16, rows: u16) -> Result<String, String> {
        let (cols, rows) = terminals::size(cols, rows)?;
        let (command, place) = (command.trim(), place.trim());
        crate::core::session::check_project(place)?;
        if LIVE.held().len() >= MOST {
            return Err(format!("{MOST} terminals are held already: close one first (`terminal_close`)"));
        }
        let dir = crate::host::workspace::project(place)?;
        let dir = dir.canonicalize().unwrap_or(dir);
        let (argv, program) = argv(command, &crate::core::places::shell());
        let state = crate::host::harness::recognise(&program).map(|(_, state)| state).unwrap_or_default();
        let sandbox = crate::core::sandbox::sandbox();
        let asked = argv[0].clone();
        let argv = sandbox.confine(argv, &dir, &state)?;
        let wrapper = if argv[0] == asked { String::new() } else { name(&argv[0]) };
        let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).map_err(|e| format!("this machine gave no terminal: {e}"))?;
        let mut cmd = CommandBuilder::new(&argv[0]);
        cmd.args(&argv[1..]);
        cmd.cwd(&dir);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Where the service itself listens is not the program's business: a server started
        // in this terminal must not take the service's own port for its own.
        cmd.env_remove("PORT");
        cmd.env_remove("IP");
        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("'{}' could not be started in {}: {e}", if command.is_empty() { &program } else { command }, dir.display()))?;
        // Only the program holds its side now, so the end of the program is seen as the end
        // of what there is to read.
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|e| format!("the terminal cannot be read: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("the terminal cannot be typed into: {e}"))?;
        let (rows_n, cols_n) = (NonZeroU16::new(rows).ok_or("a screen has at least one row")?, NonZeroU16::new(cols).ok_or("a screen has at least one column")?);
        let (typed, to_type) = mpsc::channel();
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let live = Arc::new(Live {
            id: n.to_string(),
            command: command.to_string(),
            program,
            place: place.to_string(),
            confined: sandbox.how(),
            wrapper,
            parser: Mutex::new(vt100::Parser::new_with_callbacks(rows_n, cols_n, KEPT_ROWS, Heard::default())),
            killer: Mutex::new(child.clone_killer()),
            pid: child.process_id(),
            master: Mutex::new(Some(pair.master)),
            typed: Mutex::new(typed),
            ended: Mutex::new((true, None)),
            front: Mutex::new((None, String::new())),
            look_owed: AtomicBool::new(false),
        });
        if let Err(e) = threads(&live, reader, writer, to_type, child) {
            live.end();
            return Err(e);
        }
        LIVE.held().insert(n, live.clone());
        changes::mark(&terminals::key(&live.id));
        Ok(live.id.clone())
    }

    fn screen(&self, id: &str) -> Result<Screen, String> {
        Ok(find(id)?.screen())
    }

    fn scrolled(&self, id: &str, back: u16) -> Result<Scrolled, String> {
        let live = find(id)?;
        let (alive, exit) = *live.ended.held();
        let mut p = live.parser.held();
        // Look further up for the length of this one answer; the terminal itself stays where it is.
        p.screen_mut().set_scrollback(usize::from(back));
        let reached = p.screen().scrollback().min(usize::from(u16::MAX)) as u16;
        let mut screen = screen_of(p.screen(), &p.callbacks().title, alive, exit);
        p.screen_mut().set_scrollback(0);
        if reached > 0 {
            screen.cursor = None;
        }
        Ok(Scrolled { screen, back: reached })
    }

    fn type_keys(&self, id: &str, keys: &str) -> Result<(), String> {
        if keys.len() > terminals::MOST_KEYS {
            return Err(format!("{} bytes were typed at once; a terminal takes at most {} in one question: send it in pieces", keys.len(), terminals::MOST_KEYS));
        }
        let live = find(id)?;
        if !live.ended.held().0 {
            return Err(format!("the program in terminal {id} has ended: nothing reads what is typed"));
        }
        let keys = as_asked(keys, live.parser.held().screen().application_cursor());
        let sent = live.typed.held().send(keys.into_bytes());
        sent.map_err(|_| format!("terminal {id} no longer takes typing"))
    }

    fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let (cols, rows) = terminals::size(cols, rows)?;
        let live = find(id)?;
        match live.master.held().as_ref() {
            Some(master) => master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| format!("terminal {id} could not be resized: {e}"))?,
            None => return Err(no(id)),
        }
        if let (Some(rows), Some(cols)) = (NonZeroU16::new(rows), NonZeroU16::new(cols)) {
            live.parser.held().screen_mut().set_size(rows, cols);
        }
        changed(id);
        Ok(())
    }

    fn close(&self, id: &str) -> Result<(), String> {
        let live = id.parse::<u64>().ok().and_then(|n| LIVE.held().remove(&n)).ok_or_else(|| no(id))?;
        live.end();
        changes::mark(&terminals::key(id));
        Ok(())
    }

    fn all(&self) -> Vec<Terminal> {
        let all: Vec<Arc<Live>> = LIVE.held().values().cloned().collect();
        all.iter().map(|l| l.told()).collect()
    }
}

/// End every terminal: the service is stopping, and its terminals end with it.
pub fn end_all() {
    let all = std::mem::take(&mut *LIVE.held());
    all.values().for_each(|l| l.end());
    // A program that did not leave when asked is ended a moment later (`end`): this process
    // stays that long, so nothing is left behind running.
    if !all.is_empty() {
        std::thread::sleep(Duration::from_millis(700));
    }
}

/// Whether this machine gives out terminals at all (asked once at start, so the build can
/// say what it can do).
pub fn found() -> Result<(), String> {
    native_pty_system().openpty(PtySize::default()).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wait until `ready` says so about the terminal's screen; the screen it then had.
    #[cfg(unix)]
    fn until(id: &str, what: &str, ready: impl Fn(&Screen) -> bool) -> Screen {
        let started = Instant::now();
        loop {
            let s = Ptys.screen(id).unwrap();
            if ready(&s) {
                return s;
            }
            assert!(started.elapsed() < Duration::from_secs(20), "{what} was not seen within 20 s. The screen:\n{}", s.text());
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_program_runs_on_with_nobody_looking_and_its_screen_typing_and_size_are_the_services() {
        let seen = changes::now();
        let id = Ptys.open("sh -c 'echo hello-$((6*7)); cat'", "", 40, 10).unwrap();
        let s = until(&id, "what the program printed", |s| s.text().contains("hello-42"));
        assert_eq!((s.cols, s.rows, s.alive, s.exit), (40, 10, true, None));
        assert_eq!(s.lines[0].text(), "hello-42", "rows are text, without the blanks after it");
        assert_eq!(s.cursor, Some((0, 1)), "the cursor waits under it");
        // Typed keys reach the program: the terminal shows them, and `cat` says them again.
        Ptys.type_keys(&id, "one line\r").unwrap();
        let s = until(&id, "the typed line, twice", |s| s.text().matches("one line").count() == 2);
        assert_eq!(s.last_line(), "one line");
        // The change feed was told, under the terminal's own key.
        let key = terminals::key(&id);
        assert!(changes::since(seen).1.iter().any(|(k, _)| *k == key), "the screen's changes are marked as `{key}`");
        // It is one of the terminals held, with what a box says of it.
        let t = Ptys.all().into_iter().find(|t| t.id == id).expect("the terminal is listed");
        assert_eq!((t.command.as_str(), t.program.as_str(), t.alive, t.last.as_str()), ("sh -c 'echo hello-$((6*7)); cat'", "sh", true, "one line"));
        assert_eq!(t.confined, crate::core::sandbox::sandbox().how());
        // A new size is the program's new size.
        Ptys.resize(&id, 60, 5).unwrap();
        assert_eq!((Ptys.screen(&id).unwrap().cols, Ptys.screen(&id).unwrap().rows), (60, 5));
        assert!(Ptys.resize(&id, 0, 5).unwrap_err().contains("0 × 5 was asked for"));
        // Closed, it is gone, and every question about it says so.
        Ptys.close(&id).unwrap();
        for said in [Ptys.screen(&id).map(|_| ()), Ptys.scrolled(&id, 1).map(|_| ()), Ptys.type_keys(&id, "x"), Ptys.resize(&id, 80, 24), Ptys.close(&id)] {
            assert_eq!(said.unwrap_err(), no(&id));
        }
        assert!(Ptys.all().iter().all(|t| t.id != id));
    }

    #[cfg(unix)]
    #[test]
    fn how_a_program_ended_is_kept_and_nothing_more_is_typed_into_it() {
        let failed = Ptys.open("echo before; exit 3", "", 80, 24).unwrap();
        let s = until(&failed, "the end of the program", |s| !s.alive);
        assert_eq!((s.exit, s.last_line().as_str()), (Some(3), "before"), "what it showed last stays on its screen");
        assert_eq!(Ptys.type_keys(&failed, "x").unwrap_err(), format!("the program in terminal {failed} has ended: nothing reads what is typed"));
        let well = Ptys.open("true", "", 80, 24).unwrap();
        assert_eq!(until(&well, "the end of the program", |s| !s.alive).exit, Some(0));
        Ptys.close(&failed).unwrap();
        Ptys.close(&well).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn what_scrolled_off_the_top_can_be_looked_back_at() {
        let id = Ptys.open("i=1; while [ $i -le 30 ]; do echo row-$i; i=$((i+1)); done; cat", "", 40, 10).unwrap();
        let live = until(&id, "the last row printed", |s| s.text().contains("row-30"));
        assert_eq!(live.lines[0].text(), "row-22", "ten rows: the last nine printed, and the cursor's own");
        let back = Ptys.scrolled(&id, 5).unwrap();
        assert_eq!((back.back, back.screen.lines[0].text().as_str(), back.screen.cursor), (5, "row-17", None), "five rows up, and no cursor there");
        assert_eq!(back.screen.lines.len(), 10);
        let all = Ptys.scrolled(&id, 500).unwrap();
        assert_eq!((all.back, all.screen.lines[0].text().as_str()), (21, "row-1"), "asked further than there is, it stops at the first row");
        let now = Ptys.scrolled(&id, 0).unwrap();
        assert_eq!((now.back, now.screen), (0, Ptys.screen(&id).unwrap()), "nothing up is the live screen");
        assert_eq!(Ptys.screen(&id).unwrap().lines[0].text(), "row-22", "looking back moved nothing");
        Ptys.close(&id).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn closing_a_terminal_ends_what_its_program_started() {
        // The shell starts `sleep` and waits for it: closing must end both.
        let id = Ptys.open("echo $$; sleep 600; true", "", 80, 24).unwrap();
        let s = until(&id, "the shell's process number", |s| s.last_line().parse::<u32>().is_ok());
        let shell: u32 = s.last_line().parse().unwrap();
        let child = || String::from_utf8_lossy(&std::process::Command::new("pgrep").args(["-P", &shell.to_string()]).output().unwrap().stdout).trim().to_string();
        let started = Instant::now();
        while child().is_empty() {
            assert!(started.elapsed() < Duration::from_secs(10), "the shell started nothing");
            std::thread::sleep(Duration::from_millis(20));
        }
        let sleep: u32 = child().lines().next().unwrap().parse().unwrap();
        Ptys.close(&id).unwrap();
        let started = Instant::now();
        while crate::host::store::alive(sleep) || crate::host::store::alive(shell) {
            assert!(started.elapsed() < Duration::from_secs(10), "the shell ({shell}) or what it started ({sleep}) still runs after the terminal was closed");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// A shell's box names what runs in it now: the shell, then the program a person started
    /// in it, then the shell again. Nobody has to ask twice: when an answer was given from
    /// memory, the terminal is marked again once the memory has run out.
    #[cfg(unix)]
    #[test]
    fn a_shells_box_names_the_program_in_front() {
        let shell = crate::core::places::shell();
        let id = Ptys.open("", "", 80, 24).unwrap();
        let program = || Ptys.all().into_iter().find(|t| t.id == id).map(|t| t.program).unwrap_or_default();
        let wait = |want: &str, what: &str| {
            let started = Instant::now();
            while program() != want {
                assert!(started.elapsed() < Duration::from_secs(20), "{what}: the box says `{}`, not `{want}`", program());
                std::thread::sleep(Duration::from_millis(50));
            }
        };
        wait(&name(&shell), "the shell itself is in front at first");
        let seen = changes::now();
        Ptys.type_keys(&id, "sleep 30\r").unwrap();
        wait("sleep", "the program started in the shell is in front");
        assert!(changes::since(seen).1.iter().any(|(k, _)| *k == terminals::key(&id)), "and the change feed said to look again");
        Ptys.type_keys(&id, "\x03").unwrap();
        wait(&name(&shell), "interrupted, the shell is in front again");
        Ptys.close(&id).unwrap();
    }

    #[test]
    fn a_wrong_place_size_or_terminal_is_refused_in_a_sentence() {
        assert!(Ptys.open("true", "../outside", 80, 24).unwrap_err().contains("is not a plain folder name"));
        assert!(Ptys.open("true", "a/b", 80, 24).unwrap_err().contains("is not a plain folder name"));
        assert!(Ptys.open("true", "", 0, 24).unwrap_err().contains("0 × 24 was asked for"));
        assert_eq!(Ptys.screen("nope").unwrap_err(), "no terminal 'nope' is held (it was closed, or the service was restarted since)");
        let long = "x".repeat(terminals::MOST_KEYS + 1);
        assert!(Ptys.type_keys("1", &long).unwrap_err().contains("send it in pieces"));
    }

    fn parser(rows: u16, cols: u16) -> vt100::Parser<Heard> {
        vt100::Parser::new_with_callbacks(NonZeroU16::new(rows).unwrap(), NonZeroU16::new(cols).unwrap(), 0, Heard::default())
    }

    #[test]
    fn a_screen_is_rows_of_text_with_their_looks_and_nothing_for_what_is_blank() {
        let mut p = parser(4, 20);
        p.process(b"\x1b]2;my title\x07plain \x1b[1;31mred\x1b[0m\r\n\x1b[48;2;1;2;3m\x1b[38;5;200mbg\x1b[0m \x1b[2;3;4;7mlooks\x1b[0m\r\n");
        let s = screen_of(p.screen(), &p.callbacks().title, true, None);
        assert_eq!((s.cols, s.rows, s.title.as_str(), s.cursor), (20, 4, "my title", Some((0, 2))));
        assert_eq!(s.lines.len(), 2, "rows with nothing on them at the end are left out");
        assert_eq!(s.lines[0].spans, [Span::plain("plain "), Span { text: "red".into(), fg: "1".into(), bold: true, ..Default::default() }]);
        let looks = Span { text: "looks".into(), dim: true, italic: true, underline: true, inverse: true, ..Default::default() };
        assert_eq!(s.lines[1].spans, [Span { text: "bg".into(), fg: "200".into(), bg: "#010203".into(), ..Default::default() }, Span::plain(" "), looks]);
        // A blank row between two rows that say something stays: rows keep their place.
        p.process(b"\r\nlast\x1b[?25l");
        let s = screen_of(p.screen(), "", false, Some(0));
        assert_eq!((s.text().as_str(), s.cursor, s.alive, s.exit), ("plain red\nbg looks\n\nlast", None, false, Some(0)), "a hidden cursor is none");
        // A wide letter takes two cells and is said once.
        let mut p = parser(1, 10);
        p.process("日本".as_bytes());
        assert_eq!(screen_of(p.screen(), "", true, None).lines[0].text(), "日本");
    }

    #[test]
    fn a_program_that_asks_its_terminal_a_question_is_answered() {
        let mut p = parser(5, 20);
        p.process(b"ab\r\ncd\x1b[6n\x1b[5n\x1b[c");
        assert_eq!(String::from_utf8_lossy(&p.callbacks().owed), "\x1b[2;3R\x1b[0n\x1b[?1;2c", "where the cursor is (from 1), that it is well, what it is");
    }

    #[test]
    fn keys_are_turned_to_what_the_program_asked_for_and_a_command_names_its_program() {
        assert_eq!(as_asked("a\x1b[A\x1b[D", false), "a\x1b[A\x1b[D");
        assert_eq!(as_asked("a\x1b[A\x1b[D\x1b[3~", true), "a\x1bOA\x1bOD\x1b[3~", "arrows change, other keys do not");
        assert_eq!((name("/bin/zsh"), name("-zsh"), name("C:\\Windows\\cmd.exe"), name("")), ("zsh".to_string(), "zsh".to_string(), "cmd".to_string(), String::new()));
        let (line, program) = argv("LANG=C /usr/bin/vim notes.md", "/bin/zsh");
        assert_eq!(program, "vim", "a setting before the program is not the program");
        assert_eq!(line.last().map(String::as_str), Some("LANG=C /usr/bin/vim notes.md"), "the command line is handed over whole");
        let (line, program) = argv("", "/bin/zsh");
        assert_eq!((line[0].as_str(), program.as_str()), ("/bin/zsh", "zsh"), "no command is the person's own shell");
    }
}
