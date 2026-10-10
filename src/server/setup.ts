// Creates a workspace (the user's data folder, its own git repo) from template/, or connects an existing one.
//   npm run setup -- <dir> [--name "Ivan Petrov"] [--no-env]   new workspace from the template
//   npm run setup -- --link <dir> [--no-env]                    existing workspace (e.g. cloned from the user's remote)
//   --template <dir>   copy another template (development); --no-env   leave APP_DIR/.env alone and print the
//   CRM_ROOT line instead (development: test setup without repointing the developer's own CRM)
// Steps: copy template/ (agent files are stored under safe names: _CLAUDE.md, _claude/, _gitignore),
// set the profile name, symlink <dir>/app → this checkout, CRM_ROOT=<dir> in APP_DIR/.env, git init + commit.
// Must not import config.ts: config exits when no workspace is configured yet.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import YAML from 'yaml';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(APP_DIR, '.env');
/** Template entries stored under names Claude Code in the app repo does not pick up. */
const RENAME: Record<string, string> = { '_CLAUDE.md': 'CLAUDE.md', _claude: '.claude', _gitignore: '.gitignore' };
const SKIP = new Set(['.DS_Store']);

const USAGE = `Создать рабочее пространство Job CRM (папку с твоими данными, отдельный git-репозиторий):

  npm run setup -- <папка> [--name "Ivan Petrov"]

Подключить уже существующее рабочее пространство (например, склонированное из твоего git):

  npm run setup -- --link <папка>

<папка> — путь относительно того места, где ты запускаешь команду. Для новой папки она должна быть пустой или не существовать.

--name "…"    имя так, как оно будет в шапке резюме (латиницей, если резюме на английском)
--no-env      не записывать CRM_ROOT в .env приложения, а только показать строку для запуска
              (чтобы попробовать setup, не переключая свою CRM на новую папку)
--template <папка>   взять другой шаблон вместо template/ (для разработки)`;

const argv = process.argv.slice(2);
const flagValue = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`После --${name} нужно значение.\n\n${USAGE}`);
  return v;
};

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
const warnings: string[] = [];
const warn = (msg: string) => { warnings.push(msg); console.warn(`Внимание: ${msg}`); };

// npm runs scripts in the app dir; a relative path is meant relative to where the command was typed.
const BASE = process.env.INIT_CWD || process.cwd();
const abs = (p: string) => path.resolve(BASE, p);
/**
 * Real path, also for a path that does not exist yet (resolved through its nearest existing parent). .native
 * canonicalizes letter case on case-insensitive file systems (macOS), so ~/documents and ~/Documents compare equal.
 */
const real = (p: string): string => {
  const r = path.resolve(p);
  try { return fs.realpathSync.native(r); } catch { /* not there yet */ }
  const parent = path.dirname(r);
  return parent === r ? r : path.join(real(parent), path.basename(r));
};
const inside = (child: string, parent: string) => {
  const rel = path.relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// ---------- template copy ----------
function copyTemplate(src: string, dest: string) {
  for (const name of fs.readdirSync(src)) {
    if (SKIP.has(name)) continue;
    fs.cpSync(path.join(src, name), path.join(dest, RENAME[name] ?? name), {
      recursive: true,
      filter: (p) => !SKIP.has(path.basename(p)),
    });
  }
}

/**
 * Sets `name` in 00-profile/profile.yaml through the Document API, so the header comment stays. A new key goes
 * first (schema order) and the output options match fsio.yamlString, so the first save from the CRM changes nothing.
 */
function setProfileName(dir: string, name: string) {
  const file = path.join(dir, '00-profile/profile.yaml');
  const doc = fs.existsSync(file) ? YAML.parseDocument(fs.readFileSync(file, 'utf8')) : new YAML.Document({});
  if (doc.errors.length) { warn(`не удалось разобрать ${file}: имя не записано, впиши его в CRM («Банк фактов» → «Профиль»).`); return; }
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  if (doc.has('name')) doc.set('name', name);
  else (doc.contents as YAML.YAMLMap).items.unshift(doc.createPair('name', name));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, doc.toString({ lineWidth: 0, indentSeq: true, flowCollectionPadding: false }));
}

