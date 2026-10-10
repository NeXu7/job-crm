// Interview prep for a specific vacancy: likely questions, answers for it, «спросили», rehearsal.
import { useMemo, useState } from 'react';
import { api } from '../api';
import { act, toast, type State } from '../store';
import { href } from '../router';
import { AutoText, ConfirmButton, Markdown, Seg, copyText, fmtDate, plural } from '../ui';
import { AnswerPill, DraftBox, PracticeMark, RefPicker, Rehearse, factLink, factOptions, storyOptions, type Draft } from '../components/Interview';
import { QUESTION_CATEGORIES, categoryName, competencyName, type Application, type PrepItem, type QuestionCategory } from '../../shared/schema';
import { buildPrep, type PrepEntry } from '../../shared/interview';

const ORDER: QuestionCategory[] = ['specific', ...QUESTION_CATEGORIES.map((c) => c[0])];
const ROUNDS = ['скрининг', 'HM', 'техническое', 'кейс', 'behavioral', 'финал'];

const itemUrl = (a: Application, key: string) => `/api/applications/${a.id}/prep/items/${encodeURIComponent(key)}`;
const patchItem = (a: Application, key: string, p: Partial<Record<keyof PrepItem, unknown>>, ok?: string) => act(() => api.put(itemUrl(a, key), p), ok);

