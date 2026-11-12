//! # App: what the full-screen terminal knows and does
//!
//! The whole client, without a terminal and without a service: it is given what happened
//! ([`Got`]: a key, a click, an answer, a change) and says what it wants asked ([`Want`]).
//! `client.rs` reads the real keys and asks the real service; a test hands the same values
//! over by hand and reads the screen out of a buffer.
//!
//! | it holds | which is |
//! | --- | --- |
//! | the boxes | every session, in the order `ui/features/boxes.rs` decides, with what this window has seen |
//! | the tabs | tabs of split panes; each pane shows one box (`panes.rs`) |
//! | what the panes show | a terminal's last screen; an engine's or a session's lines and the line being typed |
//! | where the keys go | to the pane in focus, to the sidebar (after `ctrl+b w`), or to the panes themselves for one key after `ctrl+b` |
//!
//! The keys are herdr's (`ui/features/terminals.rs`). A pane on a terminal box sends every
//! other key to its program; a pane on an engine or a session has one line to speak into.
use super::draw;
pub use super::events::{Got, Key, Mouse, Want};
use super::panes::{Dir, Pane, Tabs};
use crate::core::boxes::SessionBox;
use crate::core::screen::Screen;
use crate::ui::features::boxes::{order, Seen};
use crate::ui::features::terminals::{after_prefix, inside, pasted, terminal_box, typed, Action, Inside, PREFIX};
use ratatui::layout::Rect;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Mode {
    Pane,
    Prefix,
    Side,
}

/// What a pane on an engine or a session holds.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Talking {
    pub(super) lines: Vec<String>,
    pub(super) input: String,
    /// Rows scrolled up from the end.
    pub(super) back: usize,
}

/// How many terminals that were already running get a tab of their own when a window opens.
const TABS_BACK: usize = 8;

pub struct App {
    pub(super) host: String,
    pub(super) area: Rect,
    pub(super) boxes: Vec<SessionBox>,
    /// Every box this window was ever told of: one that is no longer listed is gone, one
    /// that was never listed is only new.
    pub(super) known: BTreeSet<String>,
    pub(super) seen: Seen,
    pub(super) side_open: bool,
    pub(super) side_at: usize,
    pub tabs: Tabs,
    pub(super) mode: Mode,
    pub(super) help: bool,
    pub(super) note: String,
    pub(super) note_bad: bool,
    pub(super) screens: BTreeMap<String, Screen>,
    /// How many rows up each terminal is looked at; one that is not in here is at its end.
    pub(super) backs: BTreeMap<String, u16>,
    pub(super) talks: BTreeMap<String, Talking>,
    /// The size this window last asked each terminal to be.
    sized: BTreeMap<String, (u16, u16)>,
    /// The size asked for a shell that has not answered yet, by its pane.
    pub(super) opening: BTreeMap<Pane, (u16, u16)>,
    /// Where a border was last held, while it is dragged.
    dragging: Option<(u16, u16)>,
}

impl App {
    /// A window of `cols` × `rows` whose first pane shows `first` (a box's id; empty = nothing).
    pub fn new(host: &str, first: &str, cols: u16, rows: u16) -> App {
        App {
            host: host.into(),
            area: Rect { x: 0, y: 0, width: cols, height: rows },
            boxes: vec![],
            known: BTreeSet::new(),
            seen: Seen::default(),
            side_open: cols >= 100,
            side_at: 0,
            tabs: Tabs::new(first),
            mode: Mode::Pane,
            help: false,
            note: String::new(),
            note_bad: false,
            screens: BTreeMap::new(),
            backs: BTreeMap::new(),
            talks: BTreeMap::new(),
            sized: BTreeMap::new(),
            opening: BTreeMap::new(),
            dragging: None,
        }
    }

    /// What to ask when the window opens.
    pub fn start(&mut self) -> Vec<Want> {
        let mut wants = vec![Want::Boxes];
        wants.extend(self.look());
        wants
    }

    pub(super) fn main(&self) -> Rect {
        draw::parts(self.area, self.side_open).main
    }

    /// The box the pane in focus shows.
    pub(super) fn shown(&self) -> &str {
        self.tabs.shown_in(self.tabs.focus())
    }

    fn say(&mut self, note: impl Into<String>, bad: bool) {
        (self.note, self.note_bad) = (note.into(), bad);
    }

    /// A terminal's screen where this window looks at it: at its end, or further up.
    fn screen(&self, id: String) -> Want {
        match self.backs.get(&id) {
            Some(back) => Want::Scrolled { back: *back, id },
            None => Want::Screen(id),
        }
    }

    /// What must be asked so that `box_id` can be drawn.
    fn content(&self, box_id: &str) -> Option<Want> {
        match inside(box_id) {
            Inside::Terminal(id) => Some(self.screen(id)),
            Inside::Engine(_) | Inside::Session(_) => Some(Want::Talk(box_id.to_string())),
            Inside::Other => None,
        }
    }

