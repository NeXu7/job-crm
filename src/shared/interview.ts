// Interview prep: which questions are likely for a vacancy, which answer to show, which stories fit.
// The list is computed on the fly from the question bank and the application card; prep.yaml stores
// only what a person or Claude decided (vacancy-specific answer, «спросили», hidden, Claude's picks).
import {
  COMPETENCIES, prepKey,
  type Answer, type AnswerStatus, type Application, type PrepItem, type Question, type QuestionCategory, type Story,
} from './schema';

export type Reason = { kind: 'asked' | 'pinned' | 'manual' | 'interview' | 'claude' | 'always' | 'track' | 'req'; text: string };

export type PrepEntry = {
  key: string;
  q?: Question;
  item?: PrepItem;
  text: string;
  ru?: string;
  category: QuestionCategory;
  competency?: string;
  reasons: Reason[];
  score: number;
  answer: ResolvedAnswer;
  /** Stories: those chosen in the answer, otherwise those matching the competency. */
  stories: string[];
  facts: string[];
  asked?: string;
  hidden: boolean;
  /** 1 — likely for this vacancy; 2 — also relevant, shown collapsed. */
  tier: 1 | 2;
};

export type ResolvedAnswer = {
  text: string;
  /** app — answer for this vacancy; field — from the card («почему они / почему я»); bank — from the bank; none — absent. */
  from: 'app' | 'field' | 'bank' | 'none';
  status?: AnswerStatus;
  label?: string;
  index?: number;
};

const hasText = (a: Answer) => a.text.trim().length > 0;

/** Bank answer variant for a track: the one tagged with this track first, then a generic one, then any. */
export function answerFor(q: Question, track?: string): { answer: Answer; index: number } | null {
  const list = q.answers.map((answer, index) => ({ answer, index })).filter((x) => hasText(x.answer));
  return (
    (track && list.find((x) => x.answer.roles.includes(track))) ||
    list.find((x) => !x.answer.roles.length) ||
    list[0] ||
    null
  );
}

/** Readiness of a bank question: the best status among its answer variants. */
export function questionStatus(q: Question): 'field' | 'ready' | 'draft' | 'none' {
  if (q.app_field) return 'field';
  const filled = q.answers.filter(hasText);
  if (filled.some((a) => a.status === 'ready')) return 'ready';
  return filled.length ? 'draft' : 'none';
}

/** Stories that cover a competency: full coverage first, then partial. */
export function storiesFor(competency: string | undefined, stories: Story[]) {
  if (!competency) return [];
  return stories
    .filter((s) => (s.covers[competency] ?? 0) > 0)
    .sort((a, b) => (b.covers[competency] ?? 0) - (a.covers[competency] ?? 0) || (b.status === 'ready' ? 1 : 0) - (a.status === 'ready' ? 1 : 0));
}

/** Coverage matrix: competency → best level and stories. A gap is a competency with no level-2 story. */
export function coverage(stories: Story[], questions: Question[]) {
  return COMPETENCIES.map(([id, name]) => {
    const list = storiesFor(id, stories);
    const level = Math.max(0, ...list.map((s) => s.covers[id] ?? 0));
    const asks = questions.filter((q) => q.competency === id);
    return { id, name, level, stories: list, questions: asks, gap: level < 2 && asks.length > 0 };
  });
}

function resolveAnswer(a: Application, q: Question | undefined, item: PrepItem | undefined): ResolvedAnswer {
  if (item?.answer?.trim()) return { text: item.answer, from: 'app' };
  if (q?.app_field) {
    const v = a[q.app_field];
    if (v.trim()) return { text: v, from: 'field' };
  }
  if (q) {
    const hit = answerFor(q, a.track);
    if (hit) return { text: hit.answer.text, from: 'bank', status: hit.answer.status, label: hit.answer.label, index: hit.index };
  }
  return { text: '', from: 'none' };
}

const PRIORITY_SCORE = { high: 20, medium: 3, low: 0 } as const;
const AUTO_LIMIT = 12;

/**
 * Questions for a vacancy: from the bank by rules + Claude's picks + custom ones.
 * Likely (tier 1): always-asked, marked by a person, Claude's picks, custom. Until Claude has picked, also
 * track questions and requirement matches. Other relevant ones go to tier 2. Sorted by weight within a tier.
 */
