import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The app checkout (real path: Node resolves the entry module through a workspace's app/ symlink). */
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A CRM_ROOT from the real environment is read before APP_DIR/.env is loaded: it outranks the workspace the
// command was started in, while the CRM_ROOT line that setup writes to .env does not (see resolveRoot).
const ENV_ROOT = process.env.CRM_ROOT?.trim() || '';

// APP_DIR/.env is written by `npm run setup` (CRM_ROOT, optionally CRM_PORT etc.). Real env vars win.
// Loaded before anything below reads process.env.
export const ENV_FILE = path.join(APP_DIR, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isWorkspace = (p: string) => isDir(path.join(p, '00-profile'));
// .native canonicalizes letter case on case-insensitive file systems (macOS), like git does
const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const inside = (child: string, parent: string) => {
  const rel = path.relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function noWorkspace(reason: string): never {
  console.error(`${reason}

Рабочее пространство Job CRM — папка с твоими данными (00-profile/, 02-pipeline/, 04-resume/).
Создай его командой в папке приложения (${APP_DIR}):

  npm run setup -- <папка> [--name "Ivan Petrov"]

Или укажи путь к готовому рабочему пространству в CRM_ROOT:
переменной окружения или строкой CRM_ROOT=<путь> в файле ${ENV_FILE}`);
  process.exit(1);
}

function checked(p: string, what: string): string {
  if (!isDir(p)) noWorkspace(`${what} указывает на ${p}, но такой папки нет.`);
  if (!isWorkspace(p)) noWorkspace(`${what} указывает на ${p}, но там нет 00-profile/: это не рабочее пространство.`);
  return p;
}

/**
 * Workspace root, in order:
 * 1. CRM_ROOT from the real environment (relative → against the folder npm was started from);
 * 2. the folder npm was started from (INIT_CWD), if it is a workspace outside this checkout — so
 *    `npm --prefix app …` inside a workspace always works on that workspace, even when .env names another;
 * 3. CRM_ROOT from APP_DIR/.env (relative → against APP_DIR) — `npm start` in the app checkout;
 * 4. APP_DIR/.. when app/ is a physical folder inside the workspace (legacy layout).
 * Nothing found → a hint about `npm run setup` and exit(1).
 */
function resolveRoot(): string {
  const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : '';
  const startedIn = initCwd && isWorkspace(initCwd) && !inside(initCwd, APP_DIR) ? initCwd : '';
  if (ENV_ROOT) {
    const p = checked(path.resolve(initCwd || process.cwd(), ENV_ROOT), 'CRM_ROOT');
    if (startedIn && real(startedIn) !== real(p)) {
      console.warn(`Внимание: команда запущена в рабочем пространстве ${startedIn}, но переменная окружения CRM_ROOT указывает на ${p}. Работаю с ${p}.`);
    }
    return p;
  }
  if (startedIn) return startedIn;
  const fromFile = process.env.CRM_ROOT?.trim();
  if (fromFile) return checked(path.resolve(APP_DIR, fromFile), `CRM_ROOT в ${ENV_FILE}`);
  const parent = path.resolve(APP_DIR, '..');
  if (isWorkspace(parent)) return parent;
  noWorkspace('Не найдено рабочее пространство Job CRM.');
}

/** Root of the workspace (the user's data repo); see resolveRoot for the order. */
export const ROOT = resolveRoot();
export const PORT = Number(process.env.CRM_PORT || 4317);
export const ORIGIN = `http://localhost:${PORT}`;

export const P = {
  profile: path.join(ROOT, '00-profile/profile.yaml'),
  icp: path.join(ROOT, '00-profile/icp.yaml'),
  summaries: path.join(ROOT, '00-profile/summaries.yaml'),
  facts: path.join(ROOT, '00-profile/facts'),
  questions: path.join(ROOT, '00-profile/questions'),
  stories: path.join(ROOT, '00-profile/stories.yaml'),
  strengths: path.join(ROOT, '00-profile/strengths.yaml'),
  notes: path.join(ROOT, '00-profile/notes'),
  recipes: path.join(ROOT, '04-resume/recipes'),
  build: path.join(ROOT, '04-resume/build'),
  companies: path.join(ROOT, '02-pipeline/companies'),
  apps: path.join(ROOT, '02-pipeline/applications'),
};

/** Directories the server watches and commits. */
export const DATA_DIRS = ['00-profile', '02-pipeline', '04-resume'];

/** Absolute path of the browser extension folder (shown in the UI for «Загрузить распакованное»). */
export const EXTENSION_DIR = path.join(APP_DIR, 'extension');

export const CLAUDE_BIN = process.env.CRM_CLAUDE_BIN || 'claude';

export type ClaudeTask = 'analyze' | 'prep' | 'draft';
/**
 * Model and effort per in-app Claude task, to spend the subscription quota where quality pays off.
 * Extraction and picking go to Sonnet; an answer draft is text the user will say aloud, so Opus.
 * Override: CRM_MODEL_<TASK> / CRM_EFFORT_<TASK>, or CRM_CLAUDE_MODEL for every task.
 */
const TASK_DEFAULTS: Record<ClaudeTask, { model: string; effort: string }> = {
  analyze: { model: 'sonnet', effort: 'low' },
  prep: { model: 'sonnet', effort: 'medium' },
  draft: { model: 'opus', effort: 'medium' },
};
export function claudeTask(task: ClaudeTask) {
  const key = task.toUpperCase();
  return {
    model: process.env[`CRM_MODEL_${key}`] || process.env.CRM_CLAUDE_MODEL || TASK_DEFAULTS[task].model,
    effort: process.env[`CRM_EFFORT_${key}`] || TASK_DEFAULTS[task].effort,
  };
}
export const AUTOCOMMIT = process.env.CRM_AUTOCOMMIT !== '0';