    /// Look `by` rows further up (or down) in what `box_id` shows.
    fn scroll(&mut self, box_id: &str, up: bool, by: u16) -> Vec<Want> {
        match inside(box_id) {
            Inside::Terminal(id) => {
                let now = self.backs.get(&id).copied().unwrap_or(0);
                let back = if up { now.saturating_add(by) } else { now.saturating_sub(by) };
                if back == 0 {
                    self.backs.remove(&id);
                } else {
                    self.backs.insert(id.clone(), back);
                }
                vec![self.screen(id)]
            }
            _ => {
                if let Some(t) = self.talks.get_mut(box_id) {
                    t.back = if up { t.back + usize::from(by) } else { t.back.saturating_sub(usize::from(by)) };
                }
                vec![]
            }
        }
    }

    /// Ask again for what every pane in view shows, and note that the owner is looking at
    /// the one in focus.
    fn look(&mut self) -> Vec<Want> {
        let shown = self.shown().to_string();
        self.seen.looked(&shown);
        self.tabs.shown(self.main()).iter().filter_map(|(_, _, b)| self.content(b)).collect()
    }

    /// Show `box_id` in the pane in focus.
    fn show(&mut self, box_id: &str) -> Vec<Want> {
        let pane = self.tabs.focus();
        self.tabs.show(pane, box_id);
        self.mode = Mode::Pane;
        self.look()
    }

    /// The size a terminal has in a pane of this place.
    fn room(at: Rect) -> (u16, u16) {
        let room = draw::inner(at);
        (room.width.max(2), room.height.max(1))
    }

    /// A new shell for `pane`, which was just made and is in view.
    fn open(&mut self, pane: Pane) -> Vec<Want> {
        let at = self.tabs.shown(self.main()).into_iter().find(|(p, _, _)| *p == pane).map(|(_, r, _)| r).unwrap_or(self.main());
        let (cols, rows) = Self::room(at);
        self.opening.insert(pane, (cols, rows));
        vec![Want::Open { pane, cols, rows }]
    }

    /// Every terminal in view is asked to be the size of its pane, once per size.
    fn fit(&mut self) -> Vec<Want> {
        let mut wants = vec![];
        for (_, at, box_id) in self.tabs.shown(self.main()) {
            let Inside::Terminal(id) = inside(box_id) else { continue };
            let (cols, rows) = Self::room(at);
            if self.screens.get(&id).is_some_and(|s| s.alive) && self.sized.get(&id) != Some(&(cols, rows)) {
                self.sized.insert(id.clone(), (cols, rows));
                wants.push(Want::Resize { id, cols, rows });
            }
        }
        wants
    }

    fn act(&mut self, action: Action) -> Vec<Want> {
        let main = self.main();
        match action {
            Action::NewTab => {
                let pane = self.tabs.new_tab();
                return self.open(pane);
            }
            Action::SplitRight | Action::SplitDown => match self.tabs.split(if action == Action::SplitRight { Dir::Right } else { Dir::Down }, main) {
                Ok(pane) => return self.open(pane),
                Err(e) => self.say(e, true),
            },
            Action::NextTab => self.tabs.turn(1),
            Action::PreviousTab => self.tabs.turn(-1),
            Action::Tab(n) => {
                if !self.tabs.go_to(n) {
                    self.say(format!("there is no tab {n}: {PREFIX} c makes one"), true);
                }
            }
            Action::Navigate => {
                (self.mode, self.side_open) = (Mode::Side, true);
                let shown = self.shown().to_string();
                self.side_at = self.boxes.iter().position(|b| b.id == shown).unwrap_or(self.side_at.min(self.boxes.len().saturating_sub(1)));
                return vec![];
            }
            Action::Focus(way) => self.tabs.tab_mut().go(way, main),
            Action::Zoom => self.tabs.tab_mut().zoomed ^= true,
            Action::Scroll(up) => {
                let (shown, page) = (self.shown().to_string(), (main.height / 2).max(1));
                return self.scroll(&shown, up, page);
            }
            Action::ClosePane => {
                if !self.tabs.close() {
                    self.say(format!("the last pane stays, and shows nothing now: {PREFIX} q leaves"), false);
                }
            }
            Action::EndTerminal => match inside(self.shown()) {
                Inside::Terminal(id) => {
                    let pane = self.tabs.focus();
                    self.tabs.show(pane, "");
                    return vec![Want::Close(id)];
                }
                _ => self.say("the pane in focus shows no terminal to end", true),
            },
            Action::FoldSidebar => self.side_open ^= true,
            Action::Help => self.help = true,
            Action::Detach => return vec![Want::Leave],
            Action::SendPrefix => {
                if let Inside::Terminal(id) = inside(self.shown()) {
                    return vec![Want::Type { id, keys: "\x02".into() }];
                }
            }
        }
        self.look()
    }