/** The workspace .gitignore must exclude the app symlink, or `git add -A` commits it. */
function ensureIgnoreApp(dir: string) {
  const file = path.join(dir, '.gitignore');
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur.split(/\r?\n/).some((l) => ['/app', 'app', '/app/', 'app/'].includes(l.trim()))) return;
  fs.writeFileSync(file, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# Код Job CRM: симлинк на репозиторий приложения\n/app\n`);
}

// ---------- app link ----------
function linkApp(dir: string) {
  const link = path.join(dir, 'app');
  let st: fs.Stats | undefined;
  try { st = fs.lstatSync(link); } catch { /* absent */ }
  if (st?.isSymbolicLink()) {
    if (real(link) === real(APP_DIR)) return 'уже на месте';
    fs.unlinkSync(link);
    fs.symlinkSync(APP_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');
    return 'перенаправлена на эту копию приложения';
  }
  if (st) {
    warn(`${link} уже существует и это не ссылка. Ссылку app не создал; убери или переименуй эту папку и запусти setup -- --link ещё раз.`);
    return 'не создана';
  }
  fs.symlinkSync(APP_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');
  return 'создана';
}

// ---------- APP_DIR/.env ----------
/**
 * A value quoted for Node's .env parser, which has no escapes: single quotes keep the text verbatim, backticks
 * cover a path with an apostrophe (double quotes would expand \n inside a Windows path). Checked by parsing back.
 */
function envQuote(v: string): string | null {
  const q = !v.includes("'") ? `'${v}'` : !v.includes('`') ? `\`${v}\`` : '';
  return q && parseEnv(`CRM_ROOT=${q}`).CRM_ROOT === v ? q : null;
}
/** The CRM_ROOT line for .env; fails (before anything is written, when called early) if the path can't go there. */
function envLine(dir: string): string {
  const q = envQuote(dir);
  if (!q) fail(`Путь ${dir} нельзя записать в .env (в нём одновременно есть ' и \`). Выбери папку с более простым именем.`);
  return `CRM_ROOT=${q}`;
}

function readEnv(): { text: string; vars: Record<string, string> } {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  let vars: Record<string, string> = {};
  try { vars = parseEnv(text) as Record<string, string>; } catch { /* unparsable: treat as empty */ }
  return { text, vars };
}

/** Shell-quoted path for a command line the user copies. */
const shQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** CRM_ROOT=<dir> into APP_DIR/.env, or with --no-env only the line to use instead. Returns the summary line. */
function configureRoot(dir: string): string {
  if (!noEnv) return (writeEnvRoot(dir), `  CRM_ROOT записан в ${ENV_FILE}`);
  const { vars } = readEnv();
  return `  .env не тронут (--no-env)${vars.CRM_ROOT ? `: npm start в папке приложения по-прежнему открывает ${vars.CRM_ROOT}` : ''}.
  Команды из этой папки (npm --prefix app …) работают с ней самой. Открыть её из папки приложения:
    CRM_ROOT=${shQuote(dir)} npm start${envQuote(dir) ? `
  или строкой в ${ENV_FILE}:
    CRM_ROOT=${envQuote(dir)}` : ''}`;
}

/** Writes CRM_ROOT=<dir> into APP_DIR/.env, keeping every other line. */
function writeEnvRoot(dir: string) {
  const { text, vars } = readEnv();
  const prev = vars.CRM_ROOT; // the last CRM_ROOT line wins in Node's parser: this is the folder the CRM opened
  const line = envLine(dir);
  if (prev && real(path.resolve(APP_DIR, prev)) !== real(dir)) {
    warn(`CRM_ROOT в ${ENV_FILE} указывал на ${prev}, теперь указывает на ${dir}: npm start в папке приложения открывает новое рабочее пространство. Прежнее не тронуто, и команды npm --prefix app …, запущенные в нём самом, по-прежнему работают с ним.`);
  }
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.at(-1) === '') lines.pop();
  const isRoot = (l: string) => /^\s*(export\s+)?CRM_ROOT\s*=/.test(l);
  const i = lines.findIndex(isRoot);
  if (i >= 0) {
    // replace the first CRM_ROOT line in place and drop the rest, or a later duplicate would still win
    lines[i] = line;
    for (let j = lines.length - 1; j > i; j--) if (isRoot(lines[j])) lines.splice(j, 1);
  } else {
    if (!lines.length) lines.push('# Настройки Job CRM для этой копии приложения. Пишет npm run setup; правь при необходимости.');
    lines.push(line);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
  if (process.env.CRM_ROOT && real(abs(process.env.CRM_ROOT)) !== real(dir)) {
    warn(`в окружении задана переменная CRM_ROOT=${process.env.CRM_ROOT}: она важнее .env и папки, из которой запущена команда. Убери её, иначе CRM откроет другую папку.`);
  }
}

// ---------- git ----------
function git(dir: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/** Can git commit here? `git var` fails exactly when commit would (no user.name/email, env or usable default). */
const hasIdentity = (dir: string) => { try { git(dir, 'var', 'GIT_AUTHOR_IDENT'); git(dir, 'var', 'GIT_COMMITTER_IDENT'); return true; } catch { return false; } };

/** git init + initial commit. Returns a line for the summary. */
function initRepo(dir: string): string {
  try { git(dir, '--version'); } catch {
    warn('git не найден: рабочее пространство создано без репозитория. Установи git и выполни в папке: git init -b main && git add -A && git commit -m "Рабочее пространство"');
    return 'git не найден';
  }
  const why = (e: unknown) => { const err = e as Error & { stderr?: string }; return (err.stderr || err.message).trim().split('\n')[0]; };
  try { git(dir, 'init', '-q', '-b', 'main'); } catch {
    try {
      git(dir, 'init', '-q'); // git < 2.28 has no -b
      git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    } catch (e) {
      warn(`git init не прошёл: ${why(e)}. Рабочее пространство создано без репозитория: выполни в папке git init -b main && git add -A && git commit -m "Рабочее пространство"`);
      return 'репозиторий не создан';
    }
  }
  if (!hasIdentity(dir)) {
    warn(`в git не заданы имя и почта, поэтому первый коммит не сделан. Выполни:
    git config --global user.name "Имя Фамилия"
    git config --global user.email "почта"
    git -C "${dir}" add -A && git -C "${dir}" commit -m "Рабочее пространство Job CRM"`);
    return 'репозиторий создан, без коммита';
  }
  try {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Рабочее пространство Job CRM: создано из шаблона');
    return 'репозиторий создан, первый коммит сделан';
  } catch (e) {
    warn(`первый коммит не прошёл: ${why(e)}. Сделай его вручную: git -C "${dir}" add -A && git -C "${dir}" commit -m "Рабочее пространство Job CRM"`);
    return 'репозиторий создан, без коммита';
  }
}

// ---------- environment hints ----------
async function chromiumMissing(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return !fs.existsSync(chromium.executablePath());
  } catch { return true; }
}
function claudeMissing(): boolean {
  // on Windows `claude` is a .cmd shim, which execFile finds only through a shell
  const opts = { stdio: 'ignore' as const, timeout: 15_000, shell: process.platform === 'win32' };
  try { execFileSync(process.env.CRM_CLAUDE_BIN || 'claude', ['--version'], opts); return false; } catch { return true; }
}

async function nextSteps(dir: string, isNew: boolean) {
  const port = process.env.CRM_PORT || readEnv().vars.CRM_PORT || '4317';
  // run inside the workspace, npm --prefix app … finds it by INIT_CWD, with or without CRM_ROOT in .env
  const steps = [`cd "${dir}"`, `npm --prefix app start          — CRM откроется на http://localhost:${port}; оставь этот терминал открытым, Claude Code запускай в другом`];
  if (await chromiumMissing()) steps.push(`npx playwright install chromium — один раз, в папке приложения (${APP_DIR}): браузер для сохранения вакансий и PDF`);
  if (claudeMissing()) steps.push('Установи Claude Code и войди: claude auth login — без него не будет разбора вакансий и подготовки к интервью');
  if (isNew) {
    steps.push('В CRM: «Банк фактов» → «Профиль» — имя, контакты, позиционирование и контекст поиска; там же «Критерии ICP»');
    steps.push('Открой Claude Code в этой папке и набери /fill — сессия наполнения банка фактов и историй');
    steps.push('Данные лежат в своём git-репозитории: можно хранить их в приватном репозитории (git remote add origin <url> && git push -u origin main)');
  } else {
    steps.push('Проверка данных: npm --prefix app run check');
  }
  console.log(`\nДальше:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
  if (warnings.length) console.log(`\nПредупреждений: ${warnings.length} — см. выше.`);
}

// ---------- main ----------
async function create(target: string, name: string | undefined, templateDir: string) {
  const dir = abs(target);
  if (!fs.existsSync(path.join(templateDir, '00-profile'))) fail(`Не найден шаблон рабочего пространства: ${templateDir}`);
  if (inside(dir, APP_DIR)) fail(`Рабочее пространство нельзя создавать внутри папки приложения (${APP_DIR}). Выбери папку рядом, например ../my-job-search.`);
  if (!noEnv) envLine(dir); // fails before anything is written if the path cannot go into .env
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) fail(`${dir} — это файл, а не папка.`);
    const entries = fs.readdirSync(dir).filter((f) => !SKIP.has(f));
    if (entries.length) fail(`Папка ${dir} не пустая (${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', …' : ''}). Укажи новую или пустую папку.\nПодключить готовое рабочее пространство: npm run setup -- --link "${dir}"`);
  }
  fs.mkdirSync(dir, { recursive: true });
  copyTemplate(templateDir, dir);
  ensureIgnoreApp(dir);
  if (name?.trim()) setProfileName(dir, name.trim());
  console.log(`Рабочее пространство: ${dir}`);
  console.log(`  шаблон скопирован${name?.trim() ? `, имя в профиле: ${name.trim()}` : ''}`);
  console.log(`  ссылка app → ${APP_DIR}: ${linkApp(dir)}`);
  console.log(configureRoot(dir));
  console.log(`  git: ${initRepo(dir)}`);
  await nextSteps(dir, true);
}

async function link(target: string) {
  const dir = abs(target);
  if (!fs.existsSync(path.join(dir, '00-profile'))) fail(`В ${dir} нет 00-profile/: это не рабочее пространство Job CRM.\nСоздать новое: npm run setup -- <папка>`);
  if (inside(dir, APP_DIR)) fail(`Рабочее пространство не должно лежать внутри папки приложения (${APP_DIR}).`);
  if (!noEnv) envLine(dir);
  console.log(`Рабочее пространство: ${dir}`);
  console.log(`  ссылка app → ${APP_DIR}: ${linkApp(dir)}`);
  console.log(configureRoot(dir));
  const gi = fs.existsSync(path.join(dir, '.gitignore')) ? fs.readFileSync(path.join(dir, '.gitignore'), 'utf8') : '';
  if (!gi.split(/\r?\n/).some((l) => ['/app', 'app', '/app/', 'app/'].includes(l.trim()))) {
    warn('в .gitignore рабочего пространства нет строки /app: добавь её, иначе ссылка на приложение попадёт в коммит.');
  }
  if (!fs.existsSync(path.join(dir, '.git'))) warn(`${dir} не git-репозиторий: автокоммитов и журнала не будет. Выполни в папке: git init -b main`);
  await nextSteps(dir, false);
}

const VALUE_FLAGS = ['--name', '--link', '--template'];
const BOOL_FLAGS = ['--no-env', '--help'];
const linkTarget = flagValue('link');
const name = flagValue('name');
const templateDir = path.resolve(BASE, flagValue('template') ?? path.join(APP_DIR, 'template')); // --template: for development
const noEnv = argv.includes('--no-env'); // development: do not repoint this checkout's .env
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1] ?? ''));
const unknown = argv.filter((a) => a.startsWith('--') && !VALUE_FLAGS.includes(a) && !BOOL_FLAGS.includes(a));

if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
if (unknown.length) fail(`Неизвестный параметр: ${unknown.join(', ')}\n\n${USAGE}`);
if (linkTarget !== undefined) {
  if (positional.length || name) fail(`С --link указывается только папка.\n\n${USAGE}`);
  await link(linkTarget);
} else {
  if (positional.length !== 1) fail(positional.length ? `Нужна одна папка, а указано: ${positional.join(', ')}\n\n${USAGE}` : USAGE);
  await create(positional[0], name, templateDir);
}
