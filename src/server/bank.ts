// Agent tool for filling the banks: gap queue, progress, record view, batch writes.
// Writes the same files as the CRM; the running server picks up the edits itself (as external ones).
//
// From a workspace (app/ is the symlink to the app checkout):
//   npm --prefix app run -s bank -- gaps [--level 1] [--bank stories] [--limit 30] [--json]
//   npm --prefix app run -s bank -- stats
//   npm --prefix app run -s bank -- show <id>   fact, story, question, strength/weakness, experience, notes file
//   npm --prefix app run -s bank -- apply <file.json | -> [--dry]
//   npm --prefix app run -s bank -- ops         help for apply operations
// Inside the app checkout itself: `npm run bank -- …` (the workspace then comes from CRM_ROOT in .env).
// A relative apply file path is resolved against the folder the command was started from.
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ORIGIN } from './config';
import {
  db, loadAll, createFact, updateFact, upsertExperience, upsertStory, createQuestion, updateQuestion, upsertSide,
  createNote, appendNote, setNoteStatus, readNote, questionById, storyById, sideById, factById, nextStoryId,
} from './store';
import { validate, summary } from './validate';
import { docTodos } from './docs';
import { computeGaps, GAP_BANKS, progressPct, type Gap } from '../shared/gaps';
import { CATEGORY_IDS, COMPETENCIES, QUESTION_CATEGORIES, type Answer, type AppState, type QuestionCategory } from '../shared/schema';
import { recipeIds } from '../shared/resume';
import { storiesFor } from '../shared/interview';
import { slugify, today } from '../shared/pipeline';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] ?? '' : undefined; };
const has = (name: string) => argv.includes(`--${name}`);

const state = (): Parameters<typeof computeGaps>[0] => ({
  profile: db.profile, facts: db.facts, experiences: db.experiences, stories: db.stories, questions: db.questions,
  strengths: db.strengths, weaknesses: db.weaknesses, notes: db.notes, applications: [...db.apps.values()], recipes: db.recipes,
} as Pick<AppState, 'profile' | 'facts' | 'experiences' | 'stories' | 'questions' | 'strengths' | 'weaknesses' | 'notes' | 'applications' | 'recipes'>);

const bankName = new Map(GAP_BANKS);
const LEVEL = { 1: 'Уровень 1 — сначала: спросят на ближайшем интервью или попадёт в резюме', 2: 'Уровень 2 — важно', 3: 'Уровень 3 — когда дойдут руки' } as const;

function printGaps(gaps: Gap[]) {
  for (const lvl of [1, 2, 3] as const) {
    const list = gaps.filter((g) => g.level === lvl);
    if (!list.length) continue;
    console.log(`\n${LEVEL[lvl]} (${list.length})`);
    for (const g of list) {
      console.log(`  [${bankName.get(g.bank)}] ${g.title}`);
      if (g.ask) console.log(`      спросить: ${g.ask}`);
      console.log(`      ${g.ref ? `id: ${g.ref} · ` : ''}CRM: ${ORIGIN}/#/${g.link}`);
    }
  }
}

// ---------- apply ----------
type Op = Record<string, unknown> & { op: string };
const OPS: Record<string, string> = {
  'note.log': '{topic, text, heading?} — дописать в лог сессии 00-profile/notes/<дата>-session-<topic>.md (создаётся сам). Ответы владельца профиля — сюда, дословно',
  'note.create': '{title, text, kind?: dump|session} — новый файл сырья',
  'note.append': '{file, text, heading?} — дописать в существующий файл сырья',
  'note.status': '{file, status: new|processed} — отметить сырьё разобранным',
  'fact.create': '{exp, text, source, id?, short?, ru?, tags?, roles?, metrics?, stories?, note?, derived_from?, status?: draft|needs-proof, after?}',
  'fact.update': '{id, ...поля} — id не меняется; status verified ставит владелец профиля в CRM',
  'experience.create': '{org, id?, kind?: job|section, title?, start?, end?, location?, blurb?}',
  'story.create': '{title, source, id?, exp?, covers?: {компетенция: 1|2}, situation?, task?, action?, result?, tradeoff?, reflection?, facts?, note?}',
  'story.update': '{id, ...поля} — covers заменяется целиком; status ready ставит владелец профиля в CRM',
  'question.create': '{category, text, ru?, id?, variants?, priority?: high|medium|low, roles?, tags?, competency?, topic?, note?, source?}',
  'question.update': '{id, ...поля кроме answers} — ответы правь через answer.*',
  'answer.add': '{question, text, label?, roles?, stories?, facts?} — вариант ответа, всегда draft',
  'answer.update': '{question, index (с 0), ...поля варианта}',
  'strength.create': '{title, id?, pitch?, ru?, roles?, tags?, facts?, stories?, note?, source?}',
  'strength.update': '{id, ...поля}',
  'weakness.create': '{title, id?, sounds?, counter?, questions?, roles?, tags?, facts?, stories?, note?, source?}',
  'weakness.update': '{id, ...поля}',
};

