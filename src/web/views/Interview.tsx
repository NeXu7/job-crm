// «Интервью»: question bank with answer variants and story bank (STAR) with a competency coverage matrix.
import { useMemo, useState } from 'react';
import { api } from '../api';
import { act, type State } from '../store';
import { href } from '../router';
import { AutoText, ConfirmButton, Dots, Seg, TagInput, TextInput, fmtDate, plural } from '../ui';
import { AnswerPill, DraftBox, PracticeMark, RefPicker, Rehearse, factLink, factOptions, storyOptions, type Draft } from '../components/Interview';
import {
  COMPETENCIES, QUESTION_CATEGORIES, STAR_FIELDS, competencyName,
  type Answer, type Question, type QuestionCategory, type Story, type Strength, type Weakness,
} from '../../shared/schema';
import { askedIndex, coverage, questionStatus, storiesFor } from '../../shared/interview';
import { stageIndex } from '../../shared/pipeline';

const CATS = QUESTION_CATEGORIES.map((c) => c[0]) as QuestionCategory[];

export function Interview({ s, section }: { s: State; section?: string }) {
  const tab = section === 'stories' ? 'stories' : section === 'sides' ? 'sides' : 'questions';
  const cat = CATS.includes(section as QuestionCategory) ? (section as QuestionCategory) : undefined;
  const gaps = coverage(s.stories, s.questions).filter((c) => c.gap).length;
  return (
    <>
      <header className="vh">
        <div><h1>Интервью</h1><p className="sub">Банк вопросов и ответов, истории для behavioral, сильные стороны и слабые места. Под конкретную вакансию вопросы подбираются в карточке отклика → «Подготовка». Всё сохраняется в 00-profile/: questions/, stories.yaml, strengths.yaml.</p></div>
      </header>
      <nav className="tabs">
        <a href={href('interview')} className={tab === 'questions' ? 'on' : ''}>Вопросы · {s.questions.length}</a>
        <a href={href('interview/stories')} className={tab === 'stories' ? 'on' : ''}>Истории · {s.stories.length}{gaps ? ` · дыр ${gaps}` : ''}</a>
        <a href={href('interview/sides')} className={tab === 'sides' ? 'on' : ''}>Сильные и слабые · {s.strengths.length + s.weaknesses.length}</a>
      </nav>
      {tab === 'questions' && <QuestionsTab s={s} cat={cat} />}
      {tab === 'stories' && <StoriesTab s={s} />}
      {tab === 'sides' && <SidesTab s={s} />}
    </>
  );
}

// ---------- questions ----------
type Filter = 'all' | 'none' | 'draft' | 'ready';

