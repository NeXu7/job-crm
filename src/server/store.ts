// In-memory store on top of the files. Reads everything at startup, re-reads on watcher events,
// writes changes back to YAML/Markdown. All mutations go through a single queue.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { P, ROOT } from './config';
import {
  buildSections, compact, exists, parseFrontmatter, parseSections, readText, readYaml, removeFile,
  serializeFrontmatter, writeAtomic, writeYaml,
} from './fsio';
import {
  ApplicationMetaSchema, CompanySchema, FactFileSchema, FactSchema, IcpSchema, LockSchema, ProfileSchema,
  RecipeSchema, SummariesFileSchema, ExperienceSchema, STAGE_NAMES, CATEGORY_IDS, PrepSchema, PrepItemSchema,
  QuestionFileSchema, QuestionSchema, StoriesFileSchema, StorySchema, prepKey,
  StrengthsFileSchema, StrengthSchema, WeaknessSchema, NoteMetaSchema,
  type Strength, type Weakness, type Note,
  type Application, type ApplicationMeta, type Company, type Experience, type Fact, type FactData, type Icp,
  type Lock, type Prep, type PrepItem, type Profile, type Question, type QuestionCategory, type QuestionData,
  type Recipe, type Stage, type Story, type Summary, type TimelineEntry,
} from '../shared/schema';
import { isEmptyItem } from '../shared/interview';
import { canonical, cloneRecipe, diffRecipe, diffText, resolveRecipe } from '../shared/resume';
import { gateFor, maxStage, slugify, today } from '../shared/pipeline';

export type ChangeEvent = { scope: string; id?: string; by: 'ui' | 'external' | 'system'; message?: string };
export const bus = new EventEmitter();

type DB = {
  profile: Profile;
  icp: Icp;
  summaries: Summary[];
  experiences: Experience[];
  facts: Fact[];
  recipes: Recipe[];
  companies: Company[];
  questions: Question[];
  stories: Story[];
  strengths: Strength[];
  weaknesses: Weakness[];
  notes: Note[];
  apps: Map<string, Application>;
  errors: { file: string; message: string }[];
};

export const db: DB = {
  profile: ProfileSchema.parse({}),
  icp: IcpSchema.parse({}),
  summaries: [], experiences: [], facts: [], recipes: [], companies: [], questions: [], stories: [], strengths: [], weaknesses: [], notes: [],
  apps: new Map(), errors: [],
};

/** Readable zod issues for the UI and `npm run check`: `experience.org — обязательное поле; …`. */
export function formatZod(e: z.ZodError): string {
  return e.issues.map((i) => {
    const where = i.path.length ? i.path.join('.') : 'файл';
    const received = i.code === 'invalid_type' ? /received (\w+)/.exec(i.message)?.[1] : undefined;
    const what = received === 'undefined' ? 'обязательное поле'
      : !i.path.length && received === 'null' ? 'пустой файл (нужен YAML-объект)'
      : i.code === 'too_small' && i.origin === 'string' ? 'не может быть пустым'
      : i.message;
    return `${where} — ${what}`;
  }).join('; ');
}

const rel = (p: string) => path.relative(ROOT, p);
const fail = (file: string, e: unknown) => {
  const message = e instanceof z.ZodError ? formatZod(e) : e instanceof Error ? e.message : String(e);
  db.errors = db.errors.filter((x) => x.file !== rel(file)).concat({ file: rel(file), message });
  console.warn(`[store] ${rel(file)}: ${message}`);
};
const ok = (file: string) => { db.errors = db.errors.filter((x) => x.file !== rel(file)); };

// ---------- mutation queue ----------
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function changed(ev: ChangeEvent) {
  bus.emit('change', ev);
}

export class UserError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

// ---------- loading ----------
async function listYaml(dir: string) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml') && !f.startsWith('_')).map((f) => path.join(dir, f));
  } catch { return []; }
}