class OpError extends Error {}

/** Validates an operation before writing. ids — what already exists or will be created earlier in this batch. */
function check(op: Op, ids: Record<string, Set<string>>) {
  const need = (...keys: string[]) => keys.forEach((k) => { if (op[k] === undefined || op[k] === '') throw new OpError(`нужно поле «${k}»`); });
  const list = (k: string) => (Array.isArray(op[k]) ? (op[k] as string[]) : []);
  const exists = (kind: string, id: unknown, what: string) => { if (!ids[kind].has(String(id))) throw new OpError(`нет ${what} ${id}`); };
  if (!OPS[op.op]) throw new OpError(`неизвестная операция; список: npm --prefix app run -s bank -- ops`);
  if (op.status === 'verified' || op.status === 'ready') throw new OpError('статус verified/ready ставит владелец профиля в CRM — агент пишет только draft или needs-proof');
  list('facts').forEach((x) => exists('facts', x, 'факта'));
  list('stories').forEach((x) => exists('stories', x, 'истории'));
  list('questions').forEach((x) => exists('questions', x, 'вопроса'));
  for (const c of Object.keys((op.covers as object) || {})) if (!COMPETENCIES.some((x) => x[0] === c)) throw new OpError(`неизвестная компетенция ${c}`);
  if (op.competency && !COMPETENCIES.some((x) => x[0] === op.competency)) throw new OpError(`неизвестная компетенция ${op.competency}`);
  for (const r of list('roles')) if (!db.recipes.some((x) => x.id === r)) throw new OpError(`неизвестный трек ${r}${db.recipes.length ? `; есть: ${db.recipes.map((x) => x.id).join(', ')}` : ': треков пока нет, создай рецепт в CRM («Конструктор резюме»)'}`);
  const reg = (kind: string) => { if (op.id) ids[kind].add(String(op.id)); };
  switch (op.op) {
    case 'note.log': need('topic', 'text'); ids.notes.add(`${today()}-session-${slugify(String(op.topic)).slice(0, 36)}.md`); break;
    case 'note.create': need('title', 'text'); break;
    case 'note.append': need('file', 'text'); exists('notes', op.file, 'файла сырья'); break;
    case 'note.status': need('file', 'status'); exists('notes', op.file, 'файла сырья'); break;
    case 'fact.create':
      need('exp', 'text', 'source'); exists('exps', op.exp, 'опыта');
      if (op.id && ids.facts.has(String(op.id))) throw new OpError(`факт ${op.id} уже есть`);
      if (op.derived_from) exists('facts', op.derived_from, 'факта');
      reg('facts'); break;
    case 'fact.update': need('id'); exists('facts', op.id, 'факта'); if (op.exp) exists('exps', op.exp, 'опыта'); break;
    case 'experience.create': {
      need('org');
      // same id the store derives when none is given, so a later fact.create in this batch can refer to it
      const id = expId(op);
      if (ids.exps.has(id)) throw new OpError(`опыт ${id} уже есть`);
      ids.exps.add(id); break;
    }
    case 'story.create': need('title', 'source'); if (op.exp) exists('exps', op.exp, 'опыта'); if (op.id && ids.stories.has(String(op.id))) throw new OpError(`история ${op.id} уже есть`); reg('stories'); break;
    case 'story.update': need('id'); exists('stories', op.id, 'истории'); if (op.exp) exists('exps', op.exp, 'опыта'); break;
    case 'question.create': need('category', 'text'); if (!CATEGORY_IDS.includes(op.category as QuestionCategory)) throw new OpError(`нет категории ${op.category}; есть: ${CATEGORY_IDS.join(', ')}`); reg('questions'); break;
    case 'question.update': need('id'); exists('questions', op.id, 'вопроса'); if ('answers' in op) throw new OpError('ответы правь через answer.add / answer.update'); break;
    case 'answer.add': need('question', 'text'); exists('questions', op.question, 'вопроса'); break;
    case 'answer.update': need('question', 'index'); exists('questions', op.question, 'вопроса'); break;
    case 'strength.create': need('title'); reg('strengths'); break;
    case 'strength.update': need('id'); exists('strengths', op.id, 'сильной стороны'); break;
    case 'weakness.create': need('title'); reg('weaknesses'); break;
    case 'weakness.update': need('id'); exists('weaknesses', op.id, 'слабого места'); break;
  }
}

