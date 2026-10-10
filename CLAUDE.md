# Job CRM — rules for working on the code

This repo is the app only: a local job-search CRM (Hono server + React UI + headless Claude Code calls)
that runs at http://localhost:4317 and reads/writes a user's **workspace** — a separate folder, its own
git repo, with `00-profile/`, `02-pipeline/`, `04-resume/`, plus `CLAUDE.md` and `.claude/` for Claude
Code there. The repo is shared with other people; it holds no personal data.

Inside a workspace this repo is reachable as `app/` (a symlink created by `npm run setup`). If you were
started in a workspace and edit the app through `app/`, the app's git is a different repo: commit with
`git -C app …`, never with the workspace's git (and the reverse: workspace data never goes into this repo).

## Layout

| Path | What |
|---|---|
| `src/server/` | Hono server (`index.ts`), file store and single mutation queue (`store.ts`, `fsio.ts`), file watcher → SSE (`watch.ts`), capture (`capture/`: ATS APIs, Chromium, Readability), Claude calls (`claude.ts`, `analyze.ts`, `prep.ts`), PDF (`pdf.ts`), git autocommit and journal (`git.ts`), data check (`validate.ts`, `check.ts`), `TODO` lines in `00-profile/*.md` as fill gaps (`docs.ts`), agent CLI (`bank.ts`), workspace creation (`setup.ts`) |
| `src/server/config.ts` | Data root resolution, paths, port, per-task Claude models (`claudeTask`) |
| `src/shared/` | Code used by both server and UI: zod schemas and types (`schema.ts`), recipe → resume (`resume.ts`), resume HTML (`template.ts` — unrelated to `template/`), gates and fit (`pipeline.ts`), interview matching (`interview.ts`), fill queue (`gaps.ts`) |
| `src/web/` | React UI, hash routes (`router.ts`), state from `/api/state` + SSE (`store.ts`) |
| `extension/` | Chrome MV3 extension "save vacancy"; posts to `http://localhost:<port>/api/capture`, port set in the popup (default 4317, kept in the extension's localStorage). `host_permissions: http://localhost/*` — per Chrome's match-pattern docs a pattern without a port matches every port |
| `template/` | Starter workspace copied by `npm run setup` |

### template/ naming trick

Agent and git files in `template/` are stored under safe names: `_CLAUDE.md`, `_claude/`, `_gitignore`.
`setup.ts` renames them to `CLAUDE.md`, `.claude/`, `.gitignore`; everything else is copied 1:1.
Reason: a real `template/CLAUDE.md` or `template/.claude/` would be loaded by Claude Code working in
this repo (workspace rules and skills like `/fill` would leak into dev sessions), and a real
`template/.gitignore` would apply its ignore rules to this repo's tree.

### Data root

`config.ts` reads `CRM_ROOT` from the real environment first, then loads `APP_DIR/.env` with
`process.loadEnvFile` if it exists (real env vars win), then resolves the root in this order:
1. `CRM_ROOT` from the real environment (relative → against `INIT_CWD`);
2. `INIT_CWD` (the folder npm was started from, e.g. `npm --prefix app …` inside a workspace) if it
   contains `00-profile/` and is not inside this repo — so a command run in a workspace never reads or
   writes another one, whatever `.env` says;
3. `CRM_ROOT` from `.env` (relative → against `APP_DIR`) — `npm start` in this repo;
4. `APP_DIR/..` if it contains `00-profile/` (legacy layout: app as a subfolder of the data);
5. else a Russian message pointing to `npm run setup` and `exit(1)`.
A `CRM_ROOT` naming a missing folder or one without `00-profile/` → Russian error, `exit(1)`. When the
env `CRM_ROOT` beats a different `INIT_CWD` workspace, it warns. Since Node resolves the symlink,
`APP_DIR` is this repo's real path. Path comparisons use `fs.realpathSync.native` (canonical letter case
on macOS, like git). `setup.ts` must not import `config.ts` (config exits when no workspace is configured).

### Server boundary

The server listens on `127.0.0.1` only. `index.ts` rejects every request whose `Host` is not
`localhost|127.0.0.1|[::1][:port]` (DNS rebinding: a foreign domain resolving to 127.0.0.1 could read
GET `/api/state`), and non-GET `/api/*` requests whose `Origin` is not `http://localhost|127.0.0.1[:port]`
or `chrome-extension://…` (CSRF: a foreign page could otherwise start a capture and spend the user's
quota); `/api/capture` answers CORS for the extension origin only. Keep all three when adding routes or
changing the extension.

## Commands

