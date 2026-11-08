---
title: Phases
kind: phases
order: 3
description: "The phase you select is the mode Askk works in; a workflow runs phases in order."
config: { list: [{id: chat, title: Chat, icon: "💬", tools: [], instructions: "Talk it through: answer from what you know and what the notes and memory say."}, {id: research, title: Research, icon: "🔎", tools: [files.read, clock.now, help.ask], instructions: "Find out before answering: read the workspace files that bear on the input, check the time when it matters, and ask the owner when only they can close a gap. Say where each fact came from."}, {id: build, title: Build, icon: "🛠️", tools: [note.write, files.read, clock.now], instructions: "Make the thing asked for: read what you need, write the result into a note, then answer with what you made."}] }
---