const expId = (op: Op) => String(op.id || '').trim() || slugify(String(op.org || 'experience'));

const strip = (op: Op, ...keys: string[]) => Object.fromEntries(Object.entries(op).filter(([k]) => !['op', ...keys].includes(k)));

async function run(op: Op): Promise<string> {
  switch (op.op) {
    case 'note.log': {
      const topic = String(op.topic);
      const slug = `session-${slugify(topic).slice(0, 36)}`;
      let file = db.notes.find((n) => n.file === `${today()}-${slug}.md`)?.file;
      if (!file) file = (await createNote({ title: `Сессия наполнения: ${topic}`, text: '', kind: 'session', slug })).file;
      await appendNote(file, String(op.text), op.heading as string | undefined);
      return `сырьё ${file}`;
    }
    case 'note.create': return `сырьё ${(await createNote({ title: String(op.title), text: String(op.text), kind: (op.kind as 'dump' | 'session') || 'dump' })).file}`;
    case 'note.append': await appendNote(String(op.file), String(op.text), op.heading as string | undefined); return `сырьё ${op.file}: дописано`;
    case 'note.status': await setNoteStatus(String(op.file), op.status as 'new' | 'processed'); return `сырьё ${op.file}: ${op.status}`;
    case 'fact.create': {
      const f = await createFact(String(op.exp), { status: 'draft', ...strip(op, 'exp', 'after') }, op.after as string | undefined);
      return `факт ${f.id} (${f.status})`;
    }
    case 'fact.update': { const f = await updateFact(String(op.id), strip(op, 'id')); return `факт ${f.id} изменён`; }
    case 'experience.create': { const e = await upsertExperience({ ...strip(op), id: expId(op) }, true); return `опыт ${e.id}`; }
    case 'story.create': { const st = await upsertStory((op.id as string) || nextStoryId(), { ...strip(op, 'id'), status: 'draft' }, true); return `история ${st.id}`; }
    case 'story.update': { const st = await upsertStory(String(op.id), strip(op, 'id'), false); return `история ${st.id} изменена`; }
    case 'question.create': { const q = await createQuestion(op.category as QuestionCategory, strip(op, 'category')); return `вопрос ${q.id}`; }
    case 'question.update': { const q = await updateQuestion(String(op.id), strip(op, 'id'), `вопрос ${op.id} изменён`); return `вопрос ${q.id} изменён`; }
    case 'answer.add': {
      const q = questionById(String(op.question))!;
      const a: Answer = { roles: [], stories: [], facts: [], ...(strip(op, 'question') as Partial<Answer>), text: String(op.text), status: 'draft' };
      await updateQuestion(q.id, { answers: [...q.answers, a] }, `вопрос ${q.id}: вариант ответа`);
      return `вопрос ${q.id}: вариант ответа ${q.answers.length + 1}`;
    }
    case 'answer.update': {
      const q = questionById(String(op.question))!;
      const i = Number(op.index);
      if (!q.answers[i]) throw new OpError(`у вопроса ${q.id} нет варианта ${i}`);
      const answers = q.answers.map((a, j) => (j === i ? { ...a, ...(strip(op, 'question', 'index') as Partial<Answer>) } : a));
      await updateQuestion(q.id, { answers }, `вопрос ${q.id}: вариант ${i + 1} изменён`);
      return `вопрос ${q.id}: вариант ${i + 1} изменён`;
    }
    case 'strength.create': { const x = await upsertSide('strength', op.id as string | undefined, { ...strip(op, 'id'), status: 'draft' }, true); return `сильная сторона ${x.id}`; }
    case 'strength.update': { const x = await upsertSide('strength', String(op.id), strip(op, 'id'), false); return `сильная сторона ${x.id} изменена`; }
    case 'weakness.create': { const x = await upsertSide('weakness', op.id as string | undefined, { ...strip(op, 'id'), status: 'draft' }, true); return `слабое место ${x.id}`; }
    case 'weakness.update': { const x = await upsertSide('weakness', String(op.id), strip(op, 'id'), false); return `слабое место ${x.id} изменено`; }
  }
  throw new OpError('неизвестная операция');
}