```bash
npm run typecheck                        # tsc --noEmit
npm run check:template                   # template/ must be a valid workspace (check.ts --template)
npm run build                            # vite build → dist/web
npm run dev                              # UI on :5173 (proxies /api to 127.0.0.1:$CRM_PORT, env or .env, default 4317) + server with reload
npm run serve                            # server only, serves the last build
npm start                                # build + server
npm run setup -- <dir> [--name "…"] [--no-env] [--template <dir>]   # new workspace from template/
npm run setup -- --link <dir> [--no-env]                            # connect an existing workspace
npm run check                            # data check of the configured workspace
npm run -s bank -- gaps|stats|show|apply|ops   # agent CLI over the configured workspace
```

Run `npm run typecheck` and `npm run check:template` before every commit.

## Hard rules

1. **No personal data, ever**, in code, prompts, UI strings, `template/`, tests, fixtures or commit
   messages: no real names, employers, numbers, contacts, locations, applications. The human is "the
   user" in code and «ты» / «владелец профиля» in the UI; the brand is "Job CRM". Candidate details in
   prompts come only from the workspace (`profile.positioning`, `profile.context`, ICP, banks,
   `positioning.md`, the optional `00-profile/legal-and-location.md` for logistics drafts); when a
   field or file is empty, omit the line — no default persona.
2. **Never mutate a real workspace while testing.** Test UI/API mutations, `bank apply`, capture and
   setup on a scratch workspace:
   - `npm run setup -- <tmp dir> --no-env` — creates the workspace but leaves this repo's `.env`
     alone and prints the `CRM_ROOT=…` line to use instead (without `--no-env` setup rewrites
     `CRM_ROOT` in `.env`, warning with the old value);
   - run against a copy without touching `.env`:
     `CRM_ROOT=<copy> CRM_PORT=4400 CRM_AUTOCOMMIT=0 npm run serve` (or `npm start`). `npm run dev`
     also works on another port — its proxy follows `CRM_PORT` — but Vite itself takes :5173 or the
     next free port, so open the URL it prints.
   Kill any server you start. Read-only commands (`check`, `bank gaps/stats/show`, `bank apply --dry`)
   are fine against the configured workspace. Commands run inside a workspace (`npm --prefix app …`
   there) act on that workspace, so in a scratch workspace they are safe without touching `.env`.
3. **`template/` must pass `npm run check:template`.** It contains only neutral, obviously fictional
   or empty examples. Every template data file the store rewrites on save (`profile.yaml`, `icp.yaml`,
   `summaries.yaml`, `stories.yaml`, `strengths.yaml`, `questions/*.yaml`, `recipes/*.yaml`) carries
   exactly the header and body layout `store.ts` writes, so the first save from the CRM is not a diff.
   Field explanations go to `template/README.md` / `template/_CLAUDE.md`, not YAML comments. When you
   change a header in `store.ts`, change the template file too.
4. **Keep the template's agent files in sync with features.** `template/_CLAUDE.md` describes the data
   layout and the agent's rules in a workspace; `template/_claude/skills/` holds `/fill` and other
   skills. When you change a file format, a `bank` op, a gate, a status rule or a command, update them
   in the same change. Existing workspaces are not migrated automatically: if a change needs
   migration, say so in the commit message and the README.
5. **In-app Claude calls spend the user's subscription quota.** Models per task are set in
   `claudeTask` (`config.ts`): analysis and question picking on Sonnet, answer drafts on Opus. Calls are
   lean (`claude.ts`: no tools, MCP, skills, CLAUDE.md, system prompt; stable data in the system prompt
   so it hits the prompt cache). Keep them lean, don't add calls on page load or in loops, and don't
   trigger analysis/prep/draft while testing unless the test needs a real model answer.
6. **Prompts treat page text as untrusted data**, and Claude must never invent facts or numbers: new
   facts and stories are drafts with a `source`; `verified`/`ready` are set only by the user in the UI
   (`bank apply` rejects them).
7. **One commit per logical change**, message in Russian. Do not commit `.env`, `dist/`,
   `node_modules/`.
8. **Dependencies:** don't pull versions published less than about two weeks ago. Known: `npm audit`
   reports shell-quote (GHSA-pqg4-j6r4-53mv) via `concurrently` 10.0.5, a dev-only dependency of
   `npm run dev`; every shell-quote before 1.11 has an advisory, so bump `concurrently` to ≥ 10.0.6
   once that release is a couple of weeks old.

## Language

- **Russian**: UI strings, CLI messages for the user, README, header comments written into data
  files, commit messages. Address the user as «ты».
- **English**: code comments, prompts and JSON-schema descriptions sent to Claude, this file,
  `template/_CLAUDE.md`, skills, agent definitions.
- Resume and interview content (fact `text`, answers, pitches) is English; analysis output shown to
  the user (summaries, flags, why-points) is Russian, as the prompts request.
