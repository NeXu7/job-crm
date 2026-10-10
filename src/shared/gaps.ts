// Fill queue: what is missing in the banks and in what order to close it.
// One logic for the «Наполнение» page and for `npm run bank -- gaps` in a Claude session.
// Levels: 1 — likely asked at the next interview or lands in the resume; 2 — important; 3 — when time allows.
import { COMPETENCIES, STAR_FIELDS, categoryName, competencyName, type AppState } from './schema';
import { coverage, questionStatus, storiesFor } from './interview';
import { recipeIds } from './resume';
import { stageIndex } from './pipeline';

export type GapBank = 'notes' | 'profile' | 'facts' | 'stories' | 'answers' | 'strengths' | 'weaknesses' | 'docs';
export const GAP_BANKS: [GapBank, string][] = [
  ['notes', 'Сырьё'], ['profile', 'Профиль'], ['facts', 'Факты'], ['stories', 'Истории'],
  ['answers', 'Ответы'], ['strengths', 'Сильные стороны'], ['weaknesses', 'Слабые места'], ['docs', 'Документы'],
];

export type Gap = {
  key: string;
  bank: GapBank;
  level: 1 | 2 | 3;
  /** What to do. */
  title: string;
  /** How to start the conversation: the question for the user. */
  ask?: string;
  /** Record id. */
  ref?: string;
  /** UI route (without #/). */
  link: string;
};

export type Progress = { bank: GapBank; label: string; done: number; total: number; hint?: string };

/** Share done, 0–100; null when there is nothing to count yet (0/0 is not «100%»). */
export const progressPct = (p: Pick<Progress, 'done' | 'total'>): number | null => (p.total ? Math.round((p.done / p.total) * 100) : null);
export type DocTodo = { file: string; line: number; text: string };

type Input = Pick<AppState, 'profile' | 'facts' | 'experiences' | 'stories' | 'questions' | 'strengths' | 'weaknesses' | 'notes' | 'applications' | 'recipes'>;

/** How to start the conversation when a competency has no story. */
export const COMPETENCY_ASK: Record<string, string> = {
  conflict: 'Вспомни реальный конфликт — с коллегой, заказчиком, внутри команды. Из-за чего, что сделал ты, чем закончилось?',
  influence: 'Когда ты добился решения, не имея формальной власти? Кого убеждал и чем?',
  failure: 'Что реально не получилось и имело последствия? Проект, решение, которое откатили, наём. В чём была причина?',
  prioritization: 'Когда пришлось резать важное ради главного? От чего отказался и как решал?',
  people: 'Назови конкретного человека, которого ты вырастил. Где он был и где стал?',
  team: 'Как ты собирал или перестраивал команду? Кого нанял, кого нет и почему?',
  'hard-talk': 'Был ли сложный разговор: слабый перформанс, увольнение, жёсткая обратная связь? Как прошёл?',
  client: 'Самая сложная ситуация с клиентом или заказчиком? Что было на кону и как развернул?',
  'tech-choice': 'Техническое решение, где выбирал из нескольких вариантов под ограничение. Что проиграло и почему?',
  roi: 'Где ты измерил эффект в деньгах или времени относительно базы? Что было до, что после?',
  'data-decision': 'Когда данные заставили тебя изменить решение? Что думал до и что увидел?',
  ambiguity: 'Когда постановка была совсем неясной? Как ты её прояснил и с чего начал?',
  ownership: 'Когда ты взял на себя то, что никому не принадлежало? Почему и что вышло?',
};

const PLACEHOLDER = /\[[^\]]{3,}\]|TODO/;
const words = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'слово' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'слова' : 'слов');