async function apply(src: string, dry: boolean) {
  // npm runs scripts in the app dir; a relative path is meant relative to where the command was typed
  const file = path.resolve(process.env.INIT_CWD || process.cwd(), src);
  const raw = src === '-' ? await new Promise<string>((r) => { let d = ''; process.stdin.on('data', (c) => (d += c)); process.stdin.on('end', () => r(d)); }) : await fs.readFile(file, 'utf8');
  let ops: Op[];
  try { const j = JSON.parse(raw); ops = Array.isArray(j) ? j : [j]; } catch (e) { console.error(`Не JSON: ${(e as Error).message}`); process.exit(2); }
  const ids: Record<string, Set<string>> = {
    facts: new Set(db.facts.map((x) => x.id)), stories: new Set(db.stories.map((x) => x.id)), questions: new Set(db.questions.map((x) => x.id)),
    exps: new Set(db.experiences.map((x) => x.id)), strengths: new Set(db.strengths.map((x) => x.id)), weaknesses: new Set(db.weaknesses.map((x) => x.id)),
    notes: new Set(db.notes.map((x) => x.file)),
  };
  const errors: string[] = [];
  ops.forEach((op, i) => { try { check(op, ids); } catch (e) { errors.push(`#${i + 1} ${op.op}: ${(e as Error).message}`); } });
  if (errors.length) {
    console.error(`Ничего не записано. Ошибки в пакете:\n${errors.map((e) => ' - ' + e).join('\n')}`);
    process.exit(1);
  }
  if (dry) { console.log(`Пакет корректен, операций: ${ops.length}. Ничего не записано (--dry).`); return; }
  for (const [i, op] of ops.entries()) {
    try { console.log(`#${i + 1} ✓ ${await run(op)}`); } catch (e) {
      console.error(`#${i + 1} ✗ ${op.op}: ${(e as Error).message}\nОперации до #${i + 1} записаны, после — нет.`);
      process.exit(1);
    }
  }
  await loadAll();
  const problems = validate();
  if (problems.length) { console.log(`\nПроблем в данных: ${problems.length}`); problems.forEach((p) => console.log(' - ' + p)); process.exitCode = 1; }
  const { gaps } = computeGaps(state(), await docTodos());
  console.log(`\nГотово. Осталось пробелов: уровень 1 — ${gaps.filter((g) => g.level === 1).length}, уровень 2 — ${gaps.filter((g) => g.level === 2).length}.`);
  console.log('Не забудь: коммит с «Agent: claude» в конце сообщения.');
}

// ---------- show ----------
async function show(id: string) {
  const y = (o: unknown) => YAML.stringify(o, { lineWidth: 110 }).trimEnd();
  const f = factById(id);
  if (f) {
    console.log(`Факт (${f.exp})\n${y(f)}`);
    const recipes = db.recipes.filter((r) => recipeIds(r).includes(id)).map((r) => r.id);
    const qs = db.questions.filter((q) => q.answers.some((a) => a.facts.includes(id))).map((q) => q.id);
    const sts = db.stories.filter((s) => s.facts.includes(id)).map((s) => s.id);
    const locks = [...db.apps.values()].filter((a) => a.locks.some((l) => recipeIds(l.recipe).includes(id))).map((a) => a.id);
    console.log(`\nВ базовых рецептах: ${recipes.join(', ') || '—'}\nВ отправленных резюме (lock): ${locks.join(', ') || '—'} — id не менять\nВ историях: ${sts.join(', ') || '—'}\nВ ответах: ${qs.join(', ') || '—'}`);
    return;
  }
  const st = storyById(id);
  if (st) {
    console.log(`История\n${y(st)}`);
    const qs = db.questions.filter((q) => q.answers.some((a) => a.stories.includes(id))).map((q) => q.id);
    const sides = [...db.strengths, ...db.weaknesses].filter((x) => x.stories.includes(id)).map((x) => x.id);
    console.log(`\nВ ответах: ${qs.join(', ') || '—'}\nВ сильных/слабых: ${sides.join(', ') || '—'}`);
    return;
  }
  const q = questionById(id);
  if (q) {
    console.log(`Вопрос (${q.category})\n${y(q)}`);
    if (q.competency) console.log(`\nИстории по компетенции ${q.competency}: ${storiesFor(q.competency, db.stories).map((s) => `${s.id}(${s.covers[q.competency!]})`).join(', ') || 'нет — дыра'}`);
    const asked = [...db.apps.values()].filter((a) => a.prep.items.some((i) => i.q === id && i.asked)).map((a) => a.id);
    if (asked.length) console.log(`Спрашивали: ${asked.join(', ')}`);
    return;
  }
  const sd = sideById('strength', id) || sideById('weakness', id);
  if (sd) { console.log(`${sideById('strength', id) ? 'Сильная сторона' : 'Слабое место'}\n${y(sd)}`); return; }
  const e = db.experiences.find((x) => x.id === id);
  if (e) { console.log(`Опыт\n${y(e)}\n\nФакты: ${db.facts.filter((x) => x.exp === id).map((x) => `${x.id} [${x.status}]`).join(', ')}`); return; }
  const n = db.notes.find((x) => x.file === id || x.file === `${id}.md`);
  if (n) { const { body } = await readNote(n.file); console.log(`Сырьё ${n.file} [${n.status}, ${n.kind}]\n\n${body}`); return; }
  console.error(`Не нашёл «${id}» среди фактов, историй, вопросов, сильных/слабых сторон, опыта и сырья.`);
  process.exit(1);
}