export function buildPrep(a: Application, questions: Question[], stories: Story[], trackName?: string): { entries: PrepEntry[]; more: PrepEntry[]; hidden: PrepEntry[] } {
  const items = new Map(a.prep.items.map((i) => [prepKey(i), i]));
  const reqTags = a.requirements.map((r) => ({ r, tags: new Set(r.tags) }));
  const claudeDone = a.prep.claude.status === 'done';
  const out: PrepEntry[] = [];
  const candidates = new Set<string>();

  for (const q of questions) {
    const item = items.get(q.id);
    const reasons: Reason[] = [];
    let score = PRIORITY_SCORE[q.priority];
    if (item?.asked) { reasons.push({ kind: 'asked', text: 'спросили' }); score += 100; }
    if (item?.pinned) { reasons.push({ kind: 'pinned', text: 'добавлен вручную' }); score += 50; }
    if (item?.why) { reasons.push({ kind: 'claude', text: item.why }); score += 30; }
    if (q.priority === 'high') reasons.push({ kind: 'always', text: 'спрашивают почти всегда' });
    const trackHit = !!a.track && q.roles.includes(a.track);
    if (trackHit) { reasons.push({ kind: 'track', text: `трек ${trackName || a.track}` }); score += 10; }
    const reqHits = q.tags.length ? reqTags.filter((x) => q.tags.some((t) => x.tags.has(t))) : [];
    reqHits.slice(0, 2).forEach((x) => { reasons.push({ kind: 'req', text: `требование: ${x.r.text}` }); score += 8; });

    const touched = !!item && !!(item.asked || item.pinned || item.why || item.answer?.trim());
    const forced = touched || q.priority === 'high';
    const candidate = !claudeDone && q.priority !== 'low' && (trackHit || reqHits.length > 0);
    const fits = (q.priority === 'medium' && (!q.roles.length || trackHit)) || reqHits.length > 0 || (q.priority === 'low' && trackHit);
    if (!forced && !candidate && !fits && !item?.hidden) continue;
    if (candidate && !forced) candidates.add(q.id);

    const answer = resolveAnswer(a, q, item);
    const anchor = answer.from === 'bank' ? q.answers[answer.index!] : q.answers.find((x) => x.stories.length || x.facts.length);
    const chosen = item?.stories.length ? item.stories : anchor?.stories ?? [];
    out.push({
      key: q.id, q, item, text: q.text, ru: q.ru, category: q.category, competency: q.competency,
      reasons, score, answer,
      stories: chosen.length ? chosen : storiesFor(q.competency, stories).slice(0, 2).map((s) => s.id),
      facts: item?.facts.length ? item.facts : anchor?.facts ?? [],
      asked: item?.asked, hidden: !!item?.hidden, tier: forced ? 1 : 2,
    });
  }

  for (const item of a.prep.items) {
    if (item.q) continue;
    const reasons: Reason[] = [];
    let score = 40;
    if (item.asked) { reasons.push({ kind: 'asked', text: 'спросили' }); score += 100; }
    if (item.source === 'claude' && item.why) reasons.push({ kind: 'claude', text: item.why });
    else if (item.source === 'interview') reasons.push({ kind: 'interview', text: 'записан после интервью' });
    else reasons.push({ kind: 'manual', text: 'свой вопрос' });
    out.push({
      key: prepKey(item), item, text: item.text || '', ru: item.ru, category: (item.category as QuestionCategory) || 'specific',
      competency: item.competency, reasons, score, answer: resolveAnswer(a, undefined, item),
      stories: item.stories.length ? item.stories : storiesFor(item.competency, stories).slice(0, 2).map((s) => s.id),
      facts: item.facts, asked: item.asked, hidden: !!item.hidden, tier: 1,
    });
  }

  out.sort((x, y) => y.score - x.score);
  // until Claude has picked, add the best track and requirement matches to the always-asked ones, up to the limit
  out.filter((e) => candidates.has(e.key) && !e.hidden).slice(0, AUTO_LIMIT).forEach((e) => { e.tier = 1; });
  return {
    entries: out.filter((e) => !e.hidden && e.tier === 1),
    more: out.filter((e) => !e.hidden && e.tier === 2),
    hidden: out.filter((e) => e.hidden),
  };
}

/** Where a bank question was asked at an interview: across all applications. */
export function askedIndex(apps: Application[]) {
  const m = new Map<string, { app: Application; date: string; at?: string }[]>();
  for (const a of apps) for (const i of a.prep.items) {
    if (!i.q || !i.asked) continue;
    m.set(i.q, [...(m.get(i.q) || []), { app: a, date: i.asked, at: i.asked_at }]);
  }
  return m;
}

/** Whether a prep item is empty: if so, it need not be stored. */
export function isEmptyItem(i: PrepItem) {
  if (!i.q) return false;
  return !(i.answer?.trim() || i.asked || i.hidden || i.pinned || i.why || i.angle || i.stories.length || i.facts.length || i.practice);
}