export function computeGaps(s: Input, docs: DocTodo[] = []): { gaps: Gap[]; progress: Progress[] } {
  const gaps: Gap[] = [];
  const add = (g: Gap) => gaps.push(g);

  // ---------- raw notes ----------
  for (const n of s.notes.filter((x) => x.status === 'new')) {
    add({ key: `note:${n.file}`, bank: 'notes', level: 1, title: `Разобрать сырьё «${n.title}» (${n.words} ${words(n.words)}) в банки`, ref: n.file, link: 'fill' });
  }

  // ---------- profile ----------
  const c = s.profile.contacts || {};
  const missing = [!c.email && 'email', !c.linkedin && 'LinkedIn'].filter(Boolean) as string[];
  if (missing.length) add({ key: 'profile:contacts', bank: 'profile', level: 1, title: `Контакты в шапке резюме: ${missing.join(', ')}`, ask: `${missing.length > 1 ? 'Какие' : 'Какой'} ${missing.join(' и ')} ставим в резюме?`, link: 'facts/profile' });

  // ---------- facts ----------
  // A fresh workspace: nothing else in the fact bank can be filled before the workplaces exist.
  if (!s.experiences.length) add({
    key: 'exp:none', bank: 'facts', level: 1, link: 'facts',
    title: 'Добавить места работы: банк фактов пуст',
    ask: 'Где ты работал? Для каждого места — компания, должность, годы. Заведи их в «Банк фактов» → «+ Опыт» или пройди /fill в Claude Code: он начнёт с мест работы. Старое резюме можно сбросить в сырьё («Наполнение» → «Сбросить сырьё»).',
  });
  const inBase = new Set(s.recipes.flatMap((r) => recipeIds(r)));
  for (const f of s.facts) {
    if (f.status === 'needs-proof') add({
      key: `fact:${f.id}`, bank: 'facts', level: inBase.has(f.id) ? 1 : 2, ref: f.id, link: `facts/${f.exp}`,
      title: `Подкрепить факт ${f.id}${inBase.has(f.id) ? ' — он в базовом резюме' : ''}`, ask: f.note || `Откуда цифра в «${f.ru || f.text}»? Что мерили и относительно чего?`,
    });
    if (f.status === 'draft') add({ key: `fact:${f.id}`, bank: 'facts', level: 2, ref: f.id, link: `facts/${f.exp}`, title: `Черновик факта ${f.id}: подтвердить, поправить или удалить`, ask: f.note });
  }
  for (const e of s.experiences) {
    const ok = s.facts.filter((f) => f.exp === e.id && f.status === 'verified').length;
    if (e.kind === 'job' && ok < 2) add({ key: `exp:${e.id}`, bank: 'facts', level: 3, ref: e.id, link: `facts/${e.id}`, title: `${e.org}: проверенных фактов ${ok}`, ask: `${e.org}: какая была главная задача, что сделал сам и чем это измерялось?` });
  }
  const reqSeen = new Set<string>();
  for (const a of s.applications) {
    if (a.stage === 'closed') continue;
    for (const r of a.requirements) {
      if (r.fact_ids.length || reqSeen.has(r.text)) continue;
      reqSeen.add(r.text);
      add({ key: `req:${a.id}:${r.text}`, bank: 'facts', level: r.must ? 2 : 3, ref: a.id, link: `app/${a.id}/overview`, title: `Нет факта под требование «${r.text}» (${a.company_name || a.id})`, ask: `Было ли у тебя что-то про «${r.text}»? Конкретный случай и результат.` });
    }
  }

  // ---------- stories ----------
  const cov = coverage(s.stories, s.questions);
  for (const g of cov.filter((x) => x.gap)) {
    const high = g.questions.some((q) => q.priority === 'high');
    add({ key: `comp:${g.id}`, bank: 'stories', level: high ? 1 : 2, ref: g.id, link: 'interview/stories', title: `Нужна история: ${g.name.toLowerCase()}${g.level === 1 ? ' (есть только частичная)' : ''}`, ask: COMPETENCY_ASK[g.id] });
  }
  for (const st of s.stories) {
    const empty = STAR_FIELDS.filter(([k]) => k !== 'situation' && !st[k].trim());
    if (empty.length) {
      const [, label, hint] = empty[0];
      add({ key: `story:${st.id}`, bank: 'stories', level: 2, ref: st.id, link: 'interview/stories', title: `${st.id} «${st.title}»: не заполнено ${empty.map((x) => x[1]).join(', ')}`, ask: `${st.id}, ${label}: ${hint}.${st.note ? ` Из заметки: ${st.note}` : ''}` });
    } else if (st.status !== 'ready') add({ key: `story:${st.id}`, bank: 'stories', level: 3, ref: st.id, link: 'interview/stories', title: `${st.id}: всё заполнено — перечитать вслух и отметить «Готова»` });
    if (!st.facts.length) add({ key: `story-facts:${st.id}`, bank: 'stories', level: 3, ref: st.id, link: 'interview/stories', title: `${st.id}: нет фактов с цифрами`, ask: `${st.id}: какой измеримый результат у этой истории?` });
  }

  // ---------- answers ----------
  const asked = new Set(s.applications.flatMap((a) => a.prep.items.filter((i) => i.q && i.asked).map((i) => i.q!)));
  for (const q of s.questions) {
    if (q.category === 'reverse' || q.app_field) continue;
    const st = questionStatus(q);
    const label = q.ru || q.text;
    const link = `interview/${q.category}`;
    if (asked.has(q.id) && st !== 'ready') { add({ key: `q:${q.id}`, bank: 'answers', level: 1, ref: q.id, link, title: `Спрашивали на интервью, ответ не готов: «${label}»`, ask: q.note }); continue; }
    if (st === 'none') {
      const anchor = q.answers.flatMap((a) => a.stories).concat(storiesFor(q.competency, s.stories).filter((x) => (x.covers[q.competency!] ?? 0) === 2).map((x) => x.id));
      const uniq = [...new Set(anchor)].slice(0, 2);
      const opora = uniq.length ? `Опора есть: ${uniq.map((id) => `${id} «${s.stories.find((x) => x.id === id)?.title || ''}»`).join(', ')} — написать ответ на её основе.` : '';
      add({ key: `q:${q.id}`, bank: 'answers', level: q.priority === 'high' ? 1 : 3, ref: q.id, link, title: `Нет ответа (${categoryName(q.category)}${q.competency ? `, ${competencyName(q.competency)}` : ''}): «${label}»`, ask: [opora, q.note].filter(Boolean).join(' ') || undefined });
    }
    else if (q.answers.some((a) => PLACEHOLDER.test(a.text))) add({ key: `q:${q.id}`, bank: 'answers', level: q.priority === 'high' ? 1 : 2, ref: q.id, link, title: `В ответе пропуски [ ] или TODO: «${label}»` });
    else if (st === 'draft' && q.priority === 'high') add({ key: `q:${q.id}`, bank: 'answers', level: 2, ref: q.id, link, title: `Черновик ответа — проговорить вслух и отметить «Готов»: «${label}»` });
  }
  // active processes: questions Claude picked for the vacancy that have no answer
  for (const a of s.applications) {
    if (a.stage === 'closed' || stageIndex(a.stage) < stageIndex('applied')) continue;
    const open = a.prep.items.filter((i) => !i.q && !i.hidden && !i.answer?.trim()).length;
    if (open) add({ key: `prep:${a.id}`, bank: 'answers', level: stageIndex(a.stage) >= stageIndex('screen') ? 1 : 2, ref: a.id, link: `app/${a.id}/prep`, title: `${a.company_name || a.id}: ${open} вопросов под вакансию без ответа` });
  }

  // ---------- strengths and weaknesses ----------
  for (const x of s.strengths) {
    const link = 'interview/sides';
    if (!x.pitch.trim()) add({ key: `str:${x.id}`, bank: 'strengths', level: 2, ref: x.id, link, title: `Сильная сторона: ${x.title} — нет формулировки для интервью`, ask: `Как ты скажешь про «${x.title}» одной-двумя фразами по-английски?` });
    else if (!x.facts.length && !x.stories.length) add({ key: `str:${x.id}`, bank: 'strengths', level: 2, ref: x.id, link, title: `Сильная сторона: ${x.title} — нет доказательств`, ask: `Чем докажешь «${x.title}»? Факт или история.` });
    else if (x.status !== 'ready') add({ key: `str:${x.id}`, bank: 'strengths', level: 3, ref: x.id, link, title: `Сильная сторона: ${x.title} — проверить и отметить «Готов»` });
  }
  for (const x of s.weaknesses) {
    const link = 'interview/sides';
    if (!x.counter.trim()) add({ key: `weak:${x.id}`, bank: 'weaknesses', level: 1, ref: x.id, link, title: `Слабое место: ${x.title} — нет заготовки ответа`, ask: x.note || `Что отвечаешь, когда спрашивают: ${x.sounds || x.title}?` });
    else if (x.status !== 'ready') add({ key: `weak:${x.id}`, bank: 'weaknesses', level: 2, ref: x.id, link, title: `Слабое место: ${x.title} — заготовка есть, проговорить и отметить «Готов»` });
  }
  if (!s.strengths.length) add({ key: 'str:none', bank: 'strengths', level: 1, link: 'interview/sides', title: 'Нет ни одной сильной стороны', ask: 'Три вещи, за которые тебя стоит нанять, — и чем каждая доказана?' });

  // ---------- documents ----------
  for (const d of docs) add({ key: `doc:${d.file}:${d.line}`, bank: 'docs', level: 3, ref: `${d.file}:${d.line}`, link: 'fill', title: `${d.file}:${d.line} — ${d.text}` });

  gaps.sort((a, b) => a.level - b.level);

  // ---------- progress ----------
  const answerable = s.questions.filter((q) => q.category !== 'reverse' && !q.app_field);
  const high = answerable.filter((q) => q.priority === 'high');
  const starTotal = s.stories.length * (STAR_FIELDS.length - 1);
  const starFilled = s.stories.reduce((n, st) => n + STAR_FIELDS.filter(([k]) => k !== 'situation' && st[k].trim()).length, 0);
  const progress: Progress[] = [
    { bank: 'facts', label: 'Факты проверены', done: s.facts.filter((f) => f.status === 'verified').length, total: s.facts.length },
    { bank: 'stories', label: 'Поля STAR в историях', done: starFilled, total: starTotal, hint: `готовых историй: ${s.stories.filter((x) => x.status === 'ready').length} из ${s.stories.length}` },
    { bank: 'stories', label: 'Компетенции с сильной историей', done: cov.filter((x) => x.level === 2).length, total: COMPETENCIES.length },
    { bank: 'answers', label: 'Частые вопросы: ответ готов', done: high.filter((q) => questionStatus(q) === 'ready').length, total: high.length, hint: `с черновиком: ${high.filter((q) => questionStatus(q) === 'draft').length}` },
    { bank: 'answers', label: 'Все вопросы: есть ответ', done: answerable.filter((q) => questionStatus(q) !== 'none').length, total: answerable.length },
    { bank: 'strengths', label: 'Сильные стороны готовы', done: s.strengths.filter((x) => x.status === 'ready').length, total: s.strengths.length },
    { bank: 'weaknesses', label: 'Слабые места: есть заготовка', done: s.weaknesses.filter((x) => x.counter.trim()).length, total: s.weaknesses.length },
  ];
  return { gaps, progress };
}
