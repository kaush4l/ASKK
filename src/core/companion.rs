//! # Companion: what the small character shows
//!
//! The companion is a face of the app that carries no number, only a mood. The mood is decided
//! here, from what the host already counts ([`Glance`]); how it is drawn is `ui/`, what holds it
//! is `shells/`. The rule is code. Which corner, how big and which engine the bubble talks to
//! are a value (`surfaces.json`, see [`super::surfaces::Companion`]).
//!
//! | mood | when |
//! | --- | --- |
//! | `asleep` | the host does not answer |
//! | `working` | an engine runs (`Glance.running`) |
//! | `asking` | mail waits unseen in an engine's box and nothing runs (`Glance.waiting`) |
//! | `idle` | nothing runs, nothing waits |
//!
//! Mail stays unseen while its engine works on it, so `working` wins over `asking`: the
//! character asks for attention only when mail waits and nobody is on it.
use super::surfaces::Glance;

/// The companion's lasting mood.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mood {
    Asleep,
    Idle,
    Working,
    Asking,
}

impl Mood {
    /// The word a drawing is keyed by (its CSS class; later a pack's key).
    pub fn name(self) -> &'static str {
        match self {
            Mood::Asleep => "asleep",
            Mood::Idle => "idle",
            Mood::Working => "working",
            Mood::Asking => "asking",
        }
    }
}

/// The mood for the host's numbers; `None` when the host did not answer.
pub fn mood(numbers: Option<Glance>) -> Mood {
    match numbers {
        None => Mood::Asleep,
        Some(g) if g.running > 0 => Mood::Working,
        Some(g) if g.waiting > 0 => Mood::Asking,
        Some(_) => Mood::Idle,
    }
}

/// A short one-time motion, played when the numbers change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Beat {
    /// One more message waits unseen.
    Arrived,
    /// The last running engine finished and nothing waits.
    Done,
}

impl Beat {
    pub fn name(self) -> &'static str {
        match self {
            Beat::Arrived => "arrived",
            Beat::Done => "done",
        }
    }
}

/// The beat between two readings, if any. Waking up (no reading before) plays none.
pub fn beat(before: Option<Glance>, now: Option<Glance>) -> Option<Beat> {
    let (b, n) = (before?, now?);
    if n.waiting > b.waiting {
        Some(Beat::Arrived)
    } else if b.running > 0 && n.running == 0 && n.waiting == 0 {
        Some(Beat::Done)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(waiting: usize, running: usize) -> Option<Glance> {
        Some(Glance { waiting, running })
    }

    #[test]
    fn the_mood_follows_the_numbers() {
        assert_eq!(mood(None), Mood::Asleep);
        assert_eq!(mood(g(0, 0)), Mood::Idle);
        assert_eq!(mood(g(0, 2)), Mood::Working);
        assert_eq!(mood(g(1, 0)), Mood::Asking);
    }

    #[test]
    fn running_work_wins_over_waiting_mail() {
        // Mail stays unseen while its engine works on it: that is work, not a call for help.
        assert_eq!(mood(g(1, 3)), Mood::Working);
        assert_eq!(mood(g(1, 1)), Mood::Working);
        assert_eq!(mood(g(2, 0)), Mood::Asking);
    }

    #[test]
    fn a_beat_plays_when_a_message_arrives_or_the_work_ends() {
        assert_eq!(beat(g(0, 1), g(1, 1)), Some(Beat::Arrived));
        assert_eq!(beat(g(2, 0), g(3, 0)), Some(Beat::Arrived));
        assert_eq!(beat(g(0, 2), g(0, 0)), Some(Beat::Done));
        // Work ended but a message waits: the message is the news, and it arrived earlier.
        assert_eq!(beat(g(1, 1), g(1, 0)), None);
        // Still working, a message read, nothing changed: no beat.
        assert_eq!(beat(g(0, 2), g(0, 1)), None);
        assert_eq!(beat(g(1, 0), g(0, 0)), None);
        assert_eq!(beat(g(0, 0), g(0, 0)), None);
    }

    #[test]
    fn waking_up_or_falling_asleep_plays_no_beat() {
        assert_eq!(beat(None, g(3, 0)), None);
        assert_eq!(beat(g(0, 1), None), None);
    }

    #[test]
    fn every_mood_and_beat_has_its_own_word() {
        let moods = [Mood::Asleep, Mood::Idle, Mood::Working, Mood::Asking].map(Mood::name);
        assert_eq!(moods, ["asleep", "idle", "working", "asking"]);
        assert_eq!([Beat::Arrived, Beat::Done].map(Beat::name), ["arrived", "done"]);
    }
}
