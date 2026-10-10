# Job search workspace — agent rules

This folder is the user's job-search workspace: Markdown/YAML data under git. The Job CRM app
(`app/`, http://localhost:4317) reads and writes the same files. My file edits show up in the UI at once:
the server watches the folders and reloads what changed.

The user's name, contacts and constraints are in `00-profile/profile.yaml`; their positioning is in
`00-profile/positioning.md`. Read those instead of assuming anything about the user.

## Where things live

| Path | What | Who edits |
|---|---|---|
| `00-profile/profile.yaml` | Name, location, contacts, education, languages, positioning line, `context` (time zone, location, employment format, constraints — English, goes into Claude prompts; edited in the CRM at «Банк фактов» → «Профиль» → «Контекст поиска») | the user, me on request |
| `00-profile/facts/<exp>.yaml` | **Fact bank**: one file per workplace or resume section — `experience` + `facts` | the user in the CRM, me on request |
| `00-profile/summaries.yaml` | Resume summary variants | both |
| `00-profile/icp.yaml` | ICP criteria for the fit score (from `positioning.md` §5) | both |
| `00-profile/positioning.md` | Positioning and narrative (free text); its `TODO` lines are fill gaps (level 3, bank `docs`: CRM → «Наполнение» → «Когда-нибудь») | both |
| `00-profile/legal-and-location.md` | *Optional, not created by setup.* The user's own document on legal setup, location, taxes (any language); when present, answer drafts for `logistics` questions include it | the user |
| `00-profile/stories.yaml` | **Story bank** for behavioral: STAR + tradeoff + reflection, competency coverage | both |
| `00-profile/questions/<category>.yaml` | **Interview question bank** with answer variants | both |
| `00-profile/strengths.yaml` | **Strengths** (pitch + evidence) and **weaknesses** (how it sounds + the counter) | both |
| `00-profile/notes/` | **Raw material**: the user's dictations and filling-session logs; the source for facts and stories | both |
| `04-resume/recipes/<track>.yaml` | Base resume recipes, one per track (a direction of roles) | both |
| `04-resume/build/` | PDF cache, rebuilt from lock files; not in git | the app |
| `02-pipeline/companies/<slug>.yaml` | Companies | vacancy analysis, both |
| `02-pipeline/applications/<id>/` | Application: `application.md`, `capture/`, `resume.recipe.yaml`, `locks/`, `prep.yaml` | CRM, me on request |
| `02-pipeline/interviews/` | Interview retros from `_TEMPLATE.md` | both |
| `app/` | Symlink to the Job CRM code checkout — a separate git repo, not part of this one | see below |

### app/ is a separate repo

`app/` points to the Job CRM code checkout. It is ignored here (`/app` in `.gitignore`).
- Don't edit code unless the user asks for a change to the app.
- Code changes are committed in that repo (`git -C app …`); data changes are committed here. Never mix them.
- `npm --prefix app …` run here (server, `check`, `bank`) works on this folder: the app takes the
  folder npm was started from when it is a workspace, even if `CRM_ROOT` in `app/.env` names another
  one. Only a `CRM_ROOT` set in the shell environment overrides that (with a warning). So always run
  the commands from this folder's root.

## Hard rules

1. **Never invent facts or numbers.** A new fact is `status: draft` plus a question to the user.
   Rewording an existing fact is a new fact with `derived_from: <id>`, also `draft`.
   Numbers come only from the user's words or documents; the origin goes in `source`.
2. **Never touch `applications/*/locks/*.yaml`.** It is the exact text of a sent resume.
3. **Never change a fact id** used in recipes or lock files. Need another id — make a new fact.
4. **Never move an application through a gate** (empty "why them / why me" → not past `research`;
   no lock → not past `ready`). The user writes "why them / why me"; I may offer points.
5. **Send nothing outside.** Emails are drafts; the user submits applications themselves.
6. After data edits: `npm --prefix app run check`. Fix errors before committing.
7. One commit per logical change; the message ends with the line `Agent: claude` —
   the CRM journal uses it to tell my edits from UI edits.

## Fact format

```yaml
- id: acme.support-backlog          # <exp>.<gist>, Latin, never changes
  text: Cut the support backlog from 400 to 60 open tickets …   # resume wording, EN
  short: …                           # short variant (optional)
  ru: …                              # for the user, in Russian
  tags: [delivery, client]           # shared tag vocabulary; add new tags deliberately
  roles: [main]                      # track ids from 04-resume/recipes
  metrics: [400 → 60 open tickets]
  status: verified                   # verified | needs-proof | draft
  source: notes/2026-01-15-session-acme.md   # where the fact comes from
  stories: [S1]                      # stories from stories.yaml
  note: …                            # what to back up, caveats
  derived_from: …                    # if it rewords another fact
```

(The example is illustrative; real facts come only from the user.)
A good fact: past-tense verb, what was done, scale, a number. One idea per fact.

An experience file starts with `experience: {id, org, kind: job|section, title, start, end, location, blurb, order}`
(`blurb` — an optional one-line description of the company or section);
`kind: section` is a separate resume section (skills, projects, teaching). Create it with
`bank apply` → `experience.create` or in the CRM («Банк фактов» → «+ Опыт»). With no experiences at
all, the gap queue contains a level-1 item asking for the workplaces.

## Other file formats

When the CRM saves a YAML file it rewrites it whole, with a fixed Russian header comment. Don't put
comments in data YAML — they are lost on the next save; explanations go here or in `README.md`.

- `profile.yaml`: `name` (as on the resume), `location` (city and country for the header, or "Remote"),
  `contacts` (`email`, `phone`, `linkedin`, `github`, `website`; empty ones stay off the resume),
  `education` (list of `id`, `school`, `field`, `degree`, `start`, `end`), `languages` (list of `name`,
  `level`), `positioning` (one English line: who the user is and what roles they target), `context`
  (free English text for Claude prompts: time zone, location and relocation, employment format,
  work authorization, other constraints). Empty `positioning`/`context` are left out of prompts.
- `icp.yaml`: `criteria` of `{id, name, target, reject}`; Claude scores each 0–2 (2 — matches `target`,
  0 — hits `reject`). Never change a criterion `id` after the first analyses: scores are stored by it.
- `04-resume/recipes/<track>.yaml`: `{id, name, headline, summary, facts, template, pages}`; `id` is the
  track id used by facts (`roles`), answers and applications — never change it after the first
  applications; `summary` is an id from `summaries.yaml`; `facts` maps an experience id to an ordered
  list of fact ids. Drafts don't belong in a recipe: the resume skips them and `npm run check` flags them.

## Filling the banks

A filling session is the `/fill` skill (`.claude/skills/fill/SKILL.md`): how to start, run the
conversation, write, finish. In short:

- Gap queue and progress: `npm --prefix app run -s bank -- gaps --level 1`, `… bank -- stats`.
  The same queue is in the CRM → «Наполнение».
- Write through `npm --prefix app run -s bank -- apply` (a JSON batch, validated as a whole before
  writing), not by editing YAML by hand. Reference: `… bank -- ops`.
- Every answer from the user goes to the session log first (`note.log` → `00-profile/notes/`), then
  drafts that cite the log in `source`. A number without that trail is made up.
- I write only `draft`/`needs-proof`; the user sets `verified`/`ready` in the CRM.
- A brand-new workspace has an empty fact bank: start with the profile, the experiences (one per
  workplace) and the raw material, then facts, then stories.

## Questions, answers, stories

- Question categories: `intro`, `motivation`, `probe` (into the profile's weak spots), `behavioral`,
  `leadership`, `product`, `ai` (shown as «Профессия и техника»: questions on the user's own field —
  tools, architecture, cases), `logistics` («Условия»), `reverse` (the user's questions to them). One
  file per category; id `<category>.<gist>`. The starter bank is generic: adapt, add or delete questions to fit
  the user's profile and tracks.
- `priority`: `high` — asked almost always (always in prep), `medium` — often (by track),
  `low` — sometimes (only via requirements, Claude or by hand). Empty `roles` — any track.
- `answers` are answer variants; a variant's `roles` says which track it is for. An answer with no text
  but with `stories` or `facts` is an "anchor": what to answer from, text not written yet.
  The user sets `status: ready`.
- `app_field: whyThem | whyMe` — the answer lives on the application card, not in the bank.
- Behavioral looks up stories by `competency`; a story has `covers: {competency: 1|2}`. A competency
  with questions but no level-2 story is a gap (CRM → «Интервью» → «Истории»).
- Numbers in answers and stories come only from facts. An answer without the user's material behind it
  gets a `[placeholder]` and a question to them, not an invention. Same ban as for facts.
- `applications/<id>/prep.yaml` keeps only per-vacancy decisions: the answer for this vacancy, "asked",
  hidden, Claude's picks. Everything else is matched from the bank on the fly — don't copy bank
  questions there.

## Vacancies

The server does capture and analysis: link → page snapshot (`capture/page.html`, `page.md`, screenshot)
→ `claude -p` with a JSON schema fills the company, requirements, flags, fit (against `icp.yaml`, with
`profile.yaml` → `positioning` and `context` as the candidate description). A second call follows
automatically and picks likely interview questions (`prep.yaml`): up to 12 from the bank and up to 8 of
its own for the vacancy. So every saved vacancy costs two model calls from the user's quota. If the
analysis failed or must be redone — «Переразобрать» on the card; picking — «Подобрать заново» in the
«Подготовка» tab. I can read `capture/page.md` and help with "why them", interview prep, retros
(`02-pipeline/interviews/_TEMPLATE.md`).

## App

Run: `npm --prefix app start` (UI build + server at http://localhost:4317).
Dev: `npm --prefix app run dev` (UI on :5173 with hot reload). Details: `app/README.md`.
Data check: `npm --prefix app run check`. Bank tool: `npm --prefix app run -s bank -- <command>`.

## Language

- **English** for everything that is only for the agent: this file, skills (`.claude/skills/`), agent
  definitions, auto-memory, my own plans and working notes.
- **Russian** for everything the user reads: chat replies (address the user as «ты»), CRM UI strings,
  data fields meant for them (`ru`, `note`, `why`, `angle`, gap `ask`, header comments in data YAML),
  session logs in `00-profile/notes/` (their words verbatim, my questions as asked), commit messages
  (shown in the CRM journal), READMEs.
- Resume and interview content is English: fact `text`, answers, `pitch`, profile `context`.

## Models and quota

Claude usage comes out of the user's subscription quota. Spend the strong model where judgment pays off.

- **Session model** is the user's choice in the model menu; a session cannot switch its own model.
  For long, light sessions (`/fill`, sorting raw material, data upkeep) suggest Sonnet once at the start.
- **Subagents default to Sonnet** (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`). Delegate work
  that is heavy on reading and light on judgment: digesting a long `capture/page.md` or dump into a short
  list, bulk mechanical edits (renames, translations, reformatting) with a check that verifies them,
  sweeping the data for something. Pure lookup → `Explore` or `model: "haiku"`. Pass `model: "opus"`
  only when the subtask itself needs judgment (final answer or letter text).
- **Do short things inline**: a subagent starts with a fresh context and re-reads files, so it only pays
  off when it saves reading.
- **Keep context small**: `bank show / gaps / stats` instead of reading bank YAML whole; `capture/page.md`,
  never `page.html` or screenshots unless needed; read big files by range; `npm --prefix app run -s` (silent).
- **In-app Claude calls** use a model per task (`claudeTask` in `app/src/server/config.ts`: analysis and
  question picking on Sonnet, answer drafts on Opus) and a bare `claude -p` (no tools, MCP, skills,
  CLAUDE.md). Each «Переразобрать» / «Подобрать заново» / «Черновик» is a model call — don't trigger
  them without a reason.
