// Git as a journal: edits from the UI are committed in batches; the home-page journal is built from git log.
// Commits go only into the workspace's own repo, never into a parent repo the workspace happens to sit in.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AUTOCOMMIT, DATA_DIRS, ROOT } from './config';
import { bus } from './store';
import type { JournalEntry } from '../shared/schema';

const run = promisify(execFile);
const git = (...args: string[]) => run('git', args, { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 });
// .native canonicalizes letter case on case-insensitive file systems (macOS), as `git rev-parse` does
const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

/** Data dirs that exist: a missing pathspec makes `git add -A -- <dirs>` abort with exit 128. */
const dataDirs = () => DATA_DIRS.filter((d) => fs.existsSync(path.join(ROOT, d)));

/** Git problems shown to the user (UI and server log), by kind: a fixed problem is cleared, not just added. */
const warnings = new Map<'repo' | 'identity' | 'commit', string>();
export const gitWarnings = () => [...warnings.values()];
function setWarning(kind: 'repo' | 'identity' | 'commit', msg: string | null) {
  if ((warnings.get(kind) ?? null) === msg) return;
  if (msg) { warnings.set(kind, msg); console.warn(`[git] ${msg}`); } else warnings.delete(kind);
  bus.emit('change', { scope: 'system', by: 'system' }); // the UI reloads state and shows or hides the warning
}
const IDENTITY_HINT = 'git config --global user.name "Имя Фамилия" и git config --global user.email "почта"';

export type RepoState = 'ok' | 'none' | 'parent';
let repo: Promise<RepoState> | null = null;
/**
 * 'ok' — ROOT is the toplevel of its own repo; 'none' — not a repo; 'parent' — inside another repo.
 * Only 'ok' is cached: otherwise the next call checks again, so `git init` takes effect without a restart.
 */
export function repoState(): Promise<RepoState> {
  repo ??= git('rev-parse', '--show-toplevel')
    .then(({ stdout }): RepoState => (real(stdout.trim()) === real(ROOT) ? 'ok' : 'parent'))
    .catch((): RepoState => 'none')
    .then((st) => {
      const wasBroken = warnings.has('repo');
      setWarning('repo', st === 'none'
        ? `Рабочее пространство ${ROOT} не git-репозиторий: автокоммитов и журнала не будет. Выполни в этой папке: git init -b main`
        : st === 'parent'
          ? `Рабочее пространство ${ROOT} лежит внутри другого git-репозитория: автокоммиты выключены. Сделай его отдельным репозиторием: git init -b main в этой папке`
          : null);
      if (st === 'ok' && wasBroken && AUTOCOMMIT) void checkIdentity(); // fixed while running: check the rest too
      if (st !== 'ok') repo = null;
      return st;
    });
  return repo;
}

/** Can git commit here? `git var` fails exactly when commit would (no user.name/email, env or usable default). */
async function checkIdentity() {
  const ok = await Promise.all([git('var', 'GIT_AUTHOR_IDENT'), git('var', 'GIT_COMMITTER_IDENT')]).then(() => true, () => false);
  setWarning('identity', ok ? null : `В git не заданы имя и почта, автокоммиты не пройдут. Выполни: ${IDENTITY_HINT}`);
}

/** Startup check: is the workspace its own repo, is a commit identity set. */
export async function checkRepo(): Promise<string[]> {
  if ((await repoState()) === 'ok' && AUTOCOMMIT) await checkIdentity();
  return gitWarnings();
}

let pending: string[] = [];
let timer: NodeJS.Timeout | null = null;

export function queueCommit(message: string) {
  if (!AUTOCOMMIT) return;
  pending.push(message);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 4000);
}

async function flush() {
  timer = null;
  const msgs = [...new Set(pending)];
  pending = [];
  if (!msgs.length || (await repoState()) !== 'ok') return;
  const dirs = dataDirs();
  if (!dirs.length) return;
  try {
    // Pathspec on every step: changes staged elsewhere in the workspace (CLAUDE.md, .claude/ — the agent's)
    // stay staged and out of a commit labeled crm-ui (`commit -- <paths>` commits only those paths).
    await git('add', '-A', '--', ...dirs);
    const { stdout } = await git('diff', '--cached', '--name-only', '--', ...dirs);
    if (!stdout.trim()) return;
    const subject = msgs.length === 1 ? `crm: ${msgs[0]}` : `crm: ${msgs[0]} (+${msgs.length - 1})`;
    const body = msgs.length > 1 ? msgs.map((m) => `- ${m}`).join('\n') + '\n\n' : '';
    await git('commit', '-q', '-m', subject, '-m', `${body}Agent: crm-ui`, '--', ...dirs);
    setWarning('commit', null);
    setWarning('identity', null);
  } catch (e) {
    const err = e as Error & { stderr?: string };
    const why = (err.stderr || err.message).trim();
    if (/user\.name|user\.email|identity|who you are/i.test(why)) setWarning('identity', `Автокоммит не прошёл: в git не заданы имя и почта. Выполни: ${IDENTITY_HINT}`);
    else setWarning('commit', `Автокоммит не прошёл: ${why.split('\n')[0].slice(0, 200)}`);
  }
}

export async function journal(limit = 40): Promise<JournalEntry[]> {
  const dirs = dataDirs();
  if (!dirs.length || (await repoState()) !== 'ok') return [];
  if (warnings.has('identity')) void checkIdentity(); // the user may have set it since: the warning goes away
  try {
    const { stdout } = await git('log', `-n${limit}`, '--date=iso-strict', '--pretty=format:%h%x1f%ad%x1f%s%x1f%b%x1e', '--', ...dirs);
    return stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
      const [hash, date, subject, body = ''] = rec.split('\x1f');
      const agent = /Agent:\s*claude/i.test(body) ? 'claude' : /Agent:\s*crm-ui/i.test(body) ? 'ui' : 'other';
      return { hash, date, subject: subject.replace(/^crm:\s*/, ''), agent } as JournalEntry;
    });
  } catch {
    return [];
  }
}

/** Uncommitted changes in the data made outside the UI (usually by the agent). */
export async function dirtyFiles(): Promise<string[]> {
  const dirs = dataDirs();
  if (!dirs.length || (await repoState()) !== 'ok') return [];
  try {
    const { stdout } = await git('status', '--porcelain', '--', ...dirs);
    return stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
  } catch { return []; }
}
