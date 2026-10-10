// Data check: file schemas and links between them. Used by `npm run check` and `npm run bank -- apply`.
import { db } from './store';
import { recipeIds } from '../shared/resume';
import { COMPETENCIES } from '../shared/schema';

/** List of problems in the loaded data; empty means all is well. */
export function validate(): string[] {
  const problems: string[] = db.errors.map((e) => `${e.file}: ${e.message}`);
  const facts = new Map(db.facts.map((f) => [f.id, f]));
  const exps = new Set(db.experiences.map((e) => e.id));
  const tracks = new Set(db.recipes.map((r) => r.id));
  const summaries = new Set(db.summaries.map((s) => s.id));

  const seen = new Set<string>();
  for (const f of db.facts) {
    if (seen.has(f.id)) problems.push(`факт ${f.id} встречается дважды`);
    seen.add(f.id);
    if (!f.text.trim()) problems.push(`факт ${f.id}: пустой текст`);
    for (const r of f.roles) if (!tracks.has(r)) problems.push(`факт ${f.id}: неизвестный трек ${r}`);
    if (f.derived_from && !facts.has(f.derived_from)) problems.push(`факт ${f.id}: derived_from ${f.derived_from} не найден`);
  }
  const checkRecipe = (where: string, r: { facts: Record<string, string[]>; summary: string }) => {
    if (r.summary && !summaries.has(r.summary)) problems.push(`${where}: нет саммари ${r.summary}`);
    for (const exp of Object.keys(r.facts)) if (!exps.has(exp)) problems.push(`${where}: нет опыта ${exp}`);
    for (const id of recipeIds(r as never)) {
      const f = facts.get(id);
      if (!f) problems.push(`${where}: нет факта ${id}`);
      else if (f.status === 'draft') problems.push(`${where}: черновик ${id} в рецепте`);
    }
  };
  for (const r of db.recipes) checkRecipe(`рецепт ${r.id}`, r);
  for (const a of db.apps.values()) {
    if (a.recipe) checkRecipe(`рецепт отклика ${a.id}`, a.recipe);
    if (a.track && !tracks.has(a.track)) problems.push(`отклик ${a.id}: неизвестный трек ${a.track}`);
    if (a.sent_lock && !a.locks.some((l) => l.hash === a.sent_lock)) problems.push(`отклик ${a.id}: sent_lock ${a.sent_lock} без lock-файла`);
    if (a.company && !db.companies.some((c) => c.slug === a.company)) problems.push(`отклик ${a.id}: нет компании ${a.company}`);
  }

  // interviews: questions, answers, stories, prep
  const stories = new Set(db.stories.map((s) => s.id));
  const questions = new Set<string>();
  const comps = new Set<string>(COMPETENCIES.map((c) => c[0]));
  const refs = (where: string, list: { stories?: string[]; facts?: string[] }) => {
    for (const id of list.stories || []) if (!stories.has(id)) problems.push(`${where}: нет истории ${id}`);
    for (const id of list.facts || []) if (!facts.has(id)) problems.push(`${where}: нет факта ${id}`);
  };
  for (const q of db.questions) {
    if (questions.has(q.id)) problems.push(`вопрос ${q.id} встречается дважды`);
    questions.add(q.id);
    if (!q.text.trim() && !q.ru?.trim()) problems.push(`вопрос ${q.id}: пустой текст`);
    if (q.competency && !comps.has(q.competency)) problems.push(`вопрос ${q.id}: неизвестная компетенция ${q.competency}`);
    for (const r of q.roles) if (!tracks.has(r)) problems.push(`вопрос ${q.id}: неизвестный трек ${r}`);
    q.answers.forEach((a, i) => {
      refs(`вопрос ${q.id}, ответ ${i + 1}`, a);
      for (const r of a.roles) if (!tracks.has(r)) problems.push(`вопрос ${q.id}, ответ ${i + 1}: неизвестный трек ${r}`);
    });
  }
  const sids = new Set<string>();
  for (const st of db.stories) {
    if (sids.has(st.id)) problems.push(`история ${st.id} встречается дважды`);
    sids.add(st.id);
    if (st.exp && !exps.has(st.exp)) problems.push(`история ${st.id}: нет опыта ${st.exp}`);
    for (const c of Object.keys(st.covers)) if (!comps.has(c)) problems.push(`история ${st.id}: неизвестная компетенция ${c}`);
    refs(`история ${st.id}`, st);
  }
  for (const f of db.facts) for (const sid of f.stories) if (!stories.has(sid)) problems.push(`факт ${f.id}: нет истории ${sid}`);
  for (const a of db.apps.values()) for (const i of a.prep.items) {
    const where = `подготовка ${a.id}, ${i.q || i.id}`;
    if (i.q && !questions.has(i.q)) problems.push(`${where}: нет вопроса в банке`);
    if (!i.q && !i.text?.trim()) problems.push(`${where}: свой вопрос без текста`);
    refs(where, i);
  }

  // strengths and weaknesses
  const questionIds = new Set(db.questions.map((q) => q.id));
  for (const [kind, list] of [['сильная сторона', db.strengths], ['слабое место', db.weaknesses]] as const) {
    const ids = new Set<string>();
    for (const x of list) {
      if (ids.has(x.id)) problems.push(`${kind} ${x.id} встречается дважды`);
      ids.add(x.id);
      for (const r of x.roles) if (!tracks.has(r)) problems.push(`${kind} ${x.id}: неизвестный трек ${r}`);
      refs(`${kind} ${x.id}`, x);
      for (const q of 'questions' in x ? x.questions : []) if (!questionIds.has(q)) problems.push(`${kind} ${x.id}: нет вопроса ${q}`);
    }
  }
  return problems;
}

export const summary = () =>
  `фактов ${db.facts.length} · опытов ${db.experiences.length} · рецептов ${db.recipes.length} · откликов ${db.apps.size} · компаний ${db.companies.length}` +
  ` · вопросов ${db.questions.length} · историй ${db.stories.length} · сильных ${db.strengths.length} · слабых ${db.weaknesses.length} · сырья ${db.notes.length}`;
