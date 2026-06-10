//! Working-memory compaction policy: pure decisions here, the summarization call
//! itself stays in the engine (it is just another one-shot model call).

use crate::state::Message;

#[derive(Clone, Copy, Debug)]
pub struct MemoryPolicy {
    /// Compact once the working message list reaches this length.
    pub compact_after_messages: usize,
    /// ... or once estimated tokens exceed this fraction of the context window.
    /// 0.7 leaves headroom for the parts the estimate cannot see: the rendered
    /// system prompt (soul + tools + skills) and format instructions.
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
/// folding would not be worth a model call — the compaction must fold at least
/// `keep_recent` messages (and always at least 2), so a fresh post-compaction
/// window cannot re-trigger an immediate, near-useless summarization.
pub fn split_for_compaction(
    messages: &[Message],
    keep_recent: usize,
) -> Option<(Vec<Message>, Vec<Message>)> {
    let min_fold = keep_recent.max(2);
    if messages.len() < keep_recent + min_fold {
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

    #[test]
    fn split_refuses_when_folding_fewer_than_keep_recent() {
        // keep_recent=10: 11..19 messages must refuse (folding 1..9 < 10);
        // 20 messages folds exactly 10.
        let messages: Vec<Message> = (0..19).map(|i| msg(&format!("m{i}"))).collect();
        assert!(split_for_compaction(&messages, 10).is_none());
        let messages: Vec<Message> = (0..20).map(|i| msg(&format!("m{i}"))).collect();
        let (older, recent) = split_for_compaction(&messages, 10).expect("splits at 2x");
        assert_eq!(older.len(), 10);
        assert_eq!(recent.len(), 10);
    }
}