    /// A key for the pane in focus: typed into its terminal, or into its line.
    fn pane_key(&mut self, k: Key) -> Vec<Want> {
        let box_id = self.shown().to_string();
        match inside(&box_id) {
            Inside::Terminal(id) => {
                if self.screens.get(&id).is_some_and(|s| !s.alive) {
                    self.say(format!("its program has ended: {PREFIX} X forgets it, {PREFIX} w chooses another box"), false);
                    return vec![];
                }
                // Typing is at the end: a pane that was looked back in returns there.
                let Some(keys) = typed(&k.name, k.ctrl, k.alt, k.shift) else { return vec![] };
                let back = self.backs.remove(&id).map(|_| Want::Screen(id.clone()));
                [Want::Type { id, keys }].into_iter().chain(back).collect()
            }
            Inside::Engine(_) | Inside::Session(_) => {
                let page = (self.main().height / 2).max(1);
                if k.name == "PageUp" || k.name == "PageDown" {
                    return self.scroll(&box_id, k.name == "PageUp", page);
                }
                let t = self.talks.entry(box_id.clone()).or_default();
                match k.name.as_str() {
                    "Enter" if !t.input.trim().is_empty() => {
                        let text = std::mem::take(&mut t.input);
                        t.back = 0;
                        self.say("asked; the answer comes into the pane", false);
                        return vec![Want::Say { box_id, text }];
                    }
                    "Backspace" => {
                        t.input.pop();
                    }
                    "u" if k.ctrl => t.input.clear(),
                    name if !k.ctrl && !k.alt && name.chars().count() == 1 => t.input.push_str(name),
                    _ => {}
                }
                vec![]
            }
            Inside::Other => {
                self.say(format!("this pane shows nothing: {PREFIX} w chooses a box, {PREFIX} c opens a shell"), false);
                vec![]
            }
        }
    }

    fn side_key(&mut self, k: Key) -> Vec<Want> {
        match k.name.as_str() {
            "ArrowUp" | "k" => self.side_at = self.side_at.saturating_sub(1),
            "ArrowDown" | "j" => self.side_at = (self.side_at + 1).min(self.boxes.len().saturating_sub(1)),
            "Enter" => {
                if let Some(id) = self.boxes.get(self.side_at).map(|b| b.id.clone()) {
                    return self.show(&id);
                }
            }
            "Escape" | "q" => self.mode = Mode::Pane,
            _ => {}
        }
        vec![]
    }

    fn key(&mut self, k: Key) -> Vec<Want> {
        if self.help {
            self.help = false;
            return vec![];
        }
        self.note.clear();
        match self.mode {
            Mode::Prefix => {
                self.mode = Mode::Pane;
                match after_prefix(&k.name, k.ctrl) {
                    Some(action) => self.act(action),
                    None if k.name == "Escape" => vec![],
                    None => {
                        self.say(format!("{PREFIX} {} does nothing: {PREFIX} ? lists the keys", k.name), true);
                        vec![]
                    }
                }
            }
            Mode::Side if k.ctrl && k.name == "b" => {
                self.mode = Mode::Prefix;
                vec![]
            }
            Mode::Side => self.side_key(k),
            Mode::Pane if k.ctrl && k.name == "b" => {
                self.mode = Mode::Prefix;
                vec![]
            }
            Mode::Pane => self.pane_key(k),
        }
    }

    fn mouse(&mut self, m: Mouse) -> Vec<Want> {
        let at = draw::parts(self.area, self.side_open);
        let within = |r: Rect, x: u16, y: u16| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        match m {
            Mouse::Down(..) if self.help => self.help = false,
            Mouse::Down(x, y) if within(at.side, x, y) => {
                // The head of the sidebar folds it and opens it; a row shows its box.
                if y == at.side.y {
                    self.side_open ^= true;
                } else if let Some(id) = draw::side_row(at.side, self.side_open, self.boxes.len(), self.side_at, y).and_then(|i| self.boxes.get(i)).map(|b| b.id.clone()) {
                    return self.show(&id);
                }
            }
            Mouse::Down(x, y) if within(at.tabs, x, y) => {
                if let Some(i) = draw::tab_at(at.tabs, &self.tab_names(), x) {
                    self.tabs.go_to(i + 1);
                    return self.look();
                }
            }
            Mouse::Down(x, y) if within(at.main, x, y) => {
                self.dragging = Some((x, y));
                if let Some(pane) = self.tabs.tab().at(at.main, x, y) {
                    self.tabs.tab_mut().focus = pane;
                    self.mode = Mode::Pane;
                    return self.look();
                }
            }
            Mouse::Drag(x, y) => {
                if let Some(from) = self.dragging {
                    if self.tabs.tab_mut().drag(at.main, from, (x, y)) {
                        self.dragging = Some((x, y));
                    }
                }
            }
            Mouse::Up => self.dragging = None,
            Mouse::Wheel(up, x, y) => {
                let over = self.tabs.tab().at(at.main, x, y).map(|p| self.tabs.shown_in(p).to_string()).unwrap_or_default();
                return self.scroll(&over, up, 3);
            }
            _ => {}
        }
        vec![]
    }

    /// What the change feed's keys mean for what is in view.
    fn changed(&mut self, keys: &[String]) -> Vec<Want> {
        if keys.is_empty() {
            return vec![];
        }
        let mut wants = vec![Want::Boxes];
        let other = keys.iter().any(|k| !k.starts_with("terminals/"));
        for (_, _, box_id) in self.tabs.shown(self.main()) {
            match inside(box_id) {
                Inside::Terminal(id) if keys.iter().any(|k| *k == crate::core::terminals::key(&id)) => wants.push(self.screen(id)),
                Inside::Engine(_) | Inside::Session(_) if other => wants.push(Want::Talk(box_id.to_string())),
                _ => {}
            }
        }
        wants
    }

