# Morning briefing

When the user or the scheduler triggers a morning briefing, follow this recipe:

1. **Calendar** — `gcal_events` with `days_ahead: 1`. List every event with time
   and location. Flag back-to-back meetings and conflicts.

2. **Email** — `gmail_search` with `query: "is:unread"` and `max_results: 10`.
   Summarise each message in one sentence (sender, subject, key ask). Skip newsletters
   and automated notifications. Never quote full message bodies.

3. **News** — `web_search` with a topical query (e.g. "morning news tech AI").
   Return 3-5 headlines with a one-line summary each.

4. **Schedule** — `manage_schedule` with `action: list`. Note any entries due today.

5. **Compose the briefing** as a short structured message:
   - Header: today's date + day of week.
   - Sections: Calendar | Email | News | Reminders.
   - Footer: unread count + top suggested action.

6. If Telegram is configured, propose a 3-line phone summary. Show the text first,
   wait for the owner to say "yes" or similar, then call `telegram_send` with
   `confirmed: true`. Never send without explicit approval.
