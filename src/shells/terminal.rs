//! The terminal shell: `askk terminal`.
//!
//! ```text
//! askk terminal                         talk to the service running for this home (`askk start`);
//!                                       with none running, this process is the host
//! askk terminal --to http://127.0.0.1:8090   talk to the askk server at that address
//! askk terminal --engine askk/coder     choose the engine
//! askk terminal What is 17 * 23?        ask once, print what the loop did and the answer, leave
//! ```
//!
//! Thin, like every shell: it reads the command line and hands over to `ui/terminal`.
use crate::ui::terminal::{talk_until_done, Door, Session};

/// What the command line asked for.
pub struct Wanted {
    /// A server to talk to; none = this process is the host.
    pub to: Option<String>,
    pub engine: Option<String>,
    /// A question to ask once; empty = stay and talk.
    pub question: String,
}

/// Is this a terminal start (`askk terminal …`)? Then what it wants.
pub fn wanted(args: &[String]) -> Option<Wanted> {
    if args.get(1).map(String::as_str) != Some("terminal") {
        return None;
    }
    let mut w = Wanted { to: None, engine: None, question: String::new() };
    let mut words = vec![];
    let mut rest = args[2..].iter();
    while let Some(a) = rest.next() {
        match a.as_str() {
            "--to" => w.to = rest.next().cloned(),
            "--engine" => w.engine = rest.next().cloned(),
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
    let door = match w.to {
        Some(base) => Door::There(base),
        None => Door::Here,
    };
    let session = match rt.block_on(Session::open(door, w.engine)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("askk: {e}");
            return 1;
        }
    };
    if w.question.is_empty() {
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
