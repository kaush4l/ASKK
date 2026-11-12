//! The terminal shell: `askk terminal`.
//!
//! ```text
//! askk terminal                         the full screen on the service running for this home
//!                                       (`askk start`); with none running, this process is the host
//! askk terminal --lines                 lines instead of the full screen (it is lines by itself
//!                                       when they go to a pipe or a file)
//! askk terminal --to http://127.0.0.1:8090   talk to the askk server at that address
//! askk terminal --engine askk/coder     choose the engine
//! askk terminal What is 17 * 23?        ask once, print what the loop did and the answer, leave
//! ```
//!
//! Thin, like every shell: it reads the command line and hands over to `ui/terminal`.
use crate::ui::terminal::{full_screen, talk_until_done, Door, Session};
use std::io::IsTerminal;

/// What the command line asked for.
pub struct Wanted {
    /// A server to talk to; none = this process is the host.
    pub to: Option<String>,
    pub engine: Option<String>,
    /// A question to ask once; empty = stay and talk.
    pub question: String,
    /// Lines were asked for, even on a terminal that could show the full screen.
    pub lines: bool,
}

/// How the terminal is shown.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shown {
    /// One question, its answer, and out.
    Once,
    /// What is typed is answered under it, line by line.
    Lines,
    /// Sidebar, tabs and panes.
    FullScreen,
}

/// Decide how to show it. The full screen needs a person at a real terminal on both ends:
/// keys come from it and cells go to it. Sent to a pipe or a file, read from one, on a
/// terminal that says it cannot (`dumb`), or when lines were asked for, it is lines: a
/// script gets exactly what it always got.
pub fn shown(w: &Wanted, keys_from_a_terminal: bool, cells_to_a_terminal: bool, dumb: bool) -> Shown {
    match () {
        _ if !w.question.is_empty() => Shown::Once,
        _ if w.lines || dumb || !keys_from_a_terminal || !cells_to_a_terminal => Shown::Lines,
        _ => Shown::FullScreen,
    }
}

/// Is this a terminal start (`askk terminal …`)? Then what it wants.
pub fn wanted(args: &[String]) -> Option<Wanted> {
    if args.get(1).map(String::as_str) != Some("terminal") {
        return None;
    }
    let mut w = Wanted { to: None, engine: None, question: String::new(), lines: false };
    let mut words = vec![];
    let mut rest = args[2..].iter();
    while let Some(a) = rest.next() {
        match a.as_str() {
            "--to" => w.to = rest.next().cloned(),
            "--engine" => w.engine = rest.next().cloned(),
            "--lines" => w.lines = true,
            // `--desk <folder>` is read by the host (core/places.rs); it is not a word of the question.
            "--desk" => {
                rest.next();
            }
            _ => words.push(a.clone()),
        }
    }
    w.question = words.join(" ");
    Some(w)
}

/// Decide where this terminal asks. A server named with `--to` is the one asked. With none
/// named, a service already `running` for this home is asked (its address): the terminal
/// talks to it instead of trying to be a second host of the same home, which would boot no
/// engines. With neither, this process is the host.
pub fn attach(mut w: Wanted, running: Option<String>) -> Wanted {
    if w.to.is_none() {
        if let Some(address) = running {
            eprintln!("askk: a service is running for this home at {address}; this terminal talks to it");
            w.to = Some(address);
        }
    }
    w
}

/// Run the terminal; the number is the process's exit code (0 = it went well).
pub fn launch(w: Wanted) -> i32 {
    let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("askk: the terminal could not start: {e}");
            return 1;
        }
    };
    let how = shown(&w, std::io::stdin().is_terminal(), std::io::stdout().is_terminal(), crate::core::places::dumb_terminal());
    let door = match &w.to {
        Some(base) => Door::There(base.clone()),
        None => Door::Here,
    };
    if how == Shown::FullScreen {
        return match full_screen(&rt, door, w.engine) {
            Ok(()) => {
                match &w.to {
                    Some(at) => println!("askk: detached. Everything keeps running in the service at {at}: `askk terminal` comes back to it, `askk stop` ends it."),
                    None => println!("askk: this terminal was its own host, so what ran in it ended with it. `askk start` runs askk in the background, and a terminal then only looks."),
                }
                0
            }
            Err(e) => {
                eprintln!("askk: {e}");
                1
            }
        };
    }
    let session = match rt.block_on(Session::open(door, w.engine)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("askk: {e}");
            return 1;
        }
    };
    if how == Shown::Lines {
        talk_until_done(&rt, session, std::io::stdin().lock(), std::io::stdout());
        return 0;
    }
    match rt.block_on(session.question(&w.question)) {
        Ok(said) => {
            println!("{said}");
            0
        }
        Err(e) => {
            eprintln!("askk: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_command_line_is_read_as_a_door_an_engine_and_a_question() {
        let args = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        assert!(wanted(&args("askk")).is_none() && wanted(&args("askk --desk x")).is_none());
        let w = wanted(&args("askk terminal --to http://h:1 --engine askk/coder --desk d What is 2 + 2?")).unwrap();
        assert_eq!((w.to.as_deref(), w.engine.as_deref(), w.question.as_str()), (Some("http://h:1"), Some("askk/coder"), "What is 2 + 2?"));
        assert!(wanted(&args("askk terminal")).unwrap().question.is_empty());
        assert!(wanted(&args("askk terminal --lines")).unwrap().lines && !w.lines);
    }

    #[test]
    fn the_full_screen_is_for_a_person_at_a_real_terminal_and_a_pipe_gets_lines() {
        let args = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        let stay = wanted(&args("askk terminal")).unwrap();
        assert_eq!(shown(&stay, true, true, false), Shown::FullScreen);
        assert_eq!(shown(&stay, true, false, false), Shown::Lines, "its lines go to a pipe: a script reads them");
        assert_eq!(shown(&stay, false, true, false), Shown::Lines, "its keys come from a pipe: a script types them");
        assert_eq!(shown(&stay, true, true, true), Shown::Lines, "a terminal that says it cannot draw");
        assert_eq!(shown(&wanted(&args("askk terminal --lines")).unwrap(), true, true, false), Shown::Lines, "lines when asked for");
        assert_eq!(shown(&wanted(&args("askk terminal What is 2 + 2?")).unwrap(), true, true, false), Shown::Once, "a question is asked once, anywhere");
    }

    #[test]
    fn a_terminal_talks_to_the_running_service_unless_told_where_to_ask() {
        let args = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        let running = || Some("http://127.0.0.1:8090".to_string());
        assert_eq!(attach(wanted(&args("askk terminal")).unwrap(), running()).to.as_deref(), Some("http://127.0.0.1:8090"), "a running service is asked");
        assert_eq!(attach(wanted(&args("askk terminal --to http://h:1")).unwrap(), running()).to.as_deref(), Some("http://h:1"), "a named server wins");
        assert!(attach(wanted(&args("askk terminal")).unwrap(), None).to.is_none(), "with no service, this process is the host");
    }
}
