//! Pure history windowing: fit a message log into a character budget.
//! The FULL history stays with the run; this shapes only what the model
//! sees on one request — the loop is static, the elements are the contract.

use crate::request::{Message, Role};

fn cost(message: &Message) -> usize {
    message.content.chars().count()
}

fn marker(elided: usize) -> Message {
    Message::new(
        Role::System,
        format!("[…{elided} earlier messages elided to fit the context budget]"),
    )
}

/// Fit `history` into `budget_chars` total content characters.
///
/// If everything fits, the history returns unchanged. Otherwise the FIRST
/// user message (the pinned goal, when the history carries one) and the
/// NEWEST messages that fit are kept, in order, with ONE system marker in
/// between naming how many messages were elided. Messages are never split;
/// the pinned goal and the marker itself may overflow a tiny budget — the
/// budget bounds the elidable middle, not the anchors.
pub fn window_history(history: &[Message], budget_chars: usize) -> Vec<Message> {
    if history.iter().map(cost).sum::<usize>() <= budget_chars {
        return history.to_vec();
    }
    let goal_idx = history.iter().position(|m| m.role == Role::User);
    // The tail never re-includes the goal; anything between the goal and the
    // tail (and anything before the goal) is elidable.
    let tail_floor = goal_idx.map_or(0, |i| i + 1);
    let mut left = budget_chars.saturating_sub(goal_idx.map_or(0, |i| cost(&history[i])));
    let mut tail_start = history.len();
    while tail_start > tail_floor && cost(&history[tail_start - 1]) <= left {
        left -= cost(&history[tail_start - 1]);
        tail_start -= 1;
    }
    let elided = tail_start - usize::from(goal_idx.is_some());
    let mut out = Vec::with_capacity(history.len() - tail_start + 2);
    if let Some(i) = goal_idx {
        out.push(history[i].clone());
    }
    out.push(marker(elided));
    out.extend(history[tail_start..].iter().cloned());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: Role, content: &str) -> Message {
        Message::new(role, content)
    }

    fn total(history: &[Message]) -> usize {
        history.iter().map(cost).sum()
    }

    /// goal (10 chars) + `n` tool observations of 10 chars each.
    fn goal_plus(n: usize) -> Vec<Message> {
        let mut h = vec![msg(Role::User, "goal 4567.")];
        for i in 0..n {
            h.push(msg(Role::Tool, &format!("tool {i:04}.")));
        }
        h
    }

    #[test]
    fn fits_returns_history_unchanged() {
        let h = goal_plus(3); // 40 chars
        assert_eq!(window_history(&h, 40), h);
        assert_eq!(window_history(&h, 1_000), h);
    }

    #[test]
    fn empty_history_fits_any_budget() {
        assert!(window_history(&[], 0).is_empty());
    }

    #[test]
    fn elides_middle_keeps_goal_and_newest_in_order() {
        let h = goal_plus(9); // 100 chars total
                              // goal (10) leaves 40: exactly the newest four 10-char messages fit.
        let out = window_history(&h, 50);
        assert_eq!(out.len(), 6); // goal + marker + 4 newest
        assert_eq!(out[0], h[0]);
        assert_eq!(
            out[1].content,
            "[…5 earlier messages elided to fit the context budget]"
        );
        assert_eq!(out[1].role, Role::System);
        assert_eq!(&out[2..], &h[6..]); // newest four, original order
    }

    #[test]
    fn never_splits_a_message() {
        let h = goal_plus(9);
        // 45 leaves 35 after the goal: only three whole 10-char messages fit —
        // the fourth is dropped entirely, never truncated.
        let out = window_history(&h, 45);
        assert_eq!(&out[2..], &h[7..]);
        assert!(out.iter().all(|m| m.content.len() >= 10)); // no partial message
    }

    #[test]
    fn no_user_message_keeps_newest_with_marker() {
        let h: Vec<Message> = (0..5)
            .map(|i| msg(Role::Tool, &format!("obs {i:05}.")))
            .collect();
        let out = window_history(&h, 20);
        assert_eq!(
            out[0].content,
            "[…3 earlier messages elided to fit the context budget]"
        );
        assert_eq!(&out[1..], &h[3..]);
    }

    #[test]
    fn zero_budget_keeps_goal_and_marker_only() {
        let h = goal_plus(4);
        let out = window_history(&h, 0);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], h[0]); // the goal anchor survives any budget
        assert_eq!(
            out[1].content,
            "[…4 earlier messages elided to fit the context budget]"
        );
    }

    #[test]
    fn pre_goal_messages_are_elided_and_counted() {
        let mut h = vec![msg(Role::System, "sys before.")];
        h.extend(goal_plus(4)); // sys + goal + 4 tools = 61 chars
        let out = window_history(&h, 30);
        // goal (10) leaves 20: two newest fit; sys + two middle tools elided.
        assert_eq!(out[0], h[1]); // the goal, not the pre-goal system message
        assert_eq!(
            out[1].content,
            "[…3 earlier messages elided to fit the context budget]"
        );
        assert_eq!(&out[2..], &h[4..]);
    }

    #[test]
    fn budget_is_respected_up_to_the_marker() {
        let h = goal_plus(20);
        for budget in [15, 30, 50, 95] {
            let out = window_history(&h, budget);
            // Everything except the marker itself fits the budget.
            let kept = total(&out) - cost(&out[1]);
            assert!(kept <= budget, "budget {budget}: kept {kept} chars");
        }
    }
}