export function Prep({ a, s }: { a: Application; s: State }) {
  const trackName = s.recipes.find((r) => r.id === a.track)?.name;
  const { entries, more, hidden } = useMemo(() => buildPrep(a, s.questions, s.stories, trackName), [a, s.questions, s.stories, trackName]);
  const [filter, setFilter] = useState<'all' | 'open' | 'asked'>('all');
  const [rehearse, setRehearse] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const busy = a.prep.claude.status === 'running' || a.prep.claude.status === 'pending';
  const answered = entries.filter((e) => e.answer.from !== 'none' && e.category !== 'reverse').length;
  const askedN = entries.filter((e) => e.asked).length;
  const answerable = entries.filter((e) => e.category !== 'reverse');
  const shown = entries.filter((e) => filter === 'all' || (filter === 'open' ? e.answer.from === 'none' && e.category !== 'reverse' : !!e.asked));
  const groups = ORDER.map((c) => [c, shown.filter((e) => e.category === c)] as const).filter(([, l]) => l.length);

  const cheatSheet = () => {
    const lines = [`# ${a.company_name} — ${a.role}`, ''];
    for (const c of ORDER) {
      const list = entries.filter((e) => e.category === c);
      if (!list.length) continue;
      lines.push(`## ${categoryName(c)}`, '');
      for (const e of list) {
        lines.push(`**${e.text}**`);
        if (e.answer.text.trim()) lines.push(e.answer.text.trim());
        else if (e.item?.angle) lines.push(`_Тезисы:_ ${e.item.angle}`);
        if (e.stories.length) lines.push(`_Опора:_ ${e.stories.map((id) => `${id} ${s.stories.find((x) => x.id === id)?.title || ''}`).join('; ')}`);
        lines.push('');
      }
    }
    void copyText(lines.join('\n')).then((ok) => toast(ok ? 'Шпаргалка скопирована в Markdown' : 'Не удалось скопировать'));
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-h">
          <div className="strip" style={{ margin: 0 }}>
            <div className="stat"><b>{entries.length}</b><span>вероятных вопросов</span></div>
            <div className="stat"><b>{answered}/{answerable.length}</b><span>с ответом</span></div>
            <div className="stat"><b>{askedN}</b><span>спросили</span></div>
          </div>
          <div className="row">
            {busy && <span className="pill accent"><span className="spin" />Claude подбирает вопросы</span>}
            {a.prep.claude.status === 'done' && <span className="pill good" title={a.prep.claude.model}><i>✓</i>Claude подобрал {fmtDate(a.prep.claude.at)}</span>}
            {a.prep.claude.status === 'failed' && <span className="pill bad" title={a.prep.claude.error}><i>!</i>подбор не удался</span>}
            <button className="btn sm" disabled={busy || s.claude.status !== 'ok' || (!a.files.md && !a.requirements.length)}
              title={s.claude.status !== 'ok' ? 'Claude не подключён' : !a.files.md && !a.requirements.length ? 'Нет текста вакансии' : 'Claude выберет вопросы из банка и добавит вопросы под эту вакансию'}
              onClick={() => void act(() => api.post(`/api/applications/${a.id}/prep/generate`), 'Отдал Claude подбор вопросов')}>
              {a.prep.claude.status === 'done' ? 'Подобрать заново' : 'Подобрать вопросы с Claude'}
            </button>
            <button className="btn sm" onClick={cheatSheet}>Шпаргалка</button>
            <button className="btn sm primary" disabled={!answerable.length} onClick={() => setRehearse(true)}>Тренировка</button>
          </div>
        </div>
        {a.prep.claude.status === 'failed' && <div className="callout bad">Подбор: {a.prep.claude.error}</div>}
        {a.prep.claude.status !== 'done' && !busy && <p className="hint">Сейчас список собран по правилам: вопросы, которые задают почти всегда, плюс лучшие совпадения по треку{trackName ? ` (${trackName})` : ''} и требованиям вакансии. Claude сузит его под эту вакансию и добавит вопросы про их продукт и про зазоры между требованиями и твоим профилем.</p>}
        <div className="row">
          <Seg value={filter} onChange={setFilter} options={[['all', 'Все'], ['open', 'Без ответа'], ['asked', 'Спросили']]} />
          <span className="hint">«Шпаргалка» копирует вопросы с ответами в Markdown — перед созвоном.</span>
        </div>
      </section>

      <Sides a={a} s={s} />

      {groups.map(([c, list]) => (
        <section className="f-exp" key={c}>
          <div className="f-exp-h"><span><b>{categoryName(c)}</b> <span className="muted">{list.length}</span></span></div>
          {list.map((e) => <PrepRow key={e.key} e={e} a={a} s={s} />)}
        </section>
      ))}
      {!groups.length && <p className="hint">Под фильтр ничего не подходит.</p>}

      {a.questions.length > 0 && filter === 'all' && (
        <section className="panel">
          <h3>Выяснить у них — из разбора вакансии</h3>
          <ul className="list">{a.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          <p className="hint">Это то, что неясно из текста вакансии. Хорошие кандидаты в «Мои вопросы» на интервью.</p>
        </section>
      )}

      <AddQuestion a={a} s={s} />

      {more.length > 0 && (
        <section className="panel">
          <button className="link panel-h" onClick={() => setShowMore(!showMore)} aria-expanded={showMore}><h3>Ещё подходят из банка · {more.length}</h3><span className="hint">{showMore ? 'свернуть' : 'показать'}</span></button>
          {showMore && <div className="mini-list">{more.map((e) => (
            <div className="mini" key={e.key}>
              <span><span className="tag">{categoryName(e.category)}</span> {e.text} <span className="muted">{e.reasons.map((r) => r.text).join(' · ')}</span></span>
              <button className="btn sm" onClick={() => void patchItem(a, e.key, { pinned: true })}>+ в подготовку</button>
            </div>
          ))}</div>}
        </section>
      )}
      {hidden.length > 0 && (
        <details className="panel">
          <summary><h3 style={{ display: 'inline' }}>Скрытые · {hidden.length}</h3></summary>
          <div className="mini-list">{hidden.map((e) => (
            <div className="mini" key={e.key}><span>{e.text}</span><button className="btn sm" onClick={() => void patchItem(a, e.key, { hidden: null })}>Вернуть</button></div>
          ))}</div>
        </details>
      )}

      {rehearse && <Rehearse
        cards={answerable.map((e) => ({ key: e.key, text: e.text, ru: e.ru, answer: e.answer.text || e.item?.angle || '', stories: e.stories, note: e.q?.note, practice: e.q ? e.q.practice : e.item?.practice }))}
        stories={s.stories} onClose={() => setRehearse(false)}
        onScore={(key, score) => {
          const practice = { date: s.today, score };
          const isBank = s.questions.some((q) => q.id === key);
          void act(() => (isBank ? api.put(`/api/questions/${encodeURIComponent(key)}`, { practice, message: `тренировка: ${key}` }) : api.put(itemUrl(a, key), { practice })));
        }} />}
    </div>
  );
}

function PrepRow({ e, a, s }: { e: PrepEntry; a: Application; s: State }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState('');
  const reverse = e.category === 'reverse';
  const custom = !e.q;
  const kind = reverse ? null : e.answer.from === 'app' ? 'app' : e.answer.from === 'field' ? 'field' : e.answer.from === 'bank' ? (e.answer.status === 'ready' ? 'ready' : 'draft') : 'none';
  const save = (p: Partial<Record<keyof PrepItem, unknown>>, ok?: string) => patchItem(a, e.key, p, ok);
  const askClaude = async () => {
    setBusy(true);
    const d = await act(() => api.post<Draft>(`${itemUrl(a, e.key)}/draft`));
    setBusy(false);
    if (d) setDraft(d);
  };
  const st = new Map(s.stories.map((x) => [x.id, x]));
  const claudeWhy = e.reasons.find((r) => r.kind === 'claude');
  return (
    <article className={`qc ${open ? 'open' : ''} ${e.asked ? 'asked' : ''}`}>
      <button type="button" className="qc-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="qc-t"><b>{e.text}</b>{e.ru && <span className="muted">{e.ru}</span>}</span>
        <span className="qc-m">
          {kind && <AnswerPill kind={kind} />}
          {e.asked && <span className="pill accent">спросили {fmtDate(e.asked)}{e.item?.asked_at ? ` · ${e.item.asked_at}` : ''}</span>}
          {e.reasons.filter((r) => r.kind !== 'asked' && r.kind !== 'always').slice(0, 2).map((r, i) => <span key={i} className={`tag ${r.kind === 'claude' ? 'claude' : ''}`} title={r.text}>{r.kind === 'claude' ? 'Claude' : r.text.length > 48 ? r.text.slice(0, 46) + '…' : r.text}</span>)}
          {e.competency && <span className="tag">{competencyName(e.competency)}</span>}
          <PracticeMark p={e.q ? e.q.practice : e.item?.practice} />
        </span>
      </button>
      {open && (
        <div className="stack tight qc-b">
          {claudeWhy && <div className="callout"><b>Почему спросят:</b> {claudeWhy.text}{e.item?.angle && <><br /><b>Тезисы Claude:</b> {e.item.angle}</>}</div>}
          {!claudeWhy && e.item?.angle && <div className="callout"><b>Тезисы:</b> {e.item.angle}</div>}
          {e.q?.note && <p className="hint">{e.q.note}</p>}

          {e.answer.from === 'field' && (
            <div className="ans">
              <div className="row between"><span className="hint">Из карточки: «{e.q?.app_field === 'whyThem' ? 'Почему они' : 'Почему я'}»</span><a className="btn sm" href={href(`app/${a.id}/overview`)}>Изменить в обзоре</a></div>
              <Markdown text={e.answer.text} />
            </div>
          )}
          {e.answer.from === 'bank' && (
            <div className="ans">
              <div className="row between">
                <span className="hint">Из банка{e.answer.label ? ` · ${e.answer.label}` : ''} · {e.answer.status === 'ready' ? 'готов' : 'черновик'}</span>
                <span className="row">
                  <button className="btn sm" onClick={() => void save({ answer: e.answer.text }, 'Скопировал ответ из банка — правь под вакансию')}>Адаптировать под вакансию</button>
                  <a className="btn sm ghost" href={href(`interview/${e.category}`)}>В банке ↗</a>
                </span>
              </div>
              <Markdown text={e.answer.text} />
            </div>
          )}
          {(e.answer.from === 'app' || e.answer.from === 'none') && !reverse && !(e.q?.app_field && e.answer.from === 'none') && (
            <label className="field"><span>{e.answer.from === 'app' ? 'Ответ под эту вакансию' : 'Ответа нет — напиши под эту вакансию'}</span>
              <AutoText value={e.item?.answer || ''} rows={3} onCommit={(v) => void save({ answer: v || null })} placeholder="Прямой ответ → история → цифра → связь с их задачей" />
            </label>
          )}
          {e.q?.app_field && e.answer.from === 'none' && <div className="callout warn">Поле «{e.q.app_field === 'whyThem' ? 'Почему они' : 'Почему я'}» в карточке пустое. <a href={href(`app/${a.id}/overview`)}>Заполнить</a></div>}
          {e.answer.from === 'app' && e.q && <p className="hint">Перекрывает ответ из банка только для этой вакансии. <button className="link" onClick={() => void save({ answer: null })}>Вернуть ответ из банка</button></p>}

          {!reverse && !e.q?.app_field && (
            <div className="row">
              <button className="btn sm" disabled={busy || s.claude.status !== 'ok'} title={s.claude.status !== 'ok' ? 'Claude не подключён' : 'Черновик под эту вакансию из твоих историй и фактов'} onClick={() => void askClaude()}>{busy ? <><span className="spin" />Claude пишет…</> : 'Черновик под вакансию от Claude'}</button>
            </div>
          )}
          {draft && <DraftBox d={draft} s={s} onClose={() => setDraft(null)} actions={
            <button className="btn sm primary" onClick={() => void save({ answer: draft.text, stories: draft.stories, facts: draft.facts }, 'Черновик сохранён как ответ под вакансию').then(() => setDraft(null))}>Сохранить как ответ под вакансию</button>
          } />}

          {!reverse && (
            <div className="grid2">
              <div className="field"><span>Истории{!e.item?.stories.length && e.stories.length ? ' (подобраны по компетенции или из банка)' : ''}</span>
                <RefPicker value={e.item?.stories.length ? e.item.stories : e.stories} options={storyOptions(s)} add="+ история" link={() => href('interview/stories')}
                  onChange={(v) => void save({ stories: v })} />
              </div>
              <div className="field"><span>Факты</span><RefPicker value={e.item?.facts.length ? e.item.facts : e.facts} options={factOptions(s)} add="+ факт" link={factLink(s)} onChange={(v) => void save({ facts: v })} /></div>
            </div>
          )}
          {e.stories.length > 0 && !reverse && (
            <details><summary>Истории целиком</summary>
              {e.stories.map((id) => st.get(id)).filter(Boolean).map((x) => (
                <div key={x!.id} className="story-peek"><b>{x!.id}. {x!.title}</b>
                  {(['situation', 'task', 'action', 'result', 'tradeoff', 'reflection'] as const).map((k) => x![k].trim() && <p key={k}><span className="muted">{k}:</span> {x![k]}</p>)}
                </div>
              ))}
            </details>
          )}

          <div className="row prep-actions">
            {e.asked
              ? <button className="btn sm" onClick={() => void save({ asked: null, asked_at: null })}>Не спрашивали</button>
              : <>
                  <select value={round} onChange={(x) => setRound(x.target.value)} style={{ width: 'auto' }} aria-label="На каком этапе"><option value="">этап…</option>{ROUNDS.map((r) => <option key={r}>{r}</option>)}</select>
                  <button className="btn sm" onClick={() => void save({ asked: s.today, asked_at: round || null }, 'Отмечено: этот вопрос задали')}>Спросили сегодня</button>
                </>}
            <span className="grow" />
            {custom && <PromoteButton a={a} e={e} />}
            {custom
              ? <ConfirmButton onConfirm={() => void act(() => api.del(itemUrl(a, e.key)), 'Вопрос убран')}>Удалить</ConfirmButton>
              : <button className="btn sm ghost" onClick={() => void save({ hidden: true }, 'Скрыто для этой вакансии')}>Скрыть для этой вакансии</button>}
          </div>
        </div>
      )}
    </article>
  );
}

function PromoteButton({ a, e }: { a: Application; e: PrepEntry }) {
  const [cat, setCat] = useState<QuestionCategory>(e.category === 'specific' ? 'behavioral' : e.category);
  return (
    <span className="row">
      <select value={cat} onChange={(x) => setCat(x.target.value as QuestionCategory)} style={{ width: 'auto' }} aria-label="Категория в банке">{QUESTION_CATEGORIES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <button className="btn sm" title="Вопрос станет общим и будет всплывать в других вакансиях" onClick={() => void act(() => api.post(`${itemUrl(a, e.key)}/promote`, { category: cat }), 'Вопрос добавлен в банк')}>В банк</button>
    </span>
  );
}

function AddQuestion({ a, s }: { a: Application; s: State }) {
  const [text, setText] = useState('');
  const [cat, setCat] = useState<QuestionCategory>('specific');
  const [asked, setAsked] = useState(false);
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const found = ql.length > 1 ? s.questions.filter((x) => `${x.text} ${x.ru || ''} ${x.variants.join(' ')}`.toLowerCase().includes(ql)).slice(0, 8) : [];
  return (
    <section className="panel">
      <h3>Добавить вопрос</h3>
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); if (!text.trim()) return; void act(() => api.post(`/api/applications/${a.id}/prep/items`, { text: text.trim(), category: cat, source: asked ? 'interview' : 'manual', asked: asked ? s.today : undefined }), asked ? 'Записал вопрос с интервью' : 'Вопрос добавлен').then((r) => r && setText('')); }}>
        <input type="text" className="grow" value={text} onChange={(x) => setText(x.target.value)} placeholder="Вопрос, который могут задать — или который задали" style={{ width: 'auto', minWidth: 240 }} />
        <select value={cat} onChange={(x) => setCat(x.target.value as QuestionCategory)} style={{ width: 'auto' }} aria-label="Категория"><option value="specific">Под вакансию</option>{QUESTION_CATEGORIES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <label className="row small"><input type="checkbox" checked={asked} onChange={(x) => setAsked(x.target.checked)} />спросили на интервью</label>
        <button className="btn">Добавить</button>
      </form>
      <label className="field"><span>…или найти в банке</span><input type="search" value={q} onChange={(x) => setQ(x.target.value)} placeholder="conflict, salary, relocation…" /></label>
      {found.length > 0 && <div className="mini-list">{found.map((x) => {
        const inPrep = a.prep.items.some((i) => i.q === x.id && !i.hidden);
        return (
          <div className="mini" key={x.id}><span><span className="tag">{categoryName(x.category)}</span> {x.text}</span>
            <button className="btn sm" disabled={inPrep} onClick={() => void patchItem(a, x.id, { pinned: true, hidden: null }, 'Добавлен в подготовку').then(() => setQ(''))}>{inPrep ? 'уже есть' : '+ в подготовку'}</button></div>
        );
      })}</div>}
      <p className="hint">Вопросы, которые реально задали, — самое ценное: отметь их «Спросили», а новые добавь с галочкой. Хорошие потом переноси в банк — они будут всплывать в других вакансиях.</p>
    </section>
  );
}

