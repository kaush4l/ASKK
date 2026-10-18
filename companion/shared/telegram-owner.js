// Telegram intake is the owner's own account only: the bot's listener (integrations/telegram) checks
// every incoming Message with whyNotOwner(), and the server-side bridge (companion/team/kernel-telegram.js)
// checks every queued event again with whyNotOwnerEvent(). Both answer null (accept) or a short reason,
// never an id, so the reason can be logged as it is.
//
// The owner: TELEGRAM_OWNER_ID, else TELEGRAM_CHAT_ID (the owner's private chat id, which Telegram makes
// equal to the owner's user id).

export const ownerIdFrom = (env = {}) => String(env.TELEGRAM_OWNER_ID ?? "").trim() || String(env.TELEGRAM_CHAT_ID ?? "").trim() || null

const same = (a, b) => a != null && b != null && String(a) === String(b)

// A Bot API Message → null when the owner wrote it in their private chat with the bot, else why not.
export function whyNotOwner(message, ownerId) {
  if (!ownerId) return "no owner configured"
  if (!message || typeof message !== "object" || !message.chat) return "not a message"
  if (message.chat.type !== "private") return `a ${String(message.chat.type ?? "unknown").slice(0, 20)} chat`
  if (!same(message.from?.id, ownerId)) return "another user"
  if (!same(message.chat.id, ownerId)) return "another private chat"
  if (message.from?.is_bot) return "a bot"
  if (message.sender_chat || message.sender_business_bot || message.business_connection_id) return "sent on behalf of a chat or business"
  const origin = message.forward_origin
  if (origin || message.forward_from || message.forward_from_chat || message.forward_sender_name || message.forward_date) {
    if (!(origin?.type === "user" && same(origin.sender_user?.id, ownerId))) return "forwarded from someone else"
  }
  if (message.edit_date) return "an edited message"
  return null
}

// An event from the listener's queue ({ owner, chatType, fromId, chat, forwarded, … }) → null or why not.
export function whyNotOwnerEvent(event, ownerId = null) {
  if (!event || event.owner !== true) return "not marked as the owner's by the listener"
  if (event.chatType !== "private") return "not a private chat"
  if (event.forwarded) return "forwarded from someone else"
  if (ownerId && !same(event.fromId, ownerId)) return "another user"
  if (ownerId && !same(event.chat, ownerId)) return "another chat"
  if (!same(event.fromId, event.chat)) return "another chat" // a private chat's id is its user's id
  return null
}