    /// Take in what happened; what is to be asked because of it comes back.
    pub fn on(&mut self, got: Got) -> Vec<Want> {
        let mut wants = match got {
            Got::Key(k) => self.key(k),
            Got::Mouse(m) => self.mouse(m),
            Got::Paste(text) => match inside(self.shown()) {
                Inside::Terminal(id) => vec![Want::Type { id, keys: pasted(&text) }],
                _ => {
                    let box_id = self.shown().to_string();
                    if let Some(t) = self.talks.get_mut(&box_id) {
                        t.input.push_str(&text.replace(['\r', '\n'], " "));
                    }
                    vec![]
                }
            },
            Got::Size(cols, rows) => {
                self.area = Rect { x: 0, y: 0, width: cols, height: rows };
                vec![]
            }
            Got::Boxes(list) => {
                // A window that opens on a service finds what already runs there: each
                // terminal gets a tab of its own again, as it had before the last one left.
                if self.known.is_empty() {
                    let shown = self.shown().to_string();
                    for b in list.iter().filter(|b| matches!(inside(&b.id), Inside::Terminal(_)) && b.id != shown).take(TABS_BACK) {
                        let pane = self.tabs.new_tab();
                        self.tabs.show(pane, &b.id);
                    }
                    self.tabs.go_to(1);
                }
                self.seen.take(&list);
                let shown = self.shown().to_string();
                self.seen.looked(&shown);
                self.known.extend(list.iter().map(|b| b.id.clone()));
                self.boxes = order(&list, &self.seen);
                self.side_at = self.side_at.min(self.boxes.len().saturating_sub(1));
                vec![]
            }
            Got::Screen(id, screen) => {
                // A screen of the end that arrives while the pane is looked back in is late.
                if !self.backs.contains_key(&id) {
                    self.screens.insert(id, screen);
                }
                vec![]
            }
            Got::Scrolled(id, screen, back) => {
                // No further up than there is: at 0 the pane is at its end again.
                if back == 0 {
                    self.backs.remove(&id);
                } else if self.backs.contains_key(&id) {
                    self.backs.insert(id.clone(), back);
                }
                self.screens.insert(id, screen);
                vec![]
            }
            Got::Talk(box_id, lines) => {
                self.talks.entry(box_id).or_default().lines = lines;
                vec![]
            }
            Got::Opened(pane, id) => {
                if let Some(size) = self.opening.remove(&pane) {
                    self.sized.insert(id.clone(), size);
                }
                if self.tabs.has(pane) {
                    self.tabs.show(pane, &terminal_box(&id));
                } else {
                    self.say("the pane was closed before its shell started; the shell is in the sidebar", false);
                }
                vec![Want::Screen(id), Want::Boxes]
            }
            Got::Said(note) => {
                self.say(note, false);
                vec![]
            }
            Got::Failed(why) => {
                self.say(why, true);
                vec![]
            }
            Got::Changed(keys) => self.changed(&keys),
            Got::Away(why) => {
                self.say(format!("the service does not answer; what is shown is kept ({why})"), true);
                vec![]
            }
            Got::Back(restarted) => {
                self.say(if restarted { "the service was restarted: its terminals ended with it" } else { "the service answers again" }, false);
                let mut wants = vec![Want::Boxes];
                wants.extend(self.look());
                wants
            }
        };
        wants.extend(self.fit());
        wants.dedup();
        wants
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::boxes::{Depth, State};
    use crate::core::screen::{Line, Span};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    const ENGINE: &str = "engine:askk/developer";

    fn a(id: &str, title: &str, kind: &str, state: State) -> SessionBox {
        SessionBox { id: id.into(), title: title.into(), kind: kind.into(), state, depth: Depth::Spec, ..Default::default() }
    }

    fn boxes() -> Vec<SessionBox> {
        let mut asks = a("session:4", "reviewer", "claude", State::Blocked);
        asks.last = "which folder?".into();
        vec![a(ENGINE, "developer", "engine", State::Idle), a("terminal:7", "sh", "sh", State::Working), asks]
    }

    fn screen(rows: &[&str], cols: u16, height: u16) -> Screen {
        Screen { cols, rows: height, lines: rows.iter().map(|r| Line { spans: vec![Span::plain(*r)] }).collect(), cursor: Some((rows.last().map_or(0, |r| r.len()) as u16, rows.len().saturating_sub(1) as u16)), alive: true, ..Default::default() }
    }

    /// The app as a real terminal would show it: the rows of the screen, and the cursor.
    fn drawn(app: &App) -> (Vec<String>, Option<(u16, u16)>) {
        let mut terminal = Terminal::new(TestBackend::new(app.area.width, app.area.height)).unwrap();
        let mut cursor = None;
        terminal
            .draw(|frame| {
                let area = frame.area();
                cursor = draw::draw(frame.buffer_mut(), area, &app.picture());
            })
            .unwrap();
        let buf = terminal.backend().buffer();
        (draw::tests::rows(buf), cursor)
    }

    fn keys(app: &mut App, names: &[&str]) -> Vec<Want> {
        names.iter().flat_map(|n| app.on(Got::Key(if let Some(held) = n.strip_prefix("ctrl+") { Key::ctrl(held) } else { Key::plain(n) }))).collect()
    }

    /// A window of 120 × 30 on a service with three boxes, the engine in its one pane.
    fn open() -> App {
        let mut app = App::new("127.0.0.1:8090", ENGINE, 120, 30);
        assert_eq!(app.start(), [Want::Boxes, Want::Talk(ENGINE.into())], "it asks for the boxes and for what its pane shows");
        // The terminal is started a moment after the window opened (one that ran before it
        // opened would get a tab of its own: see the test for that).
        app.on(Got::Boxes(boxes().into_iter().filter(|b| b.id != "terminal:7").collect()));
        app.on(Got::Boxes(boxes()));
        app.on(Got::Talk(ENGINE.into(), vec!["user: What is 17 * 23?".into(), "model: 17 * 23 is 391.".into()]));
        app
    }

    /// Open a shell in the pane a key just made: the service answers with terminal `id`.
    fn shell(app: &mut App, wants: &[Want], id: &str, rows: &[&str]) -> (Pane, u16, u16) {
        let Some(Want::Open { pane, cols, rows: height }) = wants.first() else { panic!("a shell is asked for: {wants:?}") };
        assert_eq!(app.on(Got::Opened(*pane, id.into())), [Want::Screen(id.into()), Want::Boxes]);
        assert_eq!(app.on(Got::Screen(id.into(), screen(rows, *cols, *height))), [], "it has the size it was opened with: nothing to resize");
        (*pane, *cols, *height)
    }

    #[test]
    fn the_first_screen_is_a_sidebar_of_every_box_what_waits_first_and_a_pane_on_the_engine() {
        let app = open();
        let (rows, cursor) = drawn(&app);
        assert!(rows[0].starts_with(" askk · 127.0.0.1:8090"), "{}", rows[0]);
        assert!(rows[1].starts_with(" boxes"), "{}", rows[1]);
        assert!(rows[2].starts_with(" ? reviewer · claude"), "what waits for the owner comes first: {}", rows[2]);
        assert!(rows[3].starts_with("   which folder?"), "its last line is under it: {}", rows[3]);
        assert!(rows[4].starts_with(" ● sh · sh") && rows[5].starts_with("   working"), "{} / {}", rows[4], rows[5]);
        assert!(rows[6].starts_with("▎○ developer · engine"), "the box the pane shows carries a bar: {}", rows[6]);
        assert!(rows[0].contains("│ 1 developer"), "one tab, named after its box: {}", rows[0]);
        assert!(rows[1].contains("┌ ○ developer · engine ─"), "the pane's frame names its box: {}", rows[1]);
        assert!(rows[2].contains("│user: What is 17 * 23?") && rows[3].contains("│model: 17 * 23 is 391."), "{} / {}", rows[2], rows[3]);
        assert!(rows[27].contains("│> "), "a line to speak into: {}", rows[27]);
        assert_eq!(cursor, Some((35, 27)), "the cursor waits on that line");
        assert_eq!(rows[29], " ctrl+b  then  c tab  v split right  - split down  w boxes  z zoom  ? help  q detach");
    }

    #[test]
    fn ctrl_b_c_opens_a_shell_in_a_new_tab_and_every_key_but_the_prefix_goes_to_its_program() {
        let mut app = open();
        assert_eq!(keys(&mut app, &["ctrl+b"]), [], "the prefix alone asks nothing");
        assert!(drawn(&app).0[29].starts_with(" ctrl+b …"), "the foot says the next key works the panes");
        let wants = keys(&mut app, &["c"]);
        assert_eq!(wants, [Want::Open { pane: 2, cols: 86, rows: 26 }], "a shell the size of the new pane's inside");
        assert!(drawn(&app).0.iter().any(|r| r.contains("starting a shell…")));
        shell(&mut app, &wants, "9", &["$ echo hi", "hi", "$ "]);
        let (rows, cursor) = drawn(&app);
        assert!(rows[0].contains("1 developer  2 terminal:9"), "a second tab, shown: {}", rows[0]);
        assert!(rows[2].contains("│$ echo hi") && rows[3].contains("│hi"), "the terminal's screen is in the pane: {rows:?}");
        assert_eq!(cursor, Some((35, 4)), "the cursor is the program's");
        // Typing: letters, Enter, an arrow, ctrl+c, and ctrl+b twice for ctrl+b itself.
        let typed = keys(&mut app, &["l", "s", "Enter", "ArrowUp", "ctrl+c", "ctrl+b", "ctrl+b"]);
        let sent: Vec<&str> = typed.iter().map(|w| if let Want::Type { id, keys } = w { assert_eq!(id, "9"); keys.as_str() } else { panic!("{w:?}") }).collect();
        assert_eq!(sent, ["l", "s", "\r", "\x1b[A", "\x03", "\x02"]);
        // A key that works nothing says so and types nothing.
        assert_eq!(keys(&mut app, &["ctrl+b", "y"]), []);
        assert!(drawn(&app).0[29].contains("ctrl+b y does nothing"), "{}", drawn(&app).0[29]);
        // n and p go round the tabs; a number goes to one.
        keys(&mut app, &["ctrl+b", "n"]);
        assert_eq!(app.tabs.at, 0);
        keys(&mut app, &["ctrl+b", "p"]);
        assert_eq!(app.tabs.at, 1);
        assert_eq!(keys(&mut app, &["ctrl+b", "1"]), [Want::Talk(ENGINE.into())], "a tab that comes into view is asked for again");
        assert_eq!(keys(&mut app, &["ctrl+b", "q"]), [Want::Leave], "q detaches");
    }

    #[test]
    fn panes_split_right_and_down_take_the_focus_by_keys_zoom_and_close() {
        let mut app = open();
        let wants = keys(&mut app, &["ctrl+b", "v"]);
        assert_eq!(wants, [Want::Open { pane: 2, cols: 42, rows: 26 }], "the right half");
        shell(&mut app, &wants, "1", &["right"]);
        let wants = keys(&mut app, &["ctrl+b", "-"]);
        assert_eq!(wants, [Want::Open { pane: 3, cols: 42, rows: 12 }, Want::Resize { id: "1".into(), cols: 42, rows: 12 }], "the lower half of the right half, and the terminal above is told it is smaller now");
        shell(&mut app, &wants, "2", &["below"]);
        let (rows, _) = drawn(&app);
        assert!(rows[1].contains("┌ ○ developer · engine") && rows[1].contains("┐┌ terminal:1"), "two panes side by side: {}", rows[1]);
        assert!(rows[2].contains("│right") && rows[16].contains("│below"), "{} / {}", rows[2], rows[16]);
        assert_eq!(app.tabs.focus(), 3);
        keys(&mut app, &["ctrl+b", "ArrowUp"]);
        assert_eq!(app.tabs.focus(), 2);
        keys(&mut app, &["ctrl+b", "h"]);
        assert_eq!(app.tabs.focus(), 1, "h j k l move as the arrows do");
        keys(&mut app, &["ctrl+b", "z"]);
        let (rows, _) = drawn(&app);
        assert!(rows[1].contains("developer · engine · zoomed") && !rows[1].contains("terminal:1"), "zoomed, one pane fills the tab: {}", rows[1]);
        keys(&mut app, &["ctrl+b", "z", "ctrl+b", "x"]);
        assert_eq!(app.tabs.tab().panes(), [2, 3], "x closes the pane in focus; the others take its room");
        // X ends the terminal in the pane: the service is asked, and the pane shows nothing.
        keys(&mut app, &["ctrl+b", "l"]);
        let shown = app.shown().to_string();
        let Inside::Terminal(id) = inside(&shown) else { panic!("{shown}") };
        assert_eq!(keys(&mut app, &["ctrl+b", "X"]), [Want::Close(id)]);
        assert_eq!(app.shown(), "");
        // A window too small for one more split says so instead of drawing rubbish.
        app.on(Got::Size(44, 10));
        assert!(!keys(&mut app, &["ctrl+b", "v"]).iter().any(|w| matches!(w, Want::Open { .. })), "no shell is asked for");
        assert!(drawn(&app).0[9].contains("too small to split"), "{}", drawn(&app).0[9]);
    }

    #[test]
    fn the_sidebar_says_what_a_pane_shows_by_keys_and_by_a_click_and_folds() {
        let mut app = open();
        assert_eq!(keys(&mut app, &["ctrl+b", "w"]), []);
        let (rows, cursor) = drawn(&app);
        assert!(rows[29].starts_with(" ↑ ↓ choose a box  enter show it in the pane  esc back to the pane"), "{}", rows[29]);
        assert_eq!(cursor, None, "the keys are the sidebar's: no cursor in a pane");
        // It starts on the box the pane shows (the engine, third), and goes up to the terminal.
        assert_eq!(keys(&mut app, &["ArrowUp", "Enter"]), [Want::Screen("7".into())]);
        assert_eq!(app.shown(), "terminal:7");
        assert_eq!(keys(&mut app, &["x"]), [Want::Type { id: "7".into(), keys: "x".into() }], "and the keys are the pane's again");
        // A click on a row shows that box; a click on the head folds the sidebar.
        assert_eq!(app.on(Got::Mouse(Mouse::Down(5, 2))), [Want::Talk("session:4".into())], "the first row is the box that waits");
        assert_eq!(app.shown(), "session:4");
        app.on(Got::Mouse(Mouse::Down(5, 0)));
        let (rows, _) = drawn(&app);
        assert!(rows[0].starts_with(" ›") && rows[2].starts_with("▎?") && rows[3].starts_with(" ●") && rows[4].starts_with(" ○"), "folded, it is marks only: {:?}", &rows[..5]);
        assert!(rows[1].contains("┌ ? reviewer · claude"), "{}", rows[1]);
        assert_eq!(app.on(Got::Mouse(Mouse::Down(1, 3))), [Want::Screen("7".into())], "a mark is clicked like a row");
        keys(&mut app, &["ctrl+b", "b"]);
        assert!(drawn(&app).0[1].starts_with(" boxes"), "b opens it again");
    }

    #[test]
    fn a_click_takes_the_focus_to_a_pane_or_a_tab_and_a_border_is_dragged() {
        let mut app = open();
        let wants = keys(&mut app, &["ctrl+b", "v"]);
        shell(&mut app, &wants, "1", &["right"]);
        assert_eq!(app.tabs.focus(), 2);
        app.on(Got::Mouse(Mouse::Down(40, 10)));
        assert_eq!(app.tabs.focus(), 1, "a click in a pane focuses it");
        // The border between the two panes is at columns 75 and 76: drag it left.
        app.on(Got::Mouse(Mouse::Up));
        app.on(Got::Mouse(Mouse::Down(76, 10)));
        let resized = app.on(Got::Mouse(Mouse::Drag(62, 10)));
        assert_eq!(resized, [Want::Resize { id: "1".into(), cols: 56, rows: 26 }], "the terminal is told its pane grew");
        app.on(Got::Mouse(Mouse::Up));
        assert_eq!(app.on(Got::Mouse(Mouse::Drag(50, 10))), [], "nothing is held any more");
        let wants = keys(&mut app, &["ctrl+b", "c"]);
        shell(&mut app, &wants, "2", &["second tab"]);
        assert_eq!(app.tabs.at, 1);
        app.on(Got::Mouse(Mouse::Down(36, 0)));
        assert_eq!(app.tabs.at, 0, "a click on a tab's name shows that tab");
    }

    #[test]
    fn a_terminal_is_asked_to_be_the_size_of_its_pane_once_per_size() {
        let mut app = App::new("h", "terminal:7", 120, 30);
        app.on(Got::Boxes(boxes()));
        // Its screen arrives at another size (another window made it so): this window asks once.
        assert_eq!(app.on(Got::Screen("7".into(), screen(&["$ "], 80, 24))), [Want::Resize { id: "7".into(), cols: 86, rows: 26 }]);
        assert_eq!(app.on(Got::Screen("7".into(), screen(&["$ "], 80, 24))), [], "not again, whatever comes back: two windows do not fight");
        assert_eq!(app.on(Got::Size(100, 20)), [Want::Resize { id: "7".into(), cols: 66, rows: 16 }], "a new window size is a new pane size");
        let mut ended = screen(&["bye"], 66, 16);
        (ended.alive, ended.exit) = (false, Some(0));
        app.on(Got::Screen("7".into(), ended));
        assert_eq!(app.on(Got::Size(120, 30)), [], "an ended program is not resized");
        let (rows, cursor) = drawn(&app);
        assert!(rows.iter().any(|r| r.contains("its program ended well (0) · ctrl+b X forgets it")), "{rows:?}");
        assert_eq!(cursor, None);
        assert_eq!(keys(&mut app, &["x"]), [], "and nothing is typed into it");
    }

    #[test]
    fn a_window_that_opens_on_a_service_finds_its_terminals_in_tabs_again() {
        let mut app = App::new("h", ENGINE, 120, 30);
        app.start();
        let mut list = boxes();
        list.push(a("terminal:9", "vim", "vim", State::Working));
        assert_eq!(app.on(Got::Boxes(list.clone())), [], "the tab in view is still the first");
        let (rows, _) = drawn(&app);
        assert!(rows[0].contains("│ 1 developer  2 sh  3 vim"), "each terminal that already ran has a tab: {}", rows[0]);
        assert_eq!(keys(&mut app, &["ctrl+b", "n"]), [Want::Screen("7".into())], "and going there asks for its screen");
        // Only when the window opens: a terminal that appears later is a row of the sidebar.
        list.push(a("terminal:10", "top", "top", State::Working));
        app.on(Got::Boxes(list));
        assert_eq!(app.tabs.tabs.len(), 3);
    }

    #[test]
    fn a_terminals_pane_is_looked_back_in_by_the_wheel_and_typing_returns_to_its_end() {
        let mut app = App::new("h", "terminal:7", 120, 30);
        app.on(Got::Boxes(boxes()));
        app.on(Got::Screen("7".into(), screen(&["row 40", "$ "], 86, 26)));
        assert_eq!(app.on(Got::Mouse(Mouse::Wheel(true, 60, 10))), [Want::Scrolled { id: "7".into(), back: 3 }]);
        assert_eq!(app.on(Got::Mouse(Mouse::Wheel(true, 60, 10))), [Want::Scrolled { id: "7".into(), back: 6 }]);
        // There were only four rows above: the service says so, and the pane is four up.
        app.on(Got::Scrolled("7".into(), screen(&["row 36"], 86, 26), 4));
        let (rows, cursor) = drawn(&app);
        assert!(rows[2].contains("│row 36") && rows[27].contains("↑ 4 rows up"), "{rows:?}");
        assert_eq!(cursor, None);
        // What the program writes meanwhile is asked for where the pane looks, and a screen
        // of the end that arrives late does not pull it down.
        assert_eq!(app.on(Got::Changed(vec!["terminals/7".into()])), [Want::Boxes, Want::Scrolled { id: "7".into(), back: 4 }]);
        app.on(Got::Screen("7".into(), screen(&["row 41", "$ "], 86, 26)));
        assert!(drawn(&app).0[2].contains("│row 36"));
        assert_eq!(app.on(Got::Mouse(Mouse::Wheel(false, 60, 10))), [Want::Scrolled { id: "7".into(), back: 1 }]);
        assert_eq!(app.on(Got::Mouse(Mouse::Wheel(false, 60, 10))), [Want::Screen("7".into())], "wheeled down to the end, it is live again");
        // ctrl+b PageUp looks back half a pane; a key typed goes to the program and returns.
        assert_eq!(keys(&mut app, &["ctrl+b", "PageUp"]), [Want::Scrolled { id: "7".into(), back: 14 }]);
        assert_eq!(keys(&mut app, &["l"]), [Want::Type { id: "7".into(), keys: "l".into() }, Want::Screen("7".into())]);
        assert_eq!(app.on(Got::Changed(vec!["terminals/7".into()])), [Want::Boxes, Want::Screen("7".into())]);
        // An engine's pane scrolls its own lines, and asks nothing for it.
        let mut talk = open();
        talk.on(Got::Talk(ENGINE.into(), (1..=60).map(|n| format!("line {n}")).collect()));
        assert!(drawn(&talk).0[25].contains("│line 60"));
        assert_eq!(keys(&mut talk, &["PageUp"]), []);
        assert!(drawn(&talk).0[25].contains("│line 46") && drawn(&talk).0[26].contains("14 rows below"), "{:?}", &drawn(&talk).0[24..28]);
        assert_eq!(talk.on(Got::Mouse(Mouse::Wheel(false, 60, 10))), []);
        assert!(drawn(&talk).0[25].contains("│line 49"));
    }

    #[test]
    fn what_the_change_feed_names_is_asked_for_again_and_nothing_else() {
        let mut app = open();
        assert_eq!(app.on(Got::Changed(vec!["terminals/7".into()])), [Want::Boxes], "a terminal that is not in view: only the list");
        assert_eq!(app.on(Got::Changed(vec!["engines/askk/developer".into()])), [Want::Boxes, Want::Talk(ENGINE.into())]);
        assert_eq!(app.on(Got::Changed(vec![])), []);
        keys(&mut app, &["ctrl+b", "w", "ArrowUp", "Enter"]);
        assert_eq!(app.on(Got::Changed(vec!["terminals/7".into(), "terminals/8".into()])), [Want::Boxes, Want::Screen("7".into())]);
        assert_eq!(app.on(Got::Back(true)), [Want::Boxes, Want::Screen("7".into())], "a restarted service is asked for everything again");
        assert!(drawn(&app).0[29].contains("the service was restarted"));
        app.on(Got::Away("nothing answered".into()));
        assert!(drawn(&app).0[29].contains("the service does not answer; what is shown is kept"));
        // A box that is gone from the list says so in its pane.
        app.on(Got::Boxes(vec![a(ENGINE, "developer", "engine", State::Idle)]));
        assert!(drawn(&app).0.iter().any(|r| r.contains("This box is gone")), "{:?}", drawn(&app).0);
    }

    #[test]
    fn a_line_typed_into_an_engines_pane_is_said_to_it_and_a_done_box_is_seen_when_shown() {
        let mut app = open();
        assert_eq!(keys(&mut app, &["h", "i", "!", "Backspace"]), []);
        assert!(drawn(&app).0[27].contains("│> hi"), "{}", drawn(&app).0[27]);
        assert_eq!(keys(&mut app, &["Enter"]), [Want::Say { box_id: ENGINE.into(), text: "hi".into() }]);
        assert!(!drawn(&app).0[27].contains("hi"), "the line is empty again: {}", drawn(&app).0[27]);
        assert_eq!(keys(&mut app, &["Enter"]), [], "an empty line says nothing");
        app.on(Got::Paste("two\nlines".into()));
        assert!(drawn(&app).0[27].contains("│> two lines"), "pasted text is one line here");
        // The terminal works, then ends well while this window shows another box: it is done
        // until it is looked at.
        let mut list = boxes();
        app.on(Got::Boxes(list.clone()));
        list[1].state = State::Idle;
        app.on(Got::Boxes(list.clone()));
        assert!(drawn(&app).0[2].starts_with(" ? reviewer") && drawn(&app).0[4].starts_with(" ✓ sh"), "done comes after what waits: {:?}", &drawn(&app).0[2..6]);
        app.on(Got::Mouse(Mouse::Down(5, 4)));
        app.on(Got::Boxes(list));
        assert!(drawn(&app).0.iter().any(|r| r.starts_with("▎○ sh")), "shown in the pane, it has been seen: {:?}", &drawn(&app).0[2..8]);
    }

    #[test]
    fn help_lists_the_keys_and_any_key_closes_it() {
        let mut app = open();
        keys(&mut app, &["ctrl+b", "?"]);
        let (rows, cursor) = drawn(&app);
        assert!(rows.iter().any(|r| r.contains("keys, each after ctrl+b")), "{rows:?}");
        for (key, does) in crate::ui::features::terminals::HELP {
            assert!(rows.iter().any(|r| r.contains(key) && r.contains(does)), "the help says `{key}`: {does}");
        }
        assert_eq!(cursor, None);
        assert_eq!(keys(&mut app, &["a"]), [], "the key that closes the help is not typed");
        assert!(!drawn(&app).0.iter().any(|r| r.contains("keys, each after ctrl+b")));
    }
}