export const prepStats = (a: Application, s: State) => {
  const { entries } = buildPrep(a, s.questions, s.stories);
  const open = entries.filter((e) => e.answer.from === 'none' && e.category !== 'reverse').length;
  return { total: entries.length, open, label: `${open} ${plural(open, 'вопрос', 'вопроса', 'вопросов')} без ответа` };
};

/** Strengths and weaknesses relevant to this vacancy: by track and requirement tags. */
function Sides({ a, s }: { a: Application; s: State }) {
  const reqTags = new Set(a.requirements.flatMap((r) => r.tags));
  const rank = <T extends { roles: string[]; tags: string[] }>(list: T[]) => list
    .filter((x) => !x.roles.length || (a.track && x.roles.includes(a.track)))
    .map((x) => ({ x, hit: x.tags.filter((t) => reqTags.has(t)).length + (a.track && x.roles.includes(a.track) ? 1 : 0) }))
    .sort((p, q) => q.hit - p.hit)
    .map((p) => p.x);
  const strengths = rank(s.strengths).slice(0, 4);
  const weaknesses = rank(s.weaknesses).slice(0, 4);
  if (!strengths.length && !weaknesses.length) return null;
  return (
    <div className="grid2">
      <section className="panel">
        <div className="panel-h"><h3>Что подчеркнуть</h3><a className="small" href={href('interview/sides')}>все</a></div>
        {strengths.length ? <ul className="list">{strengths.map((x) => <li key={x.id}><b>{x.title}</b>{x.pitch ? ` — ${x.pitch}` : ''}{x.facts.length ? <span className="muted"> · {x.facts.join(', ')}</span> : null}</li>)}</ul> : <p className="hint">Нет сильных сторон под этот трек.</p>}
      </section>
      <section className="panel">
        <div className="panel-h"><h3>Где будут копать</h3><a className="small" href={href('interview/sides')}>все</a></div>
        {weaknesses.length ? <ul className="list">{weaknesses.map((x) => <li key={x.id}><b>{x.title}</b>{x.sounds ? <span className="muted"> {x.sounds}</span> : null}{x.counter ? <> — {x.counter}</> : <span className="warn-t"> — заготовки нет</span>}</li>)}</ul> : <p className="hint">Нет слабых мест под этот трек.</p>}
      </section>
    </div>
  );
}
