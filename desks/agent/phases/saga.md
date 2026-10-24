---
deadline_minutes: 240
retries: 1
board: false
vars:
  tales: 3
  minutes: 20
  audience: a curious adult who has never heard it
---
# Saga

A long, researched audio piece on a story tradition — a cycle of tales, an epic, a myth with its versions — told in
changing voices and streamed to the owner's Telegram chat chapter by chapter (2026-10-24 owner: "a story of Vikram
vetal, it would require the backstory, stories, the lore behind, any modification and interpretations. Searching the
story itself is a big research job. There is an original text and many stories surrounding it. There should a change
in narrative style where the background story, the prelude story and the narrative story. With expressiveness").

Three research steps read side by side — where it comes from, the tales themselves, how it has been read and changed —
each into its own notes file. The outline turns them into chapters, each part in a voice style (audio.styles: the
documentary background, the prelude that frames it, the storyteller's tales, the spirit's and the king's own lines, the
reflective close). The script is written into a file by the styles' writing guides, fact-checked, corrected, and made
into audio that goes out chapter by chapter as each is ready. Change a step's wording here to change how it works.

## origins — Where it comes from
kind: agent
tools: web.search, web.read
artifacts: files
max_steps: 40

Research the origins of {{request}}: the original text or texts (title in the original language and its meaning,
language, author or compiler, date or century, the larger work it sits in), the main recensions and early versions,
the famous translations and retellings (who, when, what they changed), and its modern life (books, television, film).
Then the frame story in full detail: who the characters are, how it begins, the bargain or quest, the rule that drives
it, and how it ends. Read the sources — encyclopedias, scholarly pages, translations online — not only search results.
Write everything you find to work/saga/{{date}}/origins.md, every fact with its source URL. A version that
disagrees with another is a finding: note both.

### Output
file: the notes file's path
frame: the frame story, start to end, in eight to twelve sentences
texts: one line per text or version — its name, language, author, date, what is distinct about it, its source
sources: the URLs read

## tales — The tales themselves
kind: agent
after: []
tools: web.search, web.read
artifacts: files
max_steps: 40

Research the tales inside {{request}}: list them all as the main version numbers them, each with a two-line summary
and, when it has one, the question posed at its end and the answer given. Then choose the {{tales}} tales that tell
best for {{audience}} — varied, with a strong turn and a question that makes a listener think — and for each gather the
full plot in detail: the characters and their names, each scene in order, the lines that matter, the question, the
answer and the reasoning behind it. Note where versions tell a tale differently. Read full retellings or translations,
not summaries only. Write it all to work/saga/{{date}}/tales.md with sources.

### Output
file: the notes file's path
all: one line per tale in the main version — its number and a one-line summary
chosen: the {{tales}} tales chosen, each with why, its question and its answer
sources: the URLs read

## readings — How it has been read and changed
kind: agent
after: []
tools: web.search, web.read
artifacts: files
max_steps: 30

Research how {{request}} has been interpreted and changed: what the old texts say it teaches, how scholars read it
(about kingship, wisdom, death, dharma, storytelling itself), what later tellers changed and why (a softened ending, a
moral added, a tale dropped or invented), and what it means to listeners now. Attribute every reading to someone.
Write it to work/saga/{{date}}/readings.md with sources.

### Output
file: the notes file's path
readings: four to eight readings, one line each, attributed, with a source
changes: the notable changes across versions, one line each

## outline — Plan the chapters and voices
kind: agent
after: [origins, tales, readings]
artifacts: files, audio
max_steps: 10

audio.styles first: the voice styles and what each is for. Plan a piece of about {{minutes}} minutes (150 words a
minute) for {{audience}} on {{request}}, from the research below (read the notes files for detail). Chapters in order:
1. the background — where it comes from (documentary);
2. the prelude — the frame story up to the first tale (prelude; the characters' own lines in their styles);
3. one chapter per chosen tale — told by the storyteller, its question in the spirit's voice, the answer in the regal
   voice (or the styles that fit this tradition's characters);
4. the close — how it ends, how it has been read and changed (the frame's end in prelude; the readings in reflective).
For each chapter: its title, its parts in order with the style of each and what that part covers, and its length in
words. Every fact the chapter needs, named from the notes.

Origins:
{{origins.frame}}
{{origins.texts}}
Notes: {{origins.file}}

Tales:
{{tales.chosen}}
Notes: {{tales.file}}

Readings:
{{readings.readings}}
{{readings.changes}}
Notes: {{readings.file}}

### Output
chapters: one block per chapter — its title, then each part: style · what it covers · words
words: the total

## write — Write the script
kind: agent
artifacts: files, audio
max_steps: 30

Write the whole script to work/saga/{{date}}/script.md, chapter by chapter, following the outline. Read
audio.styles once and write each part by its style's WRITING guide, and in its model's SCRIPT FORMAT (audio.models):
plain spoken prose, numbers and names as spoken, no headings or lists. Mark the script exactly so — each on its own
line: `[chapter: <title>]` to start a chapter, `[style: <name>]` before each part. Use files.write for the first
chapter and files.append for each next one, so a long script is never one huge call. Read the notes files for every
detail you use; invent nothing that is presented as fact (a tale's events are the tale's, as the sources tell it).

The outline:
{{outline.chapters}}

Notes: {{origins.file}}, {{tales.file}}, {{readings.file}}

### Output
file: the script's path
chapters: one line per chapter — its title and words
claims: every factual claim in the background, prelude and close chapters (texts, dates, authors, places, versions,
readings), one line each — C1, C2 …

## factcheck — Check the claims
kind: agent
tools: web.search, web.read
max_steps: 24

Check each claim against sources you read: is it true as worded? A claim the notes already source still gets one
independent check.

The claims:
{{write.claims}}

### Output
verdicts: one line per claim — C1 · true | wrong | unsure · the correct wording when it is not true · the source URL
summary: how many true, wrong, unsure

## correct — Correct the script
kind: agent
artifacts: files
max_steps: 10

Correct {{write.file}} in place (files.edit): fix each wrong claim with its correct wording, soften or cut each unsure
one, leave the rest — and the [chapter:] and [style:] lines — exactly as they are.

The verdicts:
{{factcheck.verdicts}}

### Output
file: the script's path
changes: one line per change — what it said, what it says now

## produce — Make it, check it, stream it out
kind: agent
artifacts: audio
max_steps: 30

audio.make {file: "{{write.file}}" (corrected in place), title: a title for the whole piece, send: true} — each chapter goes to the
owner's Telegram chat as soon as it is made. audio.wait until it is done (a long piece takes a while; wait again). Then
audio.transcribe each chapter {id, chapter: n}: below 90% heard, find what was skipped or misread, write those spots as
spoken in a short fixed passage, audio.make that chapter alone {text: its fixed script with its [style:] lines, title:
"<title> · <chapter> (fixed)", send: true} — at most once per chapter.

### Output
audio: the audio id, its length, its chapters with their lengths
heard: each chapter's share heard, and what was fixed
sent: what went to the owner's Telegram chat
