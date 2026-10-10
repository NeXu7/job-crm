// Shared interview UI pieces: story and fact pickers, answer status, Claude's draft, rehearsal.
import { useState, type ReactNode } from 'react';
import { href } from '../router';
import { Markdown, Modal } from '../ui';
import type { State } from '../store';
import type { Story } from '../../shared/schema';

/** Links to stories or facts: chips + a dropdown to add more. */
export function RefPicker({ value, options, onChange, add = '+ добавить', link }: {
  value: string[]; options: [string, string][]; onChange: (v: string[]) => void; add?: string; link?: (id: string) => string;
}) {
  const label = new Map(options);
  return (
    <div className="refs">
      {value.map((id) => (
        <span className="ref" key={id} title={label.get(id) || 'нет такой записи'}>
          {link ? <a href={link(id)} className="id">{id}</a> : <span className="id">{id}</span>}
          <span className="ref-t">{label.get(id) || '—'}</span>
          <button type="button" aria-label={`Убрать ${id}`} onClick={() => onChange(value.filter((x) => x !== id))}>×</button>
        </span>
      ))}
      <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label={add}>
        <option value="">{add}</option>
        {options.filter(([id]) => !value.includes(id)).map(([id, t]) => <option key={id} value={id}>{id} — {t.slice(0, 70)}</option>)}
      </select>
    </div>
  );
}

export const storyOptions = (s: State): [string, string][] => s.stories.map((x) => [x.id, x.title]);
export const factOptions = (s: State): [string, string][] => s.facts.filter((f) => f.status !== 'draft').map((f) => [f.id, f.ru || f.short || f.text]);
export const storyLink = () => href('interview/stories');
export const factLink = (s: State) => (id: string) => href(`facts/${s.facts.find((f) => f.id === id)?.exp || ''}`);

const ANSWER_PILL = {
  ready: ['good', '✓', 'готов'],
  draft: ['accent', '✎', 'черновик'],
  none: ['warn', '!', 'нет ответа'],
  field: ['', '↗', 'из карточки отклика'],
  app: ['good', '✓', 'под вакансию'],
} as const;
export function AnswerPill({ kind }: { kind: keyof typeof ANSWER_PILL }) {
  const [cls, icon, text] = ANSWER_PILL[kind];
  return <span className={`pill ${cls}`}><i>{icon}</i>{text}</span>;
}

/** Latest rehearsal score. */
export function PracticeMark({ p }: { p?: { date: string; score: number } }) {
  if (!p) return null;
  const t = ['плавал', 'нормально', 'уверенно'][p.score];
  return <span className={`pill ${p.score === 2 ? 'good' : p.score === 0 ? 'warn' : ''}`} title={`Тренировка ${p.date}`}>тренировка: {t}</span>;
}

export type Draft = { text: string; stories: string[]; facts: string[]; missing: string[] };

/** Claude's answer draft: we show it, the person decides what to do with it. */
export function DraftBox({ d, s, actions, onClose }: { d: Draft; s: State; actions: ReactNode; onClose: () => void }) {
  const st = new Map(s.stories.map((x) => [x.id, x.title]));
  return (
    <div className="draft">
      <div className="row between"><b>Черновик Claude</b><button className="icon-btn" aria-label="Закрыть черновик" onClick={onClose}>✕</button></div>
      <Markdown text={d.text} />
      {(d.stories.length > 0 || d.facts.length > 0) && (
        <div className="row small">
          {d.stories.map((id) => <span key={id} className="id" title={st.get(id)}>{id}</span>)}
          {d.facts.map((id) => <span key={id} className="id">{id}</span>)}
        </div>
      )}
      {d.missing.length > 0 && <div className="callout warn"><b>Не хватает материала:</b><ul className="list">{d.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
      <div className="row">{actions}</div>
    </div>
  );
}

export type Card = { key: string; text: string; ru?: string; answer: string; stories: string[]; note?: string; practice?: { date: string; score: number } };

/** Rehearsal: question → answer aloud → show the prepared answer → self-rate. */
export function Rehearse({ cards, stories, onScore, onClose }: { cards: Card[]; stories: Story[]; onScore: (key: string, score: number) => void; onClose: () => void }) {
  // first what hasn't been rehearsed, then the weak ones, then the long-untouched. Order is fixed at start:
  // scoring updates the data, and re-sorting mid-rehearsal would throw off the counter.
  const [order] = useState(() => [...cards].sort((a, b) =>
    (a.practice ? 1 : 0) - (b.practice ? 1 : 0) || (a.practice?.score ?? 0) - (b.practice?.score ?? 0) || (a.practice?.date || '').localeCompare(b.practice?.date || '')));
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const c = order[i];
  const next = (score?: number) => {
    if (score !== undefined) { onScore(c.key, score); setDone([...done, score]); }
    setShown(false);
    setI(i + 1);
  };
  const st = new Map(stories.map((x) => [x.id, x]));
  return (
    <Modal onClose={onClose} title={<>Тренировка <span className="muted">{Math.min(i + 1, order.length)} из {order.length}</span></>}>
      {!c ? (
        <div className="stack">
          <p>Готово. Уверенно: {done.filter((x) => x === 2).length}, нормально: {done.filter((x) => x === 1).length}, плавал: {done.filter((x) => x === 0).length}.</p>
          <p className="hint">Вопросы, где плавал, в следующий раз пойдут первыми.</p>
          <div><button className="btn primary" onClick={onClose}>Закрыть</button></div>
        </div>
      ) : (
        <div className="rehearse">
          <p className="rq">{c.text}</p>
          {c.ru && <p className="muted">{c.ru}</p>}
          {!shown ? (
            <>
              <p className="hint">Ответь вслух, как на интервью: прямой ответ, история, цифра, вывод. Потом сверься с заготовкой.</p>
              <div className="row"><button className="btn primary" autoFocus onClick={() => setShown(true)}>Показать заготовку</button><button className="btn ghost" onClick={() => next()}>Пропустить</button></div>
            </>
          ) : (
            <>
              <div className="panel">
                {c.answer.trim() ? <Markdown text={c.answer} /> : <p className="hint">Заготовки нет — ответ ещё не написан.</p>}
                {c.stories.length > 0 && <p className="small">Опора: {c.stories.map((id) => `${id} ${st.get(id)?.title || ''}`).join(' · ')}</p>}
                {c.note && <p className="hint">{c.note}</p>}
              </div>
              <div className="row">
                <span className="hint">Как получилось?</span>
                <button className="btn" onClick={() => next(0)}>Плавал</button>
                <button className="btn" onClick={() => next(1)}>Нормально</button>
                <button className="btn primary" onClick={() => next(2)}>Уверенно</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
