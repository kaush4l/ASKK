//! The service's words on the command line: `askk start`, `stop`, `status`, `restart`.
//!
//! ```text
//! askk start      run askk in the background for this home; returns when it answers
//! askk status     is it running, where, since when, which build, which engines, what it can do
//! askk stop       ask it to finish, and wait until it has
//! askk restart    stop, then start: how a new build or a new `listen` address comes into force
//! ```
//!
//! `--desk <folder>` names another data folder, as everywhere. Thin, like every shell: it
//! reads the command line and prints. What is done is the host's (`host/service.rs`); what
//! the lines say is the feature's (`ui/features/service.rs`).
use crate::core::service::{Status, Verb};

/// Is this one of the service's words? Then which.
pub fn wanted(args: &[String]) -> Option<Verb> {
    match args.get(1).map(String::as_str) {
        Some("start") => Some(Verb::Start),
        Some("stop") => Some(Verb::Stop),
        Some("status") => Some(Verb::Status),
        Some("restart") => Some(Verb::Restart),
        _ => None,
    }
}

/// Say how it went; the number is the process's exit code. `askk status` ends with 0 only
/// when the service runs, so a script can ask it.
pub fn tell(verb: Verb, outcome: Result<Status, String>) -> i32 {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    match outcome {
        Ok(status) => {
            for line in crate::ui::features::service::lines(&status, now) {
                println!("{line}");
            }
            i32::from(verb != Verb::Stop && !status.running)
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
    fn the_command_line_names_one_of_four_words() {
        let args = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        assert_eq!(wanted(&args("askk start")), Some(Verb::Start));
        assert_eq!(wanted(&args("askk restart --desk d")), Some(Verb::Restart));
        assert_eq!((wanted(&args("askk stop")), wanted(&args("askk status"))), (Some(Verb::Stop), Some(Verb::Status)));
        assert!(wanted(&args("askk")).is_none() && wanted(&args("askk terminal start")).is_none());
        let running = Status { running: true, ..Default::default() };
        assert_eq!((tell(Verb::Status, Ok(running)), tell(Verb::Status, Ok(Status::default())), tell(Verb::Stop, Ok(Status::default()))), (0, 1, 0));
    }
}
