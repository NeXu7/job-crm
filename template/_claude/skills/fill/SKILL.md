---
name: fill
description: Bank-filling session for the job search — raw material, facts, STAR stories, interview answers, strengths and weaknesses. Use when the user says «давай наполнять», «разберём сырьё», «готовим ответы», «заполним истории», «сильные стороны» or types /fill.
argument-hint: "[сырьё | факты <опыт> | истории | ответы [категория] | стороны]"
---

# Bank-filling session

Goal: draw material out of the user and file it into the banks as drafts, inventing nothing.
The CRM (http://localhost:4317) reads the banks and shows edits at once. The user confirms in the CRM.
Talk to the user in Russian, addressing them as «ты»; this file is in English only to save tokens.
The user's name and constraints are in `00-profile/profile.yaml`.

## Where things live

| Bank | File | Contents |
|---|---|---|
| Raw material | `00-profile/notes/<date>-<topic>.md` | the user's dictations (dump) and session logs (session); the source for everything else |
| Facts | `00-profile/facts/<exp>.yaml` | atoms with numbers for the resume; `source` is required |
| Stories | `00-profile/stories.yaml` | STAR + tradeoff + reflection; `covers` — competencies it answers (1/2) |
| Questions and answers | `00-profile/questions/<category>.yaml` | interview questions; `answers` — variants, incl. per track |
| Strengths and weaknesses | `00-profile/strengths.yaml` | `strengths` (pitch + evidence), `weaknesses` (how it sounds + counter) |
| Positioning | `00-profile/positioning.md` | free text; its TODOs are gaps too (level 3, bank `docs`) |

## Tool

Every write goes through `bank`, not hand-edited YAML: it validates the whole batch before writing,
assigns ids, and rejects made-up references and the verified/ready statuses. Run it from the workspace
root: it works on the folder it is started from.

```bash
npm --prefix app run -s bank -- stats                      # progress per bank
npm --prefix app run -s bank -- gaps --level 1             # queue: what gets asked first (+ --bank stories, --json)
npm --prefix app run -s bank -- show <id>                  # a record and where it is used (fact, S1, question, raw file)
npm --prefix app run -s bank -- ops                        # operations, tracks, competencies, tags, experiences
npm --prefix app run -s bank -- apply - --dry <<'JSON'     # validate a batch
npm --prefix app run -s bank -- apply - <<'JSON'           # write a batch
```

## Start

0. A filling session is long and light — it should run on Sonnet. If your model is not Sonnet, say so
   in one line and suggest the user switch with `/model` (a session cannot switch itself); then go on.
1. `stats` and `gaps --level 1`. If the argument names a mode, work in it.
2. **Empty bank** (no experiences yet — a new workspace; `gaps` shows the level-1 item «Добавить места
   работы: банк фактов пуст», key `exp:none` in `--json`):
   start with the basics, in this order:
   - the profile — ask the user to fill name, contacts, the positioning line and «Контекст поиска»
     (`context`) in the CRM («Банк фактов» → «Профиль»), or write `00-profile/profile.yaml` from their
     words if they ask you to (the CRM rewrites the file on save, so no YAML comments);
   - the workplaces — for each one, `experience.create` (org, title, start, end; `kind: section` for
     skills, projects, teaching); the user can also add them in the CRM («Банк фактов» → «+ Опыт»);
   - an old resume or LinkedIn export — ask them to drop it as raw material («Наполнение» → «Сбросить
     сырьё») and process it in the `сырьё` mode. A resume is angled material: facts taken from it are
     `needs-proof` until the user confirms them in conversation.
3. Otherwise, in one message show the user 3–5 level-1 items and unprocessed raw material; ask where to start.
4. Session topic — short, Latin or Russian (`acme`, `конфликт`, `ответы-мотивация`). It becomes the log
   name: `00-profile/notes/<date>-session-<topic>.md`.

## Running the conversation

- **One question at a time.** Start from the gap's `ask` field — it is worded for that gap.
- Order for any episode: the task → what **the user personally** did → the result in numbers **against
  a baseline** → the tradeoff → what they would do differently.
- A number without a baseline ("30% faster") — ask: than what, on what sample, who measured.
- "We", "the team" — ask what they did themselves. Without that the answer is useless for behavioral.
- Don't suggest the answer or fill in blanks. If they don't remember — record the gap (`note`,
  `needs-proof`) and move on.
- If the user dictates by voice: in the log drop filler words and repeats, but keep numbers, names and
  dates verbatim.
- Every 3–5 answers — a two-line recap: what got recorded, what's next.

## Writing — after every answer

1. **Log first.** `note.log` with the session topic: `heading` — your question, `text` — the user's answer
   (both in Russian, as said). This is the source facts and stories cite (`source: notes/<log file>`).
2. **Then drafts** in one batch: fact, story fields, answer variant, strength/weakness.
3. Statuses: only `draft` or `needs-proof`. The user sets `verified`/`ready` in the CRM — `bank` rejects them.
4. Fact: past-tense verb, what was done, scale, a number; one idea per fact; `text` in English, `ru` in Russian.
5. Rewording an existing fact → a new fact with `derived_from`. Never change the id of a fact used in a
   recipe or a sent resume (`show <id>` tells where it is used).
6. Never touch `applications/*/locks/`.

## Modes

### сырьё (raw material)
For every file with `status: new`: `show <file>` → list candidates: facts with numbers, story fields,
answers, strengths/weaknesses, questions asked in real interviews. Show the list to the user, clarify
what's unclear, write what they confirm (`source: notes/<file>`), then `note.status processed`.
A long file can be digested by a subagent (Sonnet by default) that returns only the candidate list.

### факты <exp> (facts)
`show <exp>`, `gaps --bank facts`. First `needs-proof` from the base resume (level 1), then vacancy
requirements without facts, then new episodes in the conversation order above. An experience with no
facts yet: start from its main task, what the user did personally and how it was measured.

### истории (stories)
First the competency gaps (`gaps --bank stories`), then empty STAR fields in existing stories.
A story is ready to tell when it has: situation, personal action, result with a number (a fact
reference), tradeoff, reflection. `covers`: 2 — the story directly answers the competency, 1 — touches
it. Don't inflate.

### ответы [category] (answers)
First `high` questions without a ready answer and questions already asked in interviews. Behavioral —
story first, then the answer citing it. Answer: English, conversational, 60–120 seconds: direct answer →
story → number → link to the role. Where material is missing — `[what to insert, in Russian]`, not an
invention. If the answer differs by track — a second variant with `roles`. At the end offer to say it
aloud; the user sets «Готов». "Why us" and "why me" are not in the bank — they live on each vacancy card.
A bank question that doesn't fit the user's profile (e.g. a founder probe for someone who never ran a
company) — offer to delete it or lower its `priority` instead of writing an answer.
`logistics` («Условия»): lean on `context` in `profile.yaml`, `positioning.md` §9 and, if the user keeps
one, the optional `00-profile/legal-and-location.md`; anything they haven't stated is a placeholder.

### стороны (strengths and weaknesses)
Strength: `pitch` — 1–2 sentences in English, the way they'll say it, + evidence (facts, stories).
Weakness: `sounds` — how it comes across in an interview, `counter` — admit → what I do about it → a fact;
`questions` — which bank questions expose it.

## End of session

1. `npm --prefix app run check` — fix before committing.
2. Session log and processed raw material → `note.status processed`.
3. Recap for the user (in Russian): what was added per bank; what awaits their confirmation in the CRM
   (drafts) — with paths like «Интервью → …», «Банк фактов → …»; how many level-1 items remain; where to
   start next time.
4. Commit: `git add 00-profile && git commit -m "Наполнение: <тема>" -m "<что добавлено>" -m "Agent: claude"`
   (the message is in Russian — it shows in the CRM journal).

## Example batch

Illustrative only — the company, the people and the story are made up.

```json
[
  {"op": "experience.create", "org": "Acme", "title": "Product Manager", "start": "2021-04", "end": "2023-09"},
  {"op": "note.log", "topic": "конфликт", "heading": "С кем был конфликт и из-за чего?",
   "text": "С тимлидом соседней команды: спорили, чью архитектуру берём в прод…"},
  {"op": "story.create", "id": "S8", "title": "Acme — спор об архитектуре с соседней командой",
   "exp": "acme", "covers": {"conflict": 2, "influence": 1},
   "situation": "…", "action": "…", "source": "notes/2026-01-15-session-konflikt.md"},
  {"op": "answer.add", "question": "behavioral.conflict", "label": "основной", "stories": ["S8"],
   "text": "At Acme, my team and a neighbouring team disagreed on … [результат в цифрах]"}
]
```

To reference a record from the same batch, give it an explicit `id` (like `S8` above); an experience
gets its id from `org` (`Acme` → `acme`), so the story can point to it. A story or fact must reference
an experience that exists or is created earlier in the batch.