export async function loadProfile() {
  try { db.profile = ProfileSchema.parse((await readYaml(P.profile)) ?? {}); ok(P.profile); } catch (e) { if (await exists(P.profile)) fail(P.profile, e); }
}
export async function loadIcp() {
  try { db.icp = IcpSchema.parse((await readYaml(P.icp)) ?? {}); ok(P.icp); } catch (e) { if (await exists(P.icp)) fail(P.icp, e); }
}
export async function loadSummaries() {
  try { db.summaries = SummariesFileSchema.parse((await readYaml(P.summaries)) ?? {}).summaries; ok(P.summaries); } catch (e) { if (await exists(P.summaries)) fail(P.summaries, e); }
}
export async function loadFacts() {
  const exps: Experience[] = [];
  const facts: Fact[] = [];
  for (const file of await listYaml(P.facts)) {
    try {
      const data = FactFileSchema.parse(await readYaml(file));
      exps.push(data.experience);
      for (const f of data.facts) facts.push({ ...f, exp: data.experience.id });
      ok(file);
    } catch (e) { fail(file, e); }
  }
  db.experiences = exps.sort((a, b) => a.order - b.order);
  db.facts = facts;
}
export async function loadRecipes() {
  const out: Recipe[] = [];
  for (const file of await listYaml(P.recipes)) {
    try { out.push(RecipeSchema.parse(await readYaml(file))); ok(file); } catch (e) { fail(file, e); }
  }
  db.recipes = out.sort((a, b) => a.name.localeCompare(b.name));
}
export async function loadCompanies() {
  const out: Company[] = [];
  for (const file of await listYaml(P.companies)) {
    try { out.push(CompanySchema.parse(await readYaml(file))); ok(file); } catch (e) { fail(file, e); }
  }
  db.companies = out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadQuestions() {
  const out: Question[] = [];
  let files: string[] = [];
  try { files = (await fs.readdir(P.questions)).filter((f) => f.endsWith('.yaml') && !f.startsWith('_')); } catch { /* empty */ }
  for (const f of files) {
    const file = path.join(P.questions, f);
    const category = f.replace(/\.yaml$/, '') as QuestionCategory;
    try {
      if (!CATEGORY_IDS.includes(category)) throw new Error(`неизвестная категория «${category}»: допустимы ${CATEGORY_IDS.join(', ')}`);
      const data = QuestionFileSchema.parse((await readYaml(file)) ?? {});
      for (const q of data.questions) out.push({ ...q, category });
      ok(file);
    } catch (e) { fail(file, e); }
  }
  const order = (c: QuestionCategory) => CATEGORY_IDS.indexOf(c);
  db.questions = out.map((q, i) => ({ q, i })).sort((a, b) => order(a.q.category) - order(b.q.category) || a.i - b.i).map((x) => x.q);
}
export async function loadStories() {
  try { db.stories = StoriesFileSchema.parse((await readYaml(P.stories)) ?? {}).stories; ok(P.stories); } catch (e) { if (await exists(P.stories)) fail(P.stories, e); else db.stories = []; }
}

export async function loadStrengths() {
  try {
    const d = StrengthsFileSchema.parse((await readYaml(P.strengths)) ?? {});
    db.strengths = d.strengths; db.weaknesses = d.weaknesses; ok(P.strengths);
  } catch (e) { if (await exists(P.strengths)) fail(P.strengths, e); else { db.strengths = []; db.weaknesses = []; } }
}
export async function loadNotes() {
  const out: Note[] = [];
  let files: string[] = [];
  try { files = (await fs.readdir(P.notes)).filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md'); } catch { /* empty */ }
  for (const f of files) {
    const file = path.join(P.notes, f);
    try {
      const { meta, body } = parseFrontmatter(await readText(file));
      const m = NoteMetaSchema.parse({ title: f.replace(/\.md$/, ''), date: f.slice(0, 10), ...meta });
      out.push({ ...m, file: f, words: body.split(/\s+/).filter(Boolean).length });
      ok(file);
    } catch (e) { fail(file, e); }
  }
  db.notes = out.sort((a, b) => b.file.localeCompare(a.file));
}

const appDir = (id: string) => path.join(P.apps, id);
const appFile = (id: string) => path.join(appDir(id), 'application.md');

export async function loadApp(id: string) {
  const file = appFile(id);
  if (!(await exists(file))) { db.apps.delete(id); return; }
  try {
    const { meta, body } = parseFrontmatter(await readText(file));
    const m = ApplicationMetaSchema.parse({ ...meta, id });
    const sec = parseSections(body);
    let recipe: Recipe | undefined;
    const rf = path.join(appDir(id), 'resume.recipe.yaml');
    if (await exists(rf)) recipe = RecipeSchema.parse(await readYaml(rf));
    const locks: Lock[] = [];
    for (const lf of await listYaml(path.join(appDir(id), 'locks'))) {
      try { locks.push(LockSchema.parse(await readYaml(lf)) as Lock); } catch (e) { fail(lf, e); }
    }
    locks.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const cap = path.join(appDir(id), 'capture');
    let prep: Prep = PrepSchema.parse({});
    const pf = path.join(appDir(id), 'prep.yaml');
    if (await exists(pf)) { try { prep = PrepSchema.parse((await readYaml(pf)) ?? {}); ok(pf); } catch (e) { fail(pf, e); } }
    db.apps.set(id, {
      ...m,
      whyThem: sec.get('Почему они') ?? '',
      whyMe: sec.get('Почему я') ?? '',
      notes: sec.get('Заметки') ?? '',
      recipe, locks, prep,
      files: {
        html: await exists(path.join(cap, 'page.html')),
        md: await exists(path.join(cap, 'page.md')),
        png: await exists(path.join(cap, 'screenshot.png')),
      },
    });
    ok(file);
  } catch (e) { fail(file, e); }
}
export async function loadApps() {
  db.apps.clear();
  let ids: string[] = [];
  try { ids = (await fs.readdir(P.apps, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* empty */ }
  for (const id of ids) await loadApp(id);
}

export async function loadAll() {
  db.errors = [];
  await Promise.all([loadProfile(), loadIcp(), loadSummaries(), loadFacts(), loadRecipes(), loadCompanies(), loadQuestions(), loadStories(), loadStrengths(), loadNotes()]);
  await loadApps();
}

// ---------- fact bank ----------
/** Non-draft facts grouped under their workplace, so a prompt shows the job title and dates behind each fact. */
export function factsByExperience(line: (f: Fact) => string): string {
  return [...db.experiences].sort((a, b) => a.order - b.order).map((e) => {
    const facts = db.facts.filter((f) => f.exp === e.id && f.status !== 'draft');
    if (!facts.length) return '';
    const period = e.start ? `, ${e.start} – ${e.end || 'present'}` : '';
    return [`${e.org}${e.title ? ` — ${e.title}` : ''}${period}`, ...facts.map(line)].join('\n');
  }).filter(Boolean).join('\n\n');
}
const FACTS_HEADER = `Банк фактов. Редактируется в CRM и агентом.
status: verified — можно в резюме · needs-proof — нужно подкрепить · draft — не попадает в резюме.
Новые цифры появляются только с твоих слов.`;

async function saveExp(expId: string) {
  const exp = db.experiences.find((e) => e.id === expId);
  if (!exp) return;
  const facts = db.facts.filter((f) => f.exp === expId).map(({ exp: _e, ...f }) => f);
  await writeYaml(path.join(P.facts, `${expId}.yaml`), { experience: exp, facts }, FACTS_HEADER);
}

export const factById = (id: string) => db.facts.find((f) => f.id === id);

export function newFactId(exp: string, text: string) {
  const words = slugify(text).split('-').filter((w) => w.length > 2).slice(0, 3).join('-') || 'fact';
  let id = `${exp}.${words}`;
  for (let i = 2; factById(id); i++) id = `${exp}.${words}-${i}`;
  return id;
}

export function createFact(exp: string, data: Partial<FactData>, after?: string) {
  return serial(async () => {
    if (!exp) throw new UserError('Не указан опыт (exp), к которому относится факт');
    if (!db.experiences.some((e) => e.id === exp)) throw new UserError(`Нет опыта ${exp}`);
    const id = data.id?.trim() || newFactId(exp, data.text || '');
    if (factById(id)) throw new UserError(`Факт ${id} уже есть`);
    const fact: Fact = { ...FactSchema.parse({ ...data, id }), exp };
    const idx = after ? db.facts.findIndex((f) => f.id === after) : -1;
    if (idx >= 0) db.facts.splice(idx + 1, 0, fact); else db.facts.push(fact);
    await saveExp(exp);
    changed({ scope: 'facts', id, by: 'ui', message: `факт ${id} создан` });
    return fact;
  });
}

export function updateFact(id: string, patch: Partial<Fact>) {
  return serial(async () => {
    const i = db.facts.findIndex((f) => f.id === id);
    if (i < 0) throw new UserError(`Нет факта ${id}`, 404);
    const prev = db.facts[i];
    const { exp: newExp, id: _ignore, ...rest } = patch;
    const next: Fact = { ...FactSchema.parse({ ...prev, ...rest, id }), exp: newExp || prev.exp };
    db.facts[i] = next;
    await saveExp(next.exp);
    if (next.exp !== prev.exp) await saveExp(prev.exp);
    const what = patch.status && patch.status !== prev.status ? `статус ${prev.status} → ${patch.status}` : 'изменён';
    changed({ scope: 'facts', id, by: 'ui', message: `факт ${id}: ${what}` });
    return next;
  });
}

export function deleteFact(id: string) {
  return serial(async () => {
    const f = factById(id);
    if (!f) throw new UserError(`Нет факта ${id}`, 404);
    db.facts = db.facts.filter((x) => x.id !== id);
    await saveExp(f.exp);
    // remove from recipes; lock files are left alone — they are frozen
    for (const r of db.recipes) {
      let touched = false;
      for (const k of Object.keys(r.facts)) if (r.facts[k].includes(id)) { r.facts[k] = r.facts[k].filter((x) => x !== id); touched = true; }
      if (touched) await writeYaml(path.join(P.recipes, `${r.id}.yaml`), r, RECIPE_HEADER);
    }
    for (const a of db.apps.values()) {
      if (a.recipe && Object.values(a.recipe.facts).some((l) => l.includes(id))) {
        for (const k of Object.keys(a.recipe.facts)) a.recipe.facts[k] = a.recipe.facts[k].filter((x) => x !== id);
        await writeYaml(path.join(appDir(a.id), 'resume.recipe.yaml'), a.recipe);
      }
    }
    changed({ scope: 'facts', id, by: 'ui', message: `факт ${id} удалён` });
  });
}

export function reorderFacts(exp: string, ids: string[]) {
  return serial(async () => {
    const own = db.facts.filter((f) => f.exp === exp);
    const ordered = ids.map((id) => own.find((f) => f.id === id)).filter((f): f is Fact => !!f);
    const rest = own.filter((f) => !ids.includes(f.id));
    db.facts = db.facts.filter((f) => f.exp !== exp).concat(ordered, rest);
    await saveExp(exp);
    changed({ scope: 'facts', by: 'ui', message: `порядок фактов в ${exp}` });
  });
}

export function upsertExperience(data: Partial<Experience> & { id?: string }, isNew: boolean) {
  return serial(async () => {
    const id = data.id?.trim() || slugify(data.org || 'experience');
    const i = db.experiences.findIndex((e) => e.id === id);
    if (isNew && i >= 0) throw new UserError(`Опыт ${id} уже есть`);
    if (!isNew && i < 0) throw new UserError(`Нет опыта ${id}`, 404);
    const next = ExperienceSchema.parse({ ...(i >= 0 ? db.experiences[i] : { order: (db.experiences.at(-1)?.order ?? 0) + 10 }), ...data, id });
    if (i >= 0) db.experiences[i] = next; else db.experiences.push(next);
    db.experiences.sort((a, b) => a.order - b.order);
    await saveExp(id);
    changed({ scope: 'facts', id, by: 'ui', message: `опыт ${id} ${isNew ? 'создан' : 'изменён'}` });
    return next;
  });
}

export function deleteExperience(id: string) {
  return serial(async () => {
    if (db.facts.some((f) => f.exp === id)) throw new UserError('Сначала удали или перенеси факты этого опыта');
    db.experiences = db.experiences.filter((e) => e.id !== id);
    await removeFile(path.join(P.facts, `${id}.yaml`));
    changed({ scope: 'facts', id, by: 'ui', message: `опыт ${id} удалён` });
  });
}

// ---------- summaries, profile, ICP ----------
export function saveSummaries(list: Summary[], message: string) {
  return serial(async () => {
    db.summaries = SummariesFileSchema.parse({ summaries: list }).summaries;
    await writeYaml(P.summaries, { summaries: db.summaries }, 'Варианты саммари для резюме. Выбираются в рецепте по id.');
    changed({ scope: 'summaries', by: 'ui', message });
  });
}
const PROFILE_HEADER = `Профиль: имя, контакты, образование — попадают в шапку и низ резюме.
positioning — одна строка для разбора вакансий. context — свободный текст (по-английски): часовой пояс, локация и релокация, формат найма, ограничения; уходит в запросы к Claude.`;
/**
 * Profile update: only the fields sent change (contacts are merged key by key). Merged inside the queue, so two
 * fields committed back to back from the UI cannot overwrite each other with a stale copy of the profile.
 */
export function saveProfile(patch: Partial<Profile>) {
  return serial(async () => {
    db.profile = ProfileSchema.parse({ ...db.profile, ...patch, contacts: { ...db.profile.contacts, ...patch.contacts } });
    await writeYaml(P.profile, db.profile, PROFILE_HEADER);
    changed({ scope: 'profile', by: 'ui', message: 'профиль изменён' });
  });
}
export function saveIcp(icp: Icp) {
  return serial(async () => {
    db.icp = IcpSchema.parse(icp);
    await writeYaml(P.icp, db.icp, 'Критерии ICP для fit-score: по 0–2 за критерий. Редактируется в CRM (Банк фактов → Критерии ICP) и агентом.');
    changed({ scope: 'icp', by: 'ui', message: 'критерии ICP изменены' });
  });
}

// ---------- recipes (tracks) ----------
const RECIPE_HEADER = 'Базовый рецепт резюме под трек. Под вакансию — копия в папке отклика, дифф считается к этому файлу.';
export function saveRecipe(r: Recipe, isNew = false) {
  return serial(async () => {
    const next = RecipeSchema.parse({ ...r, base: undefined });
    const i = db.recipes.findIndex((x) => x.id === next.id);
    if (isNew && i >= 0) throw new UserError(`Рецепт ${next.id} уже есть`);
    if (i >= 0) db.recipes[i] = next; else db.recipes.push(next);
    await writeYaml(path.join(P.recipes, `${next.id}.yaml`), next, RECIPE_HEADER);
    changed({ scope: 'recipes', id: next.id, by: 'ui', message: `базовый рецепт ${next.id} ${isNew ? 'создан' : 'обновлён'}` });
    return next;
  });
}
export function deleteRecipe(id: string) {
  return serial(async () => {
    db.recipes = db.recipes.filter((r) => r.id !== id);
    await removeFile(path.join(P.recipes, `${id}.yaml`));
    changed({ scope: 'recipes', id, by: 'ui', message: `рецепт ${id} удалён` });
  });
}

// ---------- companies ----------
export function upsertCompany(c: Partial<Company> & { name: string }) {
  return serial(async () => {
    const domains = (c.domains || []).map((d) => d.toLowerCase());
    let cur = db.companies.find((x) => (c.slug && x.slug === c.slug) || x.domains.some((d) => domains.includes(d)) || x.name.toLowerCase() === c.name.toLowerCase());
    const next = CompanySchema.parse({
      ...(cur || {}),
      ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== '')),
      slug: cur?.slug || c.slug || slugify(c.name),
      domains: [...new Set([...(cur?.domains || []), ...domains])],
    });
    if (cur) Object.assign(cur, next); else { db.companies.push(next); cur = next; }
    await writeYaml(path.join(P.companies, `${next.slug}.yaml`), next, 'Компания. Создаётся при разборе вакансии, правится в CRM.');
    changed({ scope: 'companies', id: next.slug, by: 'system' });
    return next;
  });
}

// ---------- applications ----------
function metaOf(a: Application): ApplicationMeta {
  const { whyThem: _a, whyMe: _b, notes: _c, recipe: _d, locks: _e, files: _f, prep: _g, ...meta } = a;
  return meta;
}
async function saveApp(a: Application) {
  const title = [a.company_name || 'Без компании', a.role || 'роль не указана'].join(' — ');
  const body = buildSections(title, [['Почему они', a.whyThem], ['Почему я', a.whyMe], ['Заметки', a.notes]]);
  await writeAtomic(appFile(a.id), serializeFrontmatter(metaOf(a), body));
}
export const getApp = (id: string) => {
  const a = db.apps.get(id);
  if (!a) throw new UserError(`Нет отклика ${id}`, 404);
  return a;
};
export const appPath = (id: string, ...p: string[]) => path.join(appDir(id), ...p);

export function newAppId(company: string, role: string) {
  const base = `${today().slice(0, 7)}-${slugify(company || 'vacancy')}${role ? '-' + slugify(role).slice(0, 28) : ''}`.replace(/-+$/, '');
  let id = base;
  for (let i = 2; db.apps.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function createApp(init: Partial<ApplicationMeta> & { whyThem?: string; whyMe?: string; notes?: string; id?: string }, by: ChangeEvent['by'] = 'ui') {
  return serial(async () => {
    const id = init.id || newAppId(init.company_name || '', init.role || '');
    const d = today();
    const meta = ApplicationMetaSchema.parse({ stage_since: d, created: d, timeline: [], ...init, id });
    const a: Application = { ...meta, whyThem: init.whyThem || '', whyMe: init.whyMe || '', notes: init.notes || '', locks: [], prep: PrepSchema.parse({}), files: { html: false, md: false, png: false } };
    db.apps.set(id, a);
    await saveApp(a);
    changed({ scope: 'applications', id, by, message: `отклик ${id} создан` });
    return a;
  });
}

type AppPatch = Partial<Omit<Application, 'id' | 'locks' | 'files' | 'recipe' | 'prep'>>;
export function patchApp(id: string, patch: AppPatch, by: ChangeEvent['by'] = 'ui', message?: string) {
  return serial(async () => {
    const a = getApp(id);
    const stageChanged = !!patch.stage && patch.stage !== a.stage;
    if (stageChanged) {
      const g = gateFor({ ...a, ...patch, stage: a.stage }, patch.stage!);
      if (g && by === 'ui') throw new UserError(g.message, 409, g.code);
    }
    Object.assign(a, patch);
    if (stageChanged) {
      a.timeline.push({ date: today(), kind: 'стадия', text: `→ ${STAGE_NAMES[patch.stage!]}` });
      a.stage_since = today();
      a.reached = maxStage(a.reached, patch.stage!);
    }
    ApplicationMetaSchema.parse(metaOf(a));
    await saveApp(a);
    changed({ scope: 'applications', id, by, message: message || `отклик ${id} изменён` });
    return a;
  });
}

export function addTimeline(id: string, e: TimelineEntry, by: ChangeEvent['by'] = 'ui') {
  return serial(async () => {
    const a = getApp(id);
    a.timeline.push(e);
    a.timeline.sort((x, y) => x.date.localeCompare(y.date));
    await saveApp(a);
    changed({ scope: 'applications', id, by, message: `${id}: ${e.kind}` });
    return a;
  });
}

export function deleteApp(id: string) {
  return serial(async () => {
    getApp(id);
    await fs.rm(appDir(id), { recursive: true, force: true });
    db.apps.delete(id);
    changed({ scope: 'applications', id, by: 'ui', message: `отклик ${id} удалён` });
  });
}

export function saveAppRecipe(id: string, r: Recipe | null) {
  return serial(async () => {
    const a = getApp(id);
    const f = path.join(appDir(id), 'resume.recipe.yaml');
    if (r === null) { a.recipe = undefined; await removeFile(f); }
    else { a.recipe = RecipeSchema.parse(r); await writeYaml(f, a.recipe, 'Рабочий рецепт резюме под эту вакансию. Дифф считается к базовому рецепту (base).'); }
    changed({ scope: 'applications', id, by: 'ui' });
    return a;
  });
}

export const bank = () => ({ experiences: db.experiences, facts: db.facts, summaries: db.summaries, profile: db.profile });

export function createLock(id: string, recipe: Recipe) {
  return serial(async () => {
    const a = getApp(id);
    const r = RecipeSchema.parse(recipe);
    const resolved = resolveRecipe(r, bank());
    const content_hash = crypto.createHash('sha256').update(canonical({ resolved, template: r.template })).digest('hex');
    const hash = content_hash.slice(0, 6);
    const existing = a.locks.find((l) => l.hash === hash);
    if (existing) return existing;
    const base = db.recipes.find((x) => x.id === r.base);
    const orgOf = (e: string) => db.experiences.find((x) => x.id === e)?.org || e;
    const lock: Lock = {
      hash, content_hash, created_at: new Date().toISOString(), application: id, base: r.base, template: r.template,
      patch: diffRecipe(r, base).map((d) => diffText(d, orgOf)), recipe: cloneRecipe(r), resolved,
    };
    await writeYaml(path.join(appDir(id), 'locks', `${hash}.yaml`), lock,
      `ЗАМОРОЖЕНО. Не редактировать ни руками, ни агентом.\nТочный текст резюме для ${a.company_name || id}. PDF собирается из этого файла заново.`);
    a.locks.push(lock);
    a.timeline.push({ date: today(), kind: 'резюме', text: `lock ${hash}${lock.patch.length ? `, правок к базе: ${lock.patch.length}` : ', без правок к базе'}` });
    await saveApp(a);
    changed({ scope: 'applications', id, by: 'ui', message: `${id}: резюме зафиксировано, lock ${hash}` });
    return lock;
  });
}

export function setStage(id: string, stage: Stage, by: ChangeEvent['by'] = 'ui', extra: AppPatch = {}) {
  return patchApp(id, { ...extra, stage }, by, `${id} → ${STAGE_NAMES[stage]}`);
}

// ---------- question bank ----------
const QUESTIONS_HEADER = (c: string) => `Банк вопросов к интервью, категория «${c}». Редактируется в CRM (Интервью → Вопросы) и агентом.
answers — варианты ответа (roles — для каких треков; пусто — для любого). status: draft | ready.
Истории — по id из 00-profile/stories.yaml, факты — по id из банка фактов. Новые цифры — только с твоих слов.`;

async function saveCategory(c: QuestionCategory) {
  const list = db.questions.filter((q) => q.category === c).map(({ category: _c, ...q }) => q);
  const file = path.join(P.questions, `${c}.yaml`);
  await writeYaml(file, { questions: compact(list) }, QUESTIONS_HEADER(c));
}

export const questionById = (id: string) => db.questions.find((q) => q.id === id);

const STOP_WORDS = new Set(['you', 'your', 'the', 'about', 'tell', 'what', 'how', 'why', 'when', 'time', 'did', 'are', 'and', 'would', 'could', 'should',
  'have', 'has', 'had', 'our', 'with', 'for', 'from', 'this', 'that', 'give', 'example', 'describe', 'walk', 'can', 'does', 'was', 'were', 'which', 'where', 'who']);
function newQuestionId(category: string, text: string) {
  const words = slugify(text).split('-').filter((w) => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 3).join('-') || 'question';
  let id = `${category}.${words}`;
  for (let i = 2; questionById(id); i++) id = `${category}.${words}-${i}`;
  return id;
}

function insertQuestion(category: QuestionCategory, data: Partial<QuestionData>) {
  if (!CATEGORY_IDS.includes(category)) throw new UserError(`Нет категории ${category}`);
  const id = data.id?.trim() || newQuestionId(category, data.text || data.ru || '');
  if (questionById(id)) throw new UserError(`Вопрос ${id} уже есть`);
  const q: Question = { ...QuestionSchema.parse({ ...data, id }), category };
  const last = db.questions.map((x) => x.category).lastIndexOf(category);
  if (last >= 0) db.questions.splice(last + 1, 0, q); else db.questions.push(q);
  return q;
}

export function createQuestion(category: QuestionCategory, data: Partial<QuestionData>) {
  return serial(async () => {
    const q = insertQuestion(category, data);
    await saveCategory(category);
    changed({ scope: 'questions', id: q.id, by: 'ui', message: `вопрос ${q.id} создан` });
    return q;
  });
}

export function updateQuestion(id: string, patch: Partial<Question>, message?: string) {
  return serial(async () => {
    const i = db.questions.findIndex((q) => q.id === id);
    if (i < 0) throw new UserError(`Нет вопроса ${id}`, 404);
    const prev = db.questions[i];
    const { category: cat, id: _ignore, ...rest } = patch;
    const category = cat && CATEGORY_IDS.includes(cat) ? cat : prev.category;
    const next: Question = { ...QuestionSchema.parse({ ...prev, ...rest, id }), category };
    if (category !== prev.category) {
      db.questions.splice(i, 1);
      const last = db.questions.map((x) => x.category).lastIndexOf(category);
      db.questions.splice(last >= 0 ? last + 1 : db.questions.length, 0, next);
      await saveCategory(prev.category);
    } else db.questions[i] = next;
    await saveCategory(category);
    changed({ scope: 'questions', id, by: 'ui', message: message || `вопрос ${id} изменён` });
    return next;
  });
}

export function deleteQuestion(id: string) {
  return serial(async () => {
    const q = questionById(id);
    if (!q) throw new UserError(`Нет вопроса ${id}`, 404);
    db.questions = db.questions.filter((x) => x.id !== id);
    await saveCategory(q.category);
    // in prep: an entry with an answer or a «спросили» mark becomes its own question; an empty one goes away
    for (const a of db.apps.values()) {
      const i = a.prep.items.findIndex((x) => x.q === id);
      if (i < 0) continue;
      const it = a.prep.items[i];
      if (it.answer?.trim() || it.asked) a.prep.items[i] = { ...it, q: undefined, id: nextItemId(a.prep), text: q.text, ru: q.ru, category: q.category, competency: q.competency, source: it.source || 'manual' };
      else a.prep.items.splice(i, 1);
      await savePrep(a);
    }
    changed({ scope: 'questions', id, by: 'ui', message: `вопрос ${id} удалён` });
  });
}

// ---------- stories ----------
const STORIES_HEADER = `Банк историй для behavioral-интервью: Situation → Task → Action → Result → компромисс → Reflection.
covers — какие компетенции история покрывает: 2 полностью, 1 частично. Цифры — ссылками на факты (facts).
Правило: минимум одна метрика и один компромисс на историю. Редактируется в CRM (Интервью → Истории) и агентом.`;

async function writeStories() {
  await writeYaml(P.stories, { stories: compact(db.stories) }, STORIES_HEADER);
}

export const storyById = (id: string) => db.stories.find((s) => s.id === id);
export function nextStoryId() {
  const n = Math.max(0, ...db.stories.map((s) => Number(s.id.replace(/^S/, '')) || 0));
  return `S${n + 1}`;
}

export function upsertStory(id: string | undefined, data: Partial<Story>, isNew: boolean) {
  return serial(async () => {
    const sid = id?.trim() || nextStoryId();
    const i = db.stories.findIndex((s) => s.id === sid);
    if (isNew && i >= 0) throw new UserError(`История ${sid} уже есть`);
    if (!isNew && i < 0) throw new UserError(`Нет истории ${sid}`, 404);
    const next = StorySchema.parse({ ...(i >= 0 ? db.stories[i] : {}), ...data, id: sid });
    next.covers = Object.fromEntries(Object.entries(next.covers).filter(([, v]) => v > 0));
    if (i >= 0) db.stories[i] = next; else db.stories.push(next);
    await writeStories();
    changed({ scope: 'stories', id: sid, by: 'ui', message: `история ${sid} ${isNew ? 'создана' : 'изменена'}` });
    return next;
  });
}

export function deleteStory(id: string) {
  return serial(async () => {
    if (!storyById(id)) throw new UserError(`Нет истории ${id}`, 404);
    db.stories = db.stories.filter((s) => s.id !== id);
    await writeStories();
    const touched = new Set<QuestionCategory>();
    for (const q of db.questions) {
      if (!q.answers.some((a) => a.stories.includes(id))) continue;
      for (const a of q.answers) a.stories = a.stories.filter((x) => x !== id);
      // a variant that was only a reference to this story no longer carries anything
      q.answers = q.answers.filter((a) => a.text.trim() || a.stories.length || a.facts.length || a.label);
      touched.add(q.category);
    }
    for (const c of touched) await saveCategory(c);
    for (const a of db.apps.values()) {
      if (a.prep.items.some((i) => i.stories.includes(id))) {
        a.prep.items.forEach((i) => { i.stories = i.stories.filter((x) => x !== id); });
        await savePrep(a);
      }
    }
    changed({ scope: 'stories', id, by: 'ui', message: `история ${id} удалена` });
  });
}

// ---------- «Подготовка»: interview prep per job ----------
const PREP_HEADER = `Подготовка к интервью по этой вакансии. Хранится только то, что решили человек или Claude:
ответ под вакансию (answer), «спросили» (asked), скрыто (hidden), выбор Claude (why/angle), свои вопросы (id + text).
Остальные вопросы подбираются из банка на лету.`;

async function savePrep(a: Application) {
  a.prep.items = a.prep.items.filter((i) => !isEmptyItem(i));
  const file = path.join(appDir(a.id), 'prep.yaml');
  if (!a.prep.items.length && a.prep.claude.status === 'none') { await removeFile(file); return; }
  await writeYaml(file, compact({ ...(a.prep.claude.status !== 'none' ? { claude: a.prep.claude } : {}), items: a.prep.items }), PREP_HEADER);
}

function nextItemId(prep: Prep) {
  const n = Math.max(0, ...prep.items.map((i) => Number(i.id?.replace(/^x/, '')) || 0));
  return `x${n + 1}`;
}

const findItem = (a: Application, key: string) => a.prep.items.find((i) => prepKey(i) === key);

export function patchPrepItem(appId: string, key: string, patch: Partial<PrepItem>, message?: string) {
  return serial(async () => {
    const a = getApp(appId);
    let item = findItem(a, key);
    if (!item) {
      if (!questionById(key)) throw new UserError(`Нет вопроса ${key}`, 404);
      item = PrepItemSchema.parse({ q: key });
      a.prep.items.push(item);
    }
    const { q: _q, id: _id, ...rest } = patch;
    // null from the UI — clear the field
    for (const [k, v] of Object.entries(rest)) (item as Record<string, unknown>)[k] = v === null ? undefined : v;
    Object.assign(item, PrepItemSchema.parse(item));
    await savePrep(a);
    const q = item.q ? questionById(item.q) : undefined;
    const what = patch.asked ? 'спросили' : patch.hidden ? 'скрыт' : patch.answer !== undefined ? 'ответ' : 'изменён';
    changed({ scope: 'applications', id: appId, by: 'ui', message: message || `${appId}: вопрос «${(q?.text || item.text || key).slice(0, 50)}» — ${what}` });
    return item;
  });
}

export function addPrepItem(appId: string, data: Partial<PrepItem>) {
  return serial(async () => {
    const a = getApp(appId);
    if (!data.text?.trim()) throw new UserError('Пустой вопрос');
    const item = PrepItemSchema.parse({ category: 'specific', source: 'manual', ...data, q: undefined, id: nextItemId(a.prep) });
    a.prep.items.push(item);
    await savePrep(a);
    changed({ scope: 'applications', id: appId, by: 'ui', message: `${appId}: свой вопрос «${item.text!.slice(0, 50)}»` });
    return item;
  });
}

export function deletePrepItem(appId: string, key: string) {
  return serial(async () => {
    const a = getApp(appId);
    a.prep.items = a.prep.items.filter((i) => prepKey(i) !== key);
    await savePrep(a);
    changed({ scope: 'applications', id: appId, by: 'ui', message: `${appId}: вопрос ${key} убран из подготовки` });
  });
}

/** Custom question → bank. In prep it becomes a link to the new bank question; the answer and «спросили» are kept. */
export function promotePrepItem(appId: string, key: string, category: QuestionCategory) {
  return serial(async () => {
    const a = getApp(appId);
    const item = findItem(a, key);
    if (!item || item.q) throw new UserError('Это уже вопрос из банка');
    const company = a.company_name || a.id;
    const q = insertQuestion(category, {
      text: item.text, ru: item.ru, competency: item.competency,
      priority: item.asked ? 'medium' : 'low',
      answers: item.answer?.trim() ? [{ text: item.answer, status: 'draft', roles: a.track ? [a.track] : [], stories: item.stories, facts: item.facts }] : [],
      source: item.asked ? `спросили: ${company}, ${item.asked}` : `подготовка к ${company}`,
      note: item.angle,
    });
    await saveCategory(category);
    const i = a.prep.items.indexOf(item);
    a.prep.items[i] = PrepItemSchema.parse({ q: q.id, stories: item.stories, facts: item.facts, asked: item.asked, asked_at: item.asked_at, practice: item.practice, pinned: true });
    await savePrep(a);
    changed({ scope: 'questions', id: q.id, by: 'ui', message: `вопрос ${q.id} добавлен в банк из ${appId}` });
    return q;
  });
}

export function setPrepClaude(appId: string, claude: Prep['claude']) {
  return serial(async () => {
    const a = getApp(appId);
    a.prep.claude = claude;
    await savePrep(a);
    changed({ scope: 'applications', id: appId, by: 'system' });
  });
}

/** Claude's selection result: picks from the bank (why) and job-specific questions. Anything a human touched is kept. */
export function applyClaudePrep(appId: string, picks: { id: string; why: string }[], specific: Partial<PrepItem>[], claude: Prep['claude']) {
  return serial(async () => {
    const a = getApp(appId);
    const touched = (i: PrepItem) => !!(i.answer?.trim() || i.asked || i.pinned || i.hidden || i.practice);
    // drop Claude's old pick
    a.prep.items = a.prep.items.filter((i) => i.q || i.source !== 'claude' || touched(i));
    for (const i of a.prep.items) if (i.q) { i.why = undefined; i.angle = undefined; }
    for (const p of picks) {
      if (!questionById(p.id)) continue;
      let it = findItem(a, p.id);
      if (!it) { it = PrepItemSchema.parse({ q: p.id }); a.prep.items.push(it); }
      it.why = p.why;
    }
    const seen = new Set(a.prep.items.filter((i) => !i.q).map((i) => (i.text || '').toLowerCase().trim()));
    for (const s of specific) {
      if (!s.text?.trim() || seen.has(s.text.toLowerCase().trim())) continue;
      a.prep.items.push(PrepItemSchema.parse({ ...s, source: 'claude', id: nextItemId(a.prep) }));
    }
    a.prep.claude = claude;
    await savePrep(a);
    changed({ scope: 'applications', id: appId, by: 'system', message: `${appId}: Claude подобрал вопросы к интервью` });
  });
}

// ---------- strengths and weaknesses ----------
const STRENGTHS_HEADER = `Сильные стороны (что подчеркнуть и чем доказать) и слабые места профиля (как вскрывают и что отвечаю).
Доказательства — ссылками на факты и истории. pitch и counter — как говорю на интервью.
status: draft | ready — ready ставишь ты. Редактируется в CRM (Интервью → Сильные и слабые) и агентом.`;

async function writeStrengths() {
  await writeYaml(P.strengths, { strengths: compact(db.strengths), weaknesses: compact(db.weaknesses) }, STRENGTHS_HEADER);
}

export type SideKind = 'strength' | 'weakness';
const sideList = (k: SideKind) => (k === 'strength' ? db.strengths : db.weaknesses) as (Strength | Weakness)[];
export const sideById = (k: SideKind, id: string) => sideList(k).find((x) => x.id === id);

export function upsertSide(kind: SideKind, id: string | undefined, data: Partial<Strength & Weakness>, isNew: boolean) {
  return serial(async () => {
    const list = sideList(kind);
    const sid = id?.trim() || (() => {
      const base = slugify(data.title || kind).split('-').filter((w) => w.length > 2).slice(0, 3).join('-') || kind;
      let x = base;
      for (let i = 2; list.some((y) => y.id === x); i++) x = `${base}-${i}`;
      return x;
    })();
    const i = list.findIndex((x) => x.id === sid);
    if (isNew && i >= 0) throw new UserError(`${kind === 'strength' ? 'Сильная сторона' : 'Слабое место'} ${sid} уже есть`);
    if (!isNew && i < 0) throw new UserError(`Нет записи ${sid}`, 404);
    const schema = kind === 'strength' ? StrengthSchema : WeaknessSchema;
    const next = schema.parse({ ...(i >= 0 ? list[i] : {}), ...data, id: sid });
    if (i >= 0) list[i] = next; else list.push(next);
    await writeStrengths();
    const message = kind === 'strength' ? `сильная сторона ${sid} ${isNew ? 'создана' : 'изменена'}` : `слабое место ${sid} ${isNew ? 'создано' : 'изменено'}`;
    changed({ scope: 'strengths', id: sid, by: 'ui', message });
    return next;
  });
}

export function deleteSide(kind: SideKind, id: string) {
  return serial(async () => {
    if (!sideById(kind, id)) throw new UserError(`Нет записи ${id}`, 404);
    if (kind === 'strength') db.strengths = db.strengths.filter((x) => x.id !== id);
    else db.weaknesses = db.weaknesses.filter((x) => x.id !== id);
    await writeStrengths();
    changed({ scope: 'strengths', id, by: 'ui', message: `${kind === 'strength' ? 'сильная сторона' : 'слабое место'} ${id} удалено` });
  });
}

// ---------- raw notes: dictated material and session logs ----------
const noteFile = (f: string) => {
  if (!/^[\w.-]+\.md$/.test(f)) throw new UserError('Неверное имя файла', 400);
  return path.join(P.notes, f);
};

export async function readNote(f: string) {
  const file = noteFile(f);
  if (!(await exists(file))) throw new UserError('Нет такой заметки', 404);
  return parseFrontmatter(await readText(file));
}

export function createNote(data: { title: string; text?: string; kind?: Note['kind']; slug?: string }) {
  return serial(async () => {
    const date = today();
    const base = `${date}-${(data.slug || slugify(data.title || 'note')).slice(0, 48) || 'note'}`;
    let f = `${base}.md`;
    for (let i = 2; db.notes.some((n) => n.file === f) || (await exists(noteFile(f))); i++) f = `${base}-${i}.md`;
    const meta = NoteMetaSchema.parse({ title: data.title || base, date, kind: data.kind || 'dump', status: 'new' });
    await writeAtomic(noteFile(f), serializeFrontmatter(meta, `# ${meta.title}\n\n${(data.text || '').trim()}`));
    await loadNotes();
    changed({ scope: 'notes', id: f, by: 'ui', message: `сырьё: ${meta.title}` });
    return db.notes.find((n) => n.file === f)!;
  });
}

/** Append a block to the end of a note (session log: question → the user's answer). */
export function appendNote(f: string, text: string, heading?: string) {
  return serial(async () => {
    const { meta, body } = await readNote(f);
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const block = `${heading ? `### ${heading}` : `### ${time}`}\n\n${text.trim()}`;
    await writeAtomic(noteFile(f), serializeFrontmatter(meta, `${body.trimEnd()}\n\n${block}`));
    await loadNotes();
    changed({ scope: 'notes', id: f, by: 'ui', message: `сырьё ${f}: дописано` });
  });
}

export function setNoteStatus(f: string, status: Note['status']) {
  return serial(async () => {
    const { meta, body } = await readNote(f);
    await writeAtomic(noteFile(f), serializeFrontmatter({ ...meta, status }, body));
    await loadNotes();
    changed({ scope: 'notes', id: f, by: 'ui', message: `сырьё ${f}: ${status === 'processed' ? 'разобрано' : 'не разобрано'}` });
  });
}

export function deleteNote(f: string) {
  return serial(async () => {
    await removeFile(noteFile(f));
    await loadNotes();
    changed({ scope: 'notes', id: f, by: 'ui', message: `сырьё ${f} удалено` });
  });
}