// ---------- main ----------
await loadAll();
if (cmd === 'gaps') {
  let { gaps } = computeGaps(state(), await docTodos());
  const lvl = flag('level'); const bank = flag('bank'); const limit = Number(flag('limit') || 0);
  if (lvl) gaps = gaps.filter((g) => g.level <= Number(lvl));
  if (bank) gaps = gaps.filter((g) => g.bank === bank);
  if (limit) gaps = gaps.slice(0, limit);
  if (has('json')) console.log(JSON.stringify(gaps, null, 2));
  else { console.log(`Пробелов: ${gaps.length}${bank ? ` (${bankName.get(bank as never) || bank})` : ''}`); printGaps(gaps); }
} else if (cmd === 'stats') {
  const { progress, gaps } = computeGaps(state(), await docTodos());
  console.log(summary() + '\n');
  for (const p of progress) {
    const pct = progressPct(p);
    const bar = pct === null ? ''.padEnd(20, '·') : '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');
    console.log(`${p.label.padEnd(34)} ${String(p.done).padStart(3)}/${String(p.total).padEnd(3)} ${bar} ${pct === null ? '—' : `${pct}%`}${p.hint ? `  (${p.hint})` : ''}`);
  }
  console.log(`\nПробелы: уровень 1 — ${gaps.filter((g) => g.level === 1).length}, 2 — ${gaps.filter((g) => g.level === 2).length}, 3 — ${gaps.filter((g) => g.level === 3).length}`);
  const fresh = db.notes.filter((n) => n.status === 'new');
  if (fresh.length) console.log(`Неразобранное сырьё: ${fresh.map((n) => n.file).join(', ')}`);
} else if (cmd === 'show' && argv[1]) {
  await show(argv[1]);
} else if (cmd === 'apply' && argv[1]) {
  await apply(argv[1], has('dry'));
} else if (cmd === 'ops') {
  console.log('Пакет — JSON-массив операций: [{"op": "fact.create", ...поля}, …]. Проверяется целиком до записи.\n');
  for (const [k, v] of Object.entries(OPS)) console.log(`${k.padEnd(18)} ${v}`);
  console.log(`\nКатегории вопросов: ${QUESTION_CATEGORIES.map((c) => c[0]).join(', ')}`);
  console.log(`Компетенции: ${COMPETENCIES.map((c) => c[0]).join(', ')}`);
  const none = (what: string) => `нет — ${what}`;
  console.log(`Треки: ${db.recipes.map((r) => r.id).join(', ') || none('создай рецепт в CRM («Конструктор резюме»)')}`);
  console.log(`Опыт: ${db.experiences.map((e) => e.id).join(', ') || none('создай через experience.create')}`);
  console.log(`Теги фактов: ${[...new Set(db.facts.flatMap((f) => f.tags))].sort().join(', ') || none('появятся с первыми фактами')}`);
} else {
  const b = 'npm --prefix app run -s bank --';
  console.log(`Запускай из папки рабочего пространства:\n${b} gaps [--level 1] [--bank stories] [--limit 30] [--json]\n${b} stats\n${b} show <id>\n${b} apply <file.json | -> [--dry]\n${b} ops\n\nИз папки приложения то же самое: npm run -s bank -- …`);
}