function QuestionsTab({ s, cat }: { s: State; cat?: QuestionCategory }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [track, setTrack] = useState('');
  const [adding, setAdding] = useState<QuestionCategory | null>(null);
  const [rehearse, setRehearse] = useState(false);
  const asked = useMemo(() => askedIndex(s.applications), [s.applications]);
  const ql = q.trim().toLowerCase();
  const match = (x: Question) => {
    const st = questionStatus(x);
    if (filter === 'none' && !(st === 'none' && x.category !== 'reverse')) return false;
    if (filter === 'draft' && st !== 'draft') return false;
    if (filter === 'ready' && st !== 'ready') return false;
    if (track && x.roles.length && !x.roles.includes(track)) return false;
    return !ql || `${x.id} ${x.text} ${x.ru || ''} ${x.variants.join(' ')} ${x.answers.map((a) => a.text).join(' ')} ${x.note || ''}`.toLowerCase().includes(ql);
  };
  const cats = cat ? [cat] : CATS;
  const visible = s.questions.filter((x) => cats.includes(x.category) && match(x));

  // what to prepare: frequent questions without a ready answer, story gaps, upcoming interviews
  const answerable = (x: Question) => x.category !== 'reverse' && !x.app_field;
  const highOpen = s.questions.filter((x) => x.priority === 'high' && answerable(x) && questionStatus(x) !== 'ready');
  const gaps = coverage(s.stories, s.questions).filter((c) => c.gap);
  const askedOpen = s.questions.filter((x) => asked.has(x.id) && answerable(x) && questionStatus(x) !== 'ready');
  const upcoming = s.applications.filter((a) => a.stage !== 'closed' && stageIndex(a.stage) >= stageIndex('screen'));

  const cards = visible.filter((x) => x.category !== 'reverse').map((x) => ({
    key: x.id, text: x.text, ru: x.ru, answer: x.answers.find((a) => a.text.trim())?.text || '',
    stories: x.answers.flatMap((a) => a.stories), note: x.note, practice: x.practice,
  }));

  return (
    <div className="f-layout">
      <aside className="f-side" aria-label="Категории">
        <a href={href('interview')} className={!cat ? 'on' : ''}><span>Все</span><span className="badge">{s.questions.length}</span></a>
        {QUESTION_CATEGORIES.map(([id, name]) => {
          const list = s.questions.filter((x) => x.category === id);
          const ready = list.filter((x) => questionStatus(x) === 'ready').length;
          return <a key={id} href={href(`interview/${id}`)} className={cat === id ? 'on' : ''}><span>{name}</span><span className="badge" title="готово / всего">{id === 'reverse' ? list.length : `${ready}/${list.length}`}</span></a>;
        })}
      </aside>
      <div className="stack">
        {(highOpen.length > 0 || gaps.length > 0 || askedOpen.length > 0 || upcoming.length > 0) && (
          <section className="panel">
            <h3>Что подготовить</h3>
            <ul className="list">
              {highOpen.length > 0 && <li>{highOpen.length} {plural(highOpen.length, 'вопрос', 'вопроса', 'вопросов')}, которые задают почти всегда, без готового ответа. <button className="link" onClick={() => setFilter('none')}>Показать без ответа</button></li>}
              {gaps.length > 0 && <li>Нет сильной истории: {gaps.map((g) => g.name.toLowerCase()).join(', ')}. <a href={href('interview/stories')}>К матрице историй</a></li>}
              {askedOpen.length > 0 && <li>Спрашивали на интервью, а готового ответа нет: {askedOpen.map((x) => x.ru || x.text).join('; ')}</li>}
              {upcoming.map((a) => <li key={a.id}>Идёт процесс: <a href={href(`app/${a.id}/prep`)}>{a.company_name || a.id} — подготовка</a></li>)}
            </ul>
          </section>
        )}
        <div className="row">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по вопросам и ответам" style={{ maxWidth: 280 }} aria-label="Поиск" />
          <Seg value={filter} onChange={setFilter} options={[['all', 'Все'], ['none', 'Без ответа'], ['draft', 'Черновики'], ['ready', 'Готовы']]} />
          <select value={track} onChange={(e) => setTrack(e.target.value)} style={{ width: 'auto' }} aria-label="Трек"><option value="">все треки</option>{s.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <span className="grow" />
          <button className="btn" disabled={!cards.length} onClick={() => setRehearse(true)}>Тренировка · {cards.length}</button>
        </div>
        {cats.map((c) => {
          const meta = QUESTION_CATEGORIES.find((x) => x[0] === c)!;
          const list = visible.filter((x) => x.category === c);
          if (!list.length && (ql || filter !== 'all' || track) && adding !== c) return null;
          return (
            <section className="f-exp" key={c}>
              <div className="f-exp-h"><span><b>{meta[1]}</b> <span className="muted">{meta[2]}</span></span>
                {adding !== c && <button className="btn sm" onClick={() => setAdding(c)}>+ Вопрос</button>}</div>
              {adding === c && <NewQuestion category={c} onDone={() => setAdding(null)} />}
              {list.map((x) => <QuestionCard key={x.id} q={x} s={s} asked={asked.get(x.id)} />)}
              {!list.length && adding !== c && <p className="hint">Пока пусто.</p>}
            </section>
          );
        })}
      </div>
      {rehearse && <Rehearse cards={cards} stories={s.stories} onClose={() => setRehearse(false)}
        onScore={(id, score) => void act(() => api.put(`/api/questions/${encodeURIComponent(id)}`, { practice: { date: s.today, score }, message: `тренировка: ${id}` }))} />}
    </div>
  );
}

function NewQuestion({ category, onDone }: { category: QuestionCategory; onDone: () => void }) {
  const [text, setText] = useState('');
  const [ru, setRu] = useState('');
  return (
    <form className="qc open" onSubmit={(e) => { e.preventDefault(); if (!text.trim() && !ru.trim()) return; void act(() => api.post('/api/questions', { category, text: text.trim(), ru: ru.trim() || undefined }), 'Вопрос добавлен').then((r) => r && onDone()); }}>
      <label className="field"><span>Как спрашивают (EN)</span><input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell me about a time…" /></label>
      <label className="field"><span>По-русски</span><input type="text" value={ru} onChange={(e) => setRu(e.target.value)} /></label>
      <div className="row"><button className="btn primary">Добавить</button><button type="button" className="btn ghost" onClick={onDone}>Отмена</button><span className="hint">Ответ, истории и треки — после создания.</span></div>
    </form>
  );
}

const PRIORITY_LABEL = { high: 'всегда', medium: 'часто', low: 'иногда' } as const;

function QuestionCard({ q, s, asked }: { q: Question; s: State; asked?: { app: State['applications'][number]; date: string; at?: string }[] }) {
  const [open, setOpen] = useState(false);
  const save = (p: Partial<Question>, message?: string) => act(() => api.put(`/api/questions/${encodeURIComponent(q.id)}`, { ...p, message }));
  const st = questionStatus(q);
  const reverse = q.category === 'reverse';
  const tracks = new Map(s.recipes.map((r) => [r.id, r.name]));
  // Keep the answer's line breaks, drop blank lines; the CSS clamp cuts it to two lines with an ellipsis.
  const preview = q.answers.find((a) => a.text.trim())?.text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  return (
    <article className={`qc ${open ? 'open' : ''}`} id={`q-${q.id}`}>
      <button type="button" className="qc-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="qc-t"><b>{q.text || q.ru}</b>{q.text && q.ru && <span className="muted">{q.ru}</span>}</span>
        <span className="qc-m">
          {!reverse && <AnswerPill kind={st} />}
          {q.priority !== 'medium' && <span className="tag">{PRIORITY_LABEL[q.priority]}</span>}
          {q.competency && <span className="tag">{competencyName(q.competency)}</span>}
          {q.roles.map((r) => <span className="tag" key={r}>{tracks.get(r) || r}</span>)}
          {q.topic && <span className="tag mono" title="Тема вопроса">{q.topic}</span>}
          {asked?.length ? <span className="pill accent">спрашивали {asked.length}×</span> : null}
          <PracticeMark p={q.practice} />
        </span>
        {!open && preview && <span className="qc-prev">{preview}</span>}
      </button>
      {open && <QuestionEditor q={q} s={s} save={save} asked={asked} />}
    </article>
  );
}

function QuestionEditor({ q, s, save, asked }: { q: Question; s: State; save: (p: Partial<Question>, m?: string) => Promise<unknown>; asked?: { app: State['applications'][number]; date: string; at?: string }[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const allTags = useMemo(() => [...new Set(s.facts.flatMap((f) => f.tags))].sort(), [s.facts]);
  const reverse = q.category === 'reverse';
  const setAnswers = (answers: Answer[], m?: string) => save({ answers }, m);
  const updA = (i: number, p: Partial<Answer>) => void setAnswers(q.answers.map((a, j) => (j === i ? { ...a, ...p } : a)));
  const suggested = storiesFor(q.competency, s.stories);
  const askClaude = async () => {
    setBusy(true);
    const d = await act(() => api.post<Draft>(`/api/questions/${encodeURIComponent(q.id)}/draft`));
    setBusy(false);
    if (d) setDraft(d);
  };
  const acceptDraft = (mode: 'add' | 'replace') => {
    if (!draft) return;
    const a: Answer = { label: 'Claude', roles: [], text: draft.text, status: 'draft', stories: draft.stories, facts: draft.facts };
    const answers = mode === 'add' || !q.answers.length ? [...q.answers, a] : q.answers.map((x, i) => (i === 0 ? { ...x, text: draft.text, stories: draft.stories, facts: draft.facts, status: 'draft' as const } : x));
    const note = draft.missing.length ? [q.note, `Не хватает: ${draft.missing.join('; ')}`].filter(Boolean).join('\n') : q.note;
    void save({ answers, note }, `вопрос ${q.id}: черновик ответа от Claude`).then(() => setDraft(null));
  };

  return (
    <div className="stack tight qc-b">
      {q.note && <div className="callout">{q.note}</div>}
      {q.app_field && <div className="callout">Ответ берётся из карточки отклика: поле «{q.app_field === 'whyThem' ? 'Почему они' : 'Почему я'}». Он свой для каждой вакансии — смотри «Подготовку» в карточке.</div>}

      {!q.app_field && (
        <div className="stack tight">
          <div className="row between"><h3>{reverse ? 'Что хочу услышать' : 'Ответ'}</h3>
            <span className="row">
              {!reverse && <button className="btn sm" disabled={busy || s.claude.status !== 'ok'} title={s.claude.status !== 'ok' ? 'Claude не подключён' : 'Claude напишет черновик из твоих историй и фактов'} onClick={() => void askClaude()}>{busy ? <><span className="spin" />Claude пишет…</> : 'Черновик от Claude'}</button>}
              <button className="btn sm" onClick={() => void setAnswers([...q.answers, { roles: [], text: '', status: 'draft', stories: [], facts: [] }])}>+ Вариант</button>
            </span>
          </div>
          {draft && <DraftBox d={draft} s={s} onClose={() => setDraft(null)} actions={<>
            <button className="btn sm primary" onClick={() => acceptDraft('add')}>Добавить вариантом</button>
            {q.answers.length > 0 && <button className="btn sm" onClick={() => acceptDraft('replace')}>Заменить первый вариант</button>}
          </>} />}
          {!q.answers.length && <p className="hint">{reverse ? 'Можно записать, какой ответ хочется услышать и что будет тревожным сигналом.' : 'Ответа пока нет. Напиши сам или попроси черновик у Claude — он соберёт его только из твоих историй и фактов.'}</p>}
          {q.answers.map((a, i) => (
            <div className={`ans ${a.status}`} key={i}>
              <div className="row between">
                <span className="row">
                  <TextInput value={a.label || ''} placeholder={q.answers.length > 1 ? `Вариант ${i + 1}` : 'Название варианта'} onCommit={(v) => updA(i, { label: v || undefined })} className="ans-label" />
                  {s.recipes.map((r) => <button type="button" key={r.id} className={`tag ${a.roles.includes(r.id) ? 'on' : ''}`} title="Для какого трека этот вариант" onClick={() => updA(i, { roles: a.roles.includes(r.id) ? a.roles.filter((x) => x !== r.id) : [...a.roles, r.id] })}>{r.name}</button>)}
                </span>
                <span className="row">
                  {!reverse && <Seg value={a.status} onChange={(v) => updA(i, { status: v })} options={[['draft', 'Черновик'], ['ready', 'Готов']]} />}
                  <ConfirmButton className="icon-btn" confirmText="?" onConfirm={() => void setAnswers(q.answers.filter((_, j) => j !== i))}>✕</ConfirmButton>
                </span>
              </div>
              <AutoText value={a.text} rows={3} onCommit={(v) => updA(i, { text: v })} placeholder={reverse ? 'Что хочу услышать и почему спрашиваю' : 'Как отвечаю: прямой ответ → история → цифра → вывод'} />
              {!reverse && <div className="grid2">
                <label className="field"><span>Истории</span><RefPicker value={a.stories} options={storyOptions(s)} onChange={(v) => updA(i, { stories: v })} add="+ история" link={() => href('interview/stories')} /></label>
                <label className="field"><span>Факты</span><RefPicker value={a.facts} options={factOptions(s)} onChange={(v) => updA(i, { facts: v })} add="+ факт" link={factLink(s)} /></label>
              </div>}
            </div>
          ))}
          {q.competency && (
            <div className="hint">
              Истории на «{competencyName(q.competency)}»: {suggested.length
                ? suggested.map((x) => <span key={x.id} className="row" style={{ display: 'inline-flex', marginRight: 10 }}><span className="id">{x.id}</span> {x.title} <Dots value={x.covers[q.competency!] ?? 0} /></span>)
                : <b className="warn-t">нет ни одной — это дыра. <a href={href('interview/stories')}>Добавить историю</a></b>}
            </div>
          )}
        </div>
      )}

      <details>
        <summary>Формулировки, треки, теги, заметка</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <div className="grid2">
            <label className="field"><span>Как спрашивают (EN)</span><AutoText value={q.text} rows={1} onCommit={(v) => void save({ text: v })} /></label>
            <label className="field"><span>По-русски</span><AutoText value={q.ru || ''} rows={1} onCommit={(v) => void save({ ru: v })} /></label>
          </div>
          <label className="field"><span>Другие формулировки</span><TagInput value={q.variants} onChange={(v) => void save({ variants: v })} placeholder="Enter после каждой" /></label>
          <div className="row">
            <label className="field"><span>Как часто</span><Seg value={q.priority} onChange={(v) => void save({ priority: v })} options={[['high', 'Почти всегда'], ['medium', 'Часто'], ['low', 'Иногда']]} /></label>
            <label className="field"><span>Категория</span><select value={q.category} onChange={(e) => void save({ category: e.target.value as QuestionCategory })}>{QUESTION_CATEGORIES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            <label className="field"><span>Компетенция</span><select value={q.competency || ''} onChange={(e) => void save({ competency: e.target.value || undefined })}><option value="">—</option>{COMPETENCIES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            <label className="field" style={{ width: 120 }}><span>Тема</span><TextInput value={q.topic || ''} onCommit={(v) => void save({ topic: v || undefined })} placeholder="для группировки" /></label>
          </div>
          <div className="field"><span>Особенно вероятен для треков (пусто — для любого)</span>
            <div className="row">{s.recipes.map((r) => <button type="button" key={r.id} className={`tag ${q.roles.includes(r.id) ? 'on' : ''}`} onClick={() => void save({ roles: q.roles.includes(r.id) ? q.roles.filter((x) => x !== r.id) : [...q.roles, r.id] })}>{r.name}</button>)}</div>
          </div>
          <label className="field"><span>Теги — вопрос всплывёт, если они есть в требованиях вакансии</span><TagInput value={q.tags} onChange={(v) => void save({ tags: v })} suggestions={allTags} /></label>
          <label className="field"><span>Заметка</span><AutoText value={q.note || ''} rows={1} onCommit={(v) => void save({ note: v || undefined })} placeholder="Что важно в ответе, чего избегать" /></label>
          <div className="row">
            <label className="field grow"><span>Источник</span><TextInput value={q.source || ''} onCommit={(v) => void save({ source: v || undefined })} /></label>
            <span className="id" style={{ alignSelf: 'end' }}>{q.id}</span>
            <ConfirmButton onConfirm={() => void act(() => api.del(`/api/questions/${encodeURIComponent(q.id)}`), 'Вопрос удалён')}>Удалить вопрос</ConfirmButton>
          </div>
          {asked?.length ? <p className="hint">Спрашивали: {asked.map((x) => <a key={x.app.id} href={href(`app/${x.app.id}/prep`)} style={{ marginRight: 8 }}>{x.app.company_name || x.app.id}, {fmtDate(x.date)}{x.at ? ` (${x.at})` : ''}</a>)}</p> : null}
        </div>
      </details>
    </div>
  );
}

// ---------- stories ----------
function StoriesTab({ s }: { s: State }) {
  const cov = coverage(s.stories, s.questions);
  const save = (st: Story, p: Partial<Story>) => act(() => api.put(`/api/stories/${encodeURIComponent(st.id)}`, { ...st, ...p }));
  const usedIn = (id: string) => s.questions.filter((q) => q.answers.some((a) => a.stories.includes(id)));
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-h"><h3>Покрытие компетенций</h3><span className="hint">Клик по точкам: 0 → частично → полностью. Строка без полной истории, при этом с вопросами в банке — дыра.</span></div>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead><tr><th>Компетенция</th>{s.stories.map((st) => <th key={st.id} title={st.title}><a href={`#story-${st.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`story-${st.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{st.id}</a></th>)}<th>Вопросов</th></tr></thead>
            <tbody>
              {cov.map((c) => (
                <tr key={c.id} className={c.gap ? 'gap' : ''}>
                  <th>{c.name}{c.gap && <span className="pill warn">дыра</span>}</th>
                  {s.stories.map((st) => <td key={st.id}><Dots value={st.covers[c.id] ?? 0} onChange={(v) => void save(st, { covers: { ...st.covers, [c.id]: v } })} /></td>)}
                  <td className="num">{c.questions.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="row"><button className="btn" onClick={() => void act(() => api.post('/api/stories', { title: 'Новая история', status: 'draft' }), 'История добавлена')}>+ История</button>
        <span className="hint">Формат: Situation → Task → Action → Result → компромисс → Reflection. Reflection отличает сеньорный ответ от джуниорского. Минимум одна метрика и один компромисс.</span></div>
      {s.stories.map((st) => <StoryCard key={st.id} st={st} s={s} save={(p) => save(st, p)} used={usedIn(st.id)} />)}
    </div>
  );
}

function StoryCard({ st, s, save, used }: { st: Story; s: State; save: (p: Partial<Story>) => Promise<unknown>; used: Question[] }) {
  const covers = Object.entries(st.covers).filter(([, v]) => v > 0);
  const empty = STAR_FIELDS.filter(([k]) => !st[k].trim()).map(([, l]) => l);
  return (
    <article className={`fc ${st.status === 'ready' ? 'verified' : 'draft'}`} id={`story-${st.id}`}>
      <div className="fc-h">
        <div className="row grow"><span className="id">{st.id}</span><TextInput className="grow story-title" value={st.title} onCommit={(v) => void save({ title: v })} /></div>
        <Seg value={st.status} onChange={(v) => void save({ status: v })} options={[['draft', 'Черновик'], ['ready', 'Готова']]} />
      </div>
      {st.note && <div className="callout">{st.note}</div>}
      <div className="row small">
        {covers.map(([c, v]) => <span key={c} className={`tag ${v === 2 ? 'on' : ''}`}>{competencyName(c)}{v === 1 ? ' ~' : ''}</span>)}
        {empty.length > 0 && <span className="pill warn"><i>!</i>не заполнено: {empty.join(', ')}</span>}
      </div>
      <div className="star">
        {STAR_FIELDS.map(([k, label, hint]) => (
          <label className="field" key={k}><span>{label}</span><AutoText value={st[k]} rows={1} warnEmpty={k !== 'situation'} onCommit={(v) => void save({ [k]: v })} placeholder={hint} /></label>
        ))}
      </div>
      <div className="grid2">
        <label className="field"><span>Факты с цифрами</span><RefPicker value={st.facts} options={factOptions(s)} onChange={(v) => void save({ facts: v })} add="+ факт" link={factLink(s)} /></label>
        <label className="field"><span>Опыт</span><select value={st.exp || ''} onChange={(e) => void save({ exp: e.target.value || undefined })}><option value="">—</option>{s.experiences.map((e) => <option key={e.id} value={e.id}>{e.org}</option>)}</select></label>
      </div>
      <details>
        <summary>Заметка, где используется{used.length ? ` · в ответах на ${used.length} ${plural(used.length, 'вопрос', 'вопроса', 'вопросов')}` : ''}</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <label className="field"><span>Заметка</span><AutoText value={st.note || ''} rows={1} onCommit={(v) => void save({ note: v || undefined })} placeholder="Что дописать, оговорки" /></label>
          {used.length > 0 && <ul className="list">{used.map((q) => <li key={q.id}><a href={href(`interview/${q.category}`)}>{q.ru || q.text}</a></li>)}</ul>}
          <div><ConfirmButton onConfirm={() => void act(() => api.del(`/api/stories/${encodeURIComponent(st.id)}`), `История ${st.id} удалена`)}>Удалить историю</ConfirmButton></div>
        </div>
      </details>
    </article>
  );
}


// ---------- strengths and weaknesses ----------
function SidesTab({ s }: { s: State }) {
  const allTags = useMemo(() => [...new Set(s.facts.flatMap((f) => f.tags))].sort(), [s.facts]);
  const add = (kind: 'strength' | 'weakness') => void act(() => api.post(`/api/sides/${kind}`, { title: kind === 'strength' ? 'Новая сильная сторона' : 'Новое слабое место' }), 'Добавлено');
  return (
    <div className="stack">
      <p className="hint">Сильная сторона — что подчеркнуть и чем это доказано. Слабое место — где будут копать и что отвечаешь. Под вакансию они всплывают в «Подготовке» по треку и тегам требований.</p>
      <section className="f-exp">
        <div className="f-exp-h"><span><b>Сильные стороны</b> <span className="muted">{s.strengths.length}</span></span><button className="btn sm" onClick={() => add('strength')}>+ Сильная сторона</button></div>
        {s.strengths.map((x) => <SideCard key={x.id} kind="strength" x={x} s={s} tags={allTags} />)}
      </section>
      <section className="f-exp">
        <div className="f-exp-h"><span><b>Слабые места</b> <span className="muted">{s.weaknesses.length}</span></span><button className="btn sm" onClick={() => add('weakness')}>+ Слабое место</button></div>
        {s.weaknesses.map((x) => <SideCard key={x.id} kind="weakness" x={x} s={s} tags={allTags} />)}
      </section>
    </div>
  );
}

function SideCard({ kind, x, s, tags }: { kind: 'strength' | 'weakness'; x: Strength | Weakness; s: State; tags: string[] }) {
  const save = (p: Partial<Strength & Weakness>) => act(() => api.put(`/api/sides/${kind}/${encodeURIComponent(x.id)}`, p));
  const w = kind === 'weakness' ? (x as Weakness) : null;
  const st = kind === 'strength' ? (x as Strength) : null;
  const qOptions: [string, string][] = s.questions.map((q) => [q.id, q.ru || q.text]);
  return (
    <article className={`fc ${x.status === 'ready' ? 'verified' : 'draft'}`} id={`${kind}-${x.id}`}>
      <div className="fc-h">
        <div className="row grow"><span className="id">{x.id}</span><TextInput className="grow story-title" value={x.title} onCommit={(v) => void save({ title: v })} /></div>
        <Seg value={x.status} onChange={(v) => void save({ status: v })} options={[['draft', 'Черновик'], ['ready', 'Готов']]} />
      </div>
      {x.note && <div className="callout">{x.note}</div>}
      {st && <>
        <label className="field"><span>Как говорю на интервью (EN, 1–2 фразы)</span><AutoText value={st.pitch} rows={1} warnEmpty onCommit={(v) => void save({ pitch: v })} placeholder="I … — and here is the number that proves it." /></label>
        <label className="field"><span>Суть по-русски</span><AutoText value={st.ru || ''} rows={1} onCommit={(v) => void save({ ru: v || undefined })} /></label>
      </>}
      {w && <>
        <label className="field"><span>Как это звучит на интервью</span><TextInput value={w.sounds} onCommit={(v) => void save({ sounds: v })} placeholder="«У вас нет опыта в нашей отрасли»" /></label>
        <label className="field"><span>Что отвечаю</span><AutoText value={w.counter} rows={2} warnEmpty onCommit={(v) => void save({ counter: v })} placeholder="Признать → показать, что с этим делаю → факт" /></label>
        <div className="field"><span>Какими вопросами вскрывают</span><RefPicker value={w.questions} options={qOptions} onChange={(v) => void save({ questions: v })} add="+ вопрос" link={(id) => href(`interview/${s.questions.find((q) => q.id === id)?.category || ''}`)} /></div>
      </>}
      <div className="grid2">
        <label className="field"><span>Доказательства: факты</span><RefPicker value={x.facts} options={factOptions(s)} onChange={(v) => void save({ facts: v })} add="+ факт" link={factLink(s)} /></label>
        <label className="field"><span>Истории</span><RefPicker value={x.stories} options={storyOptions(s)} onChange={(v) => void save({ stories: v })} add="+ история" link={() => href('interview/stories')} /></label>
      </div>
      <details>
        <summary>Треки, теги, заметка, источник</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <div className="field"><span>Для треков (пусто — для любого)</span>
            <div className="row">{s.recipes.map((r) => <button type="button" key={r.id} className={`tag ${x.roles.includes(r.id) ? 'on' : ''}`} onClick={() => void save({ roles: x.roles.includes(r.id) ? x.roles.filter((y) => y !== r.id) : [...x.roles, r.id] })}>{r.name}</button>)}</div>
          </div>
          <label className="field"><span>Теги — всплывает в подготовке, если они есть в требованиях</span><TagInput value={x.tags} onChange={(v) => void save({ tags: v })} suggestions={tags} /></label>
          <label className="field"><span>Заметка</span><AutoText value={x.note || ''} rows={1} onCommit={(v) => void save({ note: v || undefined })} /></label>
          <div className="row">
            <label className="field grow"><span>Источник</span><TextInput value={x.source || ''} onCommit={(v) => void save({ source: v || undefined })} /></label>
            <ConfirmButton onConfirm={() => void act(() => api.del(`/api/sides/${kind}/${encodeURIComponent(x.id)}`), 'Удалено')}>Удалить</ConfirmButton>
          </div>
        </div>
      </details>
    </article>
  );
}
