//! Working-memory compaction policy: pure decisions here, the summarization call
//! itself stays in the engine (it is just another one-shot model call).

use crate::state::Message;

#[derive(Clone, Copy, Debug)]
pub struct MemoryPolicy {
    /// Compact once the working message list reaches this length.
    pub compact_after_messages: usize,
    /// ... or once estimated tokens exceed this fraction of the context window.
    pub context_fraction: f32,
    /// How many of the newest messages stay verbatim through a compaction.
    pub keep_recent: usize,
}

impl Default for MemoryPolicy {
    fn default() -> Self {
        Self {
            compact_after_messages: 100,
            context_fraction: 0.7,
            keep_recent: 10,
        }
    }
}

/// chars ÷ 4 heuristic; deliberately tokenizer-free.
pub fn estimated_tokens(messages: &[Message]) -> usize {
    messages
        .iter()
        .map(|message| message.role.len() + message.content.len())
        .sum::<usize>()
        / 4
}

/// True when either trigger fires. `context_window` of 0 disables the token trigger.
pub fn needs_compaction(policy: &MemoryPolicy, messages: &[Message], context_window: u32) -> bool {
    if messages.len() >= policy.compact_after_messages {
        return true;
    }
    if context_window == 0 {
        return false;
    }
    let budget = (f64::from(context_window) * f64::from(policy.context_fraction)) as usize;
    estimated_tokens(messages) > budget
}

/// Split for compaction: (older to summarize, recent kept verbatim). None when
/// there is nothing meaningful to fold (fewer than keep_recent + 2 messages).
pub fn split_for_compaction(
    messages: &[Message],
    keep_recent: usize,
) -> Option<(Vec<Message>, Vec<Message>)> {
    if messages.len() < keep_recent + 2 {
        return None;
    }
    let split_at = messages.len() - keep_recent;
    Some((messages[..split_at].to_vec(), messages[split_at..].to_vec()))
}

/// The single message that replaces the summarized prefix.
pub fn summary_message(summary: &str, open_threads: &[String]) -> Message {
    let threads = if open_threads.is_empty() {
        String::new()
    } else {
        format!("\nOpen threads:\n- {}", open_threads.join("\n- "))
    };
    Message {
        role: "user".to_string(),
        content: format!(
            "Summary of earlier work in this run (older messages were compacted):\n{summary}{threads}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(content: &str) -> Message {
        Message {
            role: "user".to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn count_trigger_fires_at_threshold() {
        let policy = MemoryPolicy {
            compact_after_messages: 3,
            context_fraction: 0.7,
            keep_recent: 1,
        };
        let messages = vec![msg("a"), msg("b"), msg("c")];
        assert!(needs_compaction(&policy, &messages, 100_000));
        assert!(!needs_compaction(&policy, &messages[..2], 100_000));
    }

    #[test]
    fn token_trigger_fires_on_estimate() {
        let policy = MemoryPolicy {
            compact_after_messages: 1000,
            context_fraction: 0.5,
            keep_recent: 1,
        };
        // 1 message * 4000 chars ≈ 1001 tokens > 0.5 * 2000 = 1000.
        let messages = vec![msg(&"x".repeat(4000))];
        assert!(needs_compaction(&policy, &messages, 2000));
        assert!(!needs_compaction(&policy, &messages, 0)); // disabled window
    }

    #[test]
    fn split_keeps_recent_verbatim_and_refuses_tiny_lists() {
        let messages: Vec<Message> = (0..6).map(|i| msg(&format!("m{i}"))).collect();
        let (older, recent) = split_for_compaction(&messages, 2).expect("splits");
        assert_eq!(older.len(), 4);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[1].content, "m5");
        assert!(split_for_compaction(&messages[..3], 2).is_none());
    }
}
