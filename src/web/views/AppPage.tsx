import { useEffect, useState } from 'react';
import { api } from '../api';
import { act, toast, type State } from '../store';
import { go, href } from '../router';
import { AutoText, ConfirmButton, copyText, Dots, dueLabel, FitBadge, fmtDate, Markdown, Modal, Seg, TextInput } from '../ui';
import { ResumeFrame } from '../components/ResumeFrame';
import { Prep, prepStats } from './Prep';
import { moveStage, hostOf } from './Pipeline';
import { daysBetween, fitScore, STAGES, STAGE_NAMES, stageIndex, addDays } from '../../shared/pipeline';
import type { Application, Lock } from '../../shared/schema';

const TABS: [string, string][] = [['overview', 'Обзор'], ['job', 'Вакансия'], ['resume', 'Резюме'], ['prep', 'Подготовка'], ['timeline', 'Таймлайн']];

export function AppPage({ s, id, tab }: { s: State; id: string; tab: string }) {
  const a = s.applications.find((x) => x.id === id);
  if (!a) return <p>Нет такого отклика. <a href={href('pipeline')}>К воронке</a></p>;
  const patch = (p: Partial<Application> | Record<string, unknown>) => act(() => api.patch(`/api/applications/${a.id}`, p));
  const busyCap = a.capture.status === 'running' || a.capture.status === 'pending';
  const busyAn = a.analysis.status === 'running' || (a.analysis.status === 'pending' && busyCap);
  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}><a href={href('pipeline')} className="small">← Воронка</a></div>
      <header className="vh">
        <div style={{ minWidth: 0 }}>
          <h1>{a.company_name || 'Без компании'} · {a.role || 'роль не указана'}</h1>
          <p className="sub">
            {a.source && <>{a.source} · </>}
            {a.url && <><a href={a.url} target="_blank" rel="noreferrer">{hostOf(a.url)} ↗</a> · </>}
            добавлено {fmtDate(a.created)}
            {a.legacy && ' · отклик до CRM'}
          </p>
        </div>
        <div className="row">
          {busyCap && <span className="pill accent"><span className="spin" />сохраняю страницу</span>}
          {busyAn && !busyCap && <span className="pill accent"><span className="spin" />Claude разбирает</span>}
          {a.capture.status === 'failed' && <span className="pill bad" title={a.capture.error}><i>!</i>захват не удался</span>}
          {a.capture.status === 'authwall' && <span className="pill warn"><i>!</i>страница требует входа</span>}
          {a.analysis.status === 'failed' && <span className="pill bad" title={a.analysis.error}><i>!</i>разбор не удался</span>}
          {a.analysis.status === 'done' && <span className="pill good" title={a.analysis.model}><i>✓</i>разобрано {fmtDate(a.analysis.at)}</span>}
          {a.url && <button className="btn sm" disabled={busyCap} onClick={() => void act(() => api.post(`/api/applications/${a.id}/recapture`), 'Сохраняю страницу заново')}>Перезахватить</button>}
          {a.files.md && <button className="btn sm" disabled={busyAn} onClick={() => void act(() => api.post(`/api/applications/${a.id}/analyze`), 'Отдал на разбор Claude')}>Переразобрать</button>}
        </div>
      </header>
      {a.analysis.status === 'failed' && <div className="callout bad" style={{ marginBottom: 12 }}>Разбор: {a.analysis.error}</div>}
      {a.capture.status === 'authwall' && <div className="callout warn" style={{ marginBottom: 12 }}>LinkedIn без входа не показывает вакансию. Открой её в своём браузере и нажми «Сохранить страницу» в расширении (установка: <a href={href('guide/trouble')}>Как пользоваться → Если что-то не так → Расширение</a>), либо вставь текст вручную на вкладке «Вакансия».</div>}
      <div className="steps" style={{ marginBottom: 14 }} role="group" aria-label="Стадия">
        {STAGES.map((st) => (
          <button key={st} className={`step ${st === a.stage ? 'cur' : stageIndex(st) < stageIndex(a.stage) && a.stage !== 'closed' ? 'done' : ''}`} onClick={() => st !== a.stage && void moveStage(a, st)}>{STAGE_NAMES[st]}</button>
        ))}
        {a.stage === 'closed' && <TextInput value={a.outcome || ''} placeholder="Итог: отказ, отозвал, тишина…" onCommit={(v) => void patch({ outcome: v })} />}
      </div>
      <nav className="tabs">{TABS.map(([t, l]) => <a key={t} href={href(`app/${a.id}/${t}`)} className={tab === t ? 'on' : ''}>{l}{t === 'resume' && a.locks.length ? ` · ${a.locks.length}` : ''}{t === 'prep' ? ` · ${prepStats(a, s).total}` : ''}</a>)}</nav>
      {tab === 'overview' && <Overview a={a} s={s} patch={patch} />}
      {tab === 'job' && <Job a={a} />}
      {tab === 'resume' && <Resume a={a} s={s} />}
      {tab === 'prep' && <Prep a={a} s={s} />}
      {tab === 'timeline' && <Timeline a={a} patch={patch} />}
    </>
  );
}

function Overview({ a, s, patch }: { a: Application; s: State; patch: (p: Record<string, unknown>) => Promise<unknown> }) {
  const company = s.companies.find((c) => c.slug === a.company);
  const factById = new Map(s.facts.map((f) => [f.id, f]));
  const n = fitScore(a);
  const [flag, setFlag] = useState('');
  const [person, setPerson] = useState({ name: '', role: '' });
  const d = a.next ? daysBetween(s.today, a.next.date) : null;
  return (
    <div className="d-grid">
      <div className="stack">
        {!a.legacy && (
          <section className="panel">
            <label className="field"><span>Почему они</span>
              <AutoText value={a.whyThem} warnEmpty={a.stage === 'research'} onCommit={(v) => void patch({ whyThem: v })} placeholder="Что они строят и почему хочется именно туда" />
            </label>
            <label className="field"><span>Почему я</span>
              <AutoText value={a.whyMe} warnEmpty={a.stage === 'research'} onCommit={(v) => void patch({ whyMe: v })} placeholder="Какие факты закрывают их главные требования" />
            </label>
            {a.stage === 'research' && !(a.whyThem.trim() && a.whyMe.trim()) && <p className="callout warn">Пока поля пустые, карточка не перейдёт в «Готов к отклику». Нет ответа — нет отклика.</p>}
            {a.why_points.length > 0 && (
              <div className="callout"><b>Подсказки Claude</b> — тезисы, не готовый ответ:<ul className="list" style={{ marginTop: 6 }}>{a.why_points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
            )}
          </section>
        )}
        {(a.summary || a.requirements.length > 0) && (
          <section className="panel">
            <h2>Разбор вакансии</h2>
            {a.summary && <p>{a.summary}</p>}
            {a.requirements.length > 0 && (
              <div>
                {a.requirements.map((r, i) => {
                  const ok = r.fact_ids.length > 0;
                  return (
                    <div className="req" key={i}>
                      <span className={`pill ${ok ? 'good' : 'warn'}`}><i>{ok ? '✓' : '!'}</i>{r.must ? 'must' : 'nice'}</span>
                      <span>{r.text}</span>
                      {r.quote && <span className="q">«{r.quote}»</span>}
                      <span className="facts">
                        {ok ? r.fact_ids.map((id) => <a key={id} className="id" href={href(`facts/${factById.get(id)?.exp || ''}`)} title={factById.get(id)?.text}>{id}</a>)
                          : <span className="hint">в банке нет фактов под это{r.tags.length ? ` (теги: ${r.tags.join(', ')})` : ''}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
        {a.questions.length > 0 && <section className="panel"><h2>Что выяснить</h2><ul className="list">{a.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></section>}
        <section className="panel">
          <h2>Заметки</h2>
          <AutoText value={a.notes} onCommit={(v) => void patch({ notes: v })} placeholder="Что узнал о компании, людях, процессе" rows={3} />
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-h"><h3>Следующий шаг</h3>{d !== null && <span className={`pill ${d < 0 ? 'bad' : d <= 1 ? 'warn' : ''}`}>{dueLabel(d)}</span>}</div>
          <TextInput value={a.next?.text || ''} placeholder="Что сделать" onCommit={(v) => void patch({ next: v ? { text: v, date: a.next?.date || addDays(s.today, 2) } : null })} />
          <div className="row">
            <input type="date" value={a.next?.date || ''} style={{ width: 'auto' }} onChange={(e) => void patch({ next: { text: a.next?.text || 'Следующий шаг', date: e.target.value } })} aria-label="Срок" />
            {a.next && <button className="btn sm" onClick={() => void patch({ next: null, timeline: [...a.timeline, { date: s.today, kind: 'сделано', text: a.next!.text }] })}>Сделано</button>}
          </div>
        </section>

        <section className="panel">
          <h3>Детали</h3>
          <div className="fields">
            <label className="field"><span>Компания</span><TextInput value={a.company_name} onCommit={(v) => void patch({ company_name: v })} /></label>
            <label className="field"><span>Роль</span><TextInput value={a.role} onCommit={(v) => void patch({ role: v })} /></label>
            <label className="field"><span>Трек</span>
              <select value={a.track || ''} onChange={(e) => void patch({ track: e.target.value || undefined })}>
                <option value="">—</option>{s.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Вилка</span><TextInput value={a.comp || ''} onCommit={(v) => void patch({ comp: v })} /></label>
            <label className="field"><span>Формат и локация</span><TextInput value={a.location || ''} onCommit={(v) => void patch({ location: v })} /></label>
            <label className="field"><span>Таймзона команды</span><TextInput value={a.team_tz || ''} onCommit={(v) => void patch({ team_tz: v })} /></label>
            <label className="field"><span>Источник</span><TextInput value={a.source || ''} onCommit={(v) => void patch({ source: v })} /></label>
            <label className="field"><span>Ссылка</span><TextInput type="url" value={a.url || ''} onCommit={(v) => void patch({ url: v })} /></label>
          </div>
        </section>

        {company && (company.about || company.segment || company.stage) && (
          <section className="panel">
            <h3>{company.name}</h3>
            {company.about && <p className="small">{company.about}</p>}
            <dl className="kv">
              {company.segment && <><dt>Сегмент</dt><dd>{company.segment}</dd></>}
              {company.stage && <><dt>Стадия</dt><dd>{company.stage}</dd></>}
              {company.size && <><dt>Размер</dt><dd>{company.size}</dd></>}
              {company.hq && <><dt>HQ</dt><dd>{company.hq}</dd></>}
              {company.website && <><dt>Сайт</dt><dd><a href={company.website} target="_blank" rel="noreferrer">{hostOf(company.website)}</a></dd></>}
            </dl>
            {s.applications.filter((x) => x.company === company.slug && x.id !== a.id).map((o) => (
              <a key={o.id} href={href(`app/${o.id}`)} className="callout warn small">Был отклик: {o.role || o.id} · {STAGE_NAMES[o.stage]}{o.outcome ? ` · ${o.outcome}` : ''} · {fmtDate(o.created)}</a>
            ))}
          </section>
        )}

        {!a.legacy && (
          <section className="panel">
            <div className="panel-h"><h3>Fit по ICP</h3><FitBadge score={n ?? 0} max={s.icp.criteria.length * 2} /></div>
            {!s.icp.criteria.length && <p className="hint">Критерии ICP не заданы — добавь их в <a href={href('facts/icp')}>«Банк фактов» → «Критерии ICP»</a>, тогда Claude начнёт ставить fit при разборе.</p>}
            {s.icp.criteria.map((c) => (
              <div className="fitrow" key={c.id}>
                <span>{c.name}</span>
                <Dots value={a.fit[c.id] ?? 0} onChange={(v) => void patch({ fit: { ...a.fit, [c.id]: v } })} />
                <small>{a.fit_notes[c.id] || c.target}</small>
              </div>
            ))}
            {s.icp.criteria.length > 0 && <p className="hint">Клик по точкам меняет оценку: 0 → 1 → 2.</p>}
          </section>
        )}

        <section className="panel">
          <h3>Красные флаги</h3>
          {a.flags.length ? <ul className="list">{a.flags.map((f, i) => <li key={i}>{f} <button className="icon-btn" aria-label="Убрать" onClick={() => void patch({ flags: a.flags.filter((_, j) => j !== i) })}>✕</button></li>)}</ul> : <p className="hint">Нет.</p>}
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (flag.trim()) { void patch({ flags: [...a.flags, flag.trim()] }); setFlag(''); } }}>
            <input type="text" className="grow" value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="Добавить флаг" style={{ width: 'auto' }} />
          </form>
        </section>

        <section className="panel">
          <h3>Люди</h3>
          {a.people.length > 0 && <dl className="kv">{a.people.map((p, i) => <div key={i} style={{ display: 'contents' }}><dt>{p.role || '—'}</dt><dd>{p.name}{p.contact ? ` · ${p.contact}` : ''} <button className="icon-btn" aria-label="Убрать" onClick={() => void patch({ people: a.people.filter((_, j) => j !== i) })}>✕</button></dd></div>)}</dl>}
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (person.name.trim()) { void patch({ people: [...a.people, person] }); setPerson({ name: '', role: '' }); } }}>
            <input type="text" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} placeholder="Имя" style={{ flex: 1, width: 'auto' }} />
            <input type="text" value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value })} placeholder="Кто: рекрутер, HM…" style={{ flex: 1, width: 'auto' }} />
            <button className="btn sm">Добавить</button>
          </form>
        </section>

        <div className="row"><ConfirmButton onConfirm={() => void act(async () => { await api.del(`/api/applications/${a.id}`); go('pipeline'); }, 'Отклик удалён')}>Удалить отклик</ConfirmButton></div>
      </div>
    </div>
  );
}

function Job({ a }: { a: Application }) {
  const [mode, setMode] = useState<'text' | 'page' | 'shot'>(a.files.md ? 'text' : a.files.html ? 'page' : 'text');
  const [md, setMd] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  useEffect(() => {
    if (a.files.md) void fetch(`/api/applications/${a.id}/capture/page.md`).then((r) => r.text()).then(setMd);
  }, [a.id, a.files.md, a.capture.at]);
  return (
    <div className="stack">
      <div className="row between">
        <Seg value={mode} onChange={setMode} options={[['text', 'Текст'], ['page', 'Снимок страницы'], ['shot', 'Скриншот']]} />
        <span className="row">
          <span className="hint">{a.capture.method && `способ: ${a.capture.method}`}{a.capture.at && ` · ${fmtDate(a.capture.at)}`}</span>
          {a.files.html && <a className="btn sm ghost" href={`/api/applications/${a.id}/capture/page.html`} target="_blank" rel="noreferrer">Снимок в новой вкладке ↗</a>}
        </span>
      </div>
      {mode === 'text' && (a.files.md && md !== null ? <section className="panel"><Markdown text={md} /></section> : <p className="hint">Текста нет.</p>)}
      {mode === 'page' && (a.files.html ? <iframe className="snapshot" title="Снимок страницы" sandbox="" src={`/api/applications/${a.id}/capture/page.html`} /> : <p className="hint">Снимка нет.</p>)}
      {mode === 'shot' && (a.files.png ? <img src={`/api/applications/${a.id}/capture/screenshot.png`} alt="Скриншот страницы вакансии" style={{ maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 8 }} /> : <p className="hint">Скриншота нет: страницу сохранили из расширения или через API.</p>)}
      <section className="panel">
        <h3>Вставить текст вручную</h3>
        <p className="hint">Если страница недоступна или требует входа: скопируй текст вакансии сюда. Он заменит сохранённый текст и уйдёт на разбор.</p>
        <textarea rows={5} value={manual} onChange={(e) => setManual(e.target.value)} />
        <div><button className="btn" disabled={!manual.trim()} onClick={() => void act(() => api.post(`/api/applications/${a.id}/text`, { text: manual }), 'Текст сохранён, разбираю').then(() => setManual(''))}>Сохранить и разобрать</button></div>
      </section>
    </div>
  );
}

function Resume({ a, s }: { a: Application; s: State }) {
  const [open, setOpen] = useState<Lock | null>(null);
  const base = s.recipes.find((r) => r.id === (a.recipe?.base || a.track));
  return (
    <div className="stack">
      <div className="row">
        <a className="btn primary" href={href(`builder/${a.id}`)}>Открыть в конструкторе</a>
        {a.recipe && <span className="hint">Есть рабочая версия под эту вакансию{base ? ` (база: ${base.name})` : ''}.</span>}
      </div>
      <section className="panel">
        <h2>Зафиксированные версии</h2>
        {!a.locks.length && <p className="hint">Пока нет. Собери резюме в конструкторе и нажми «Зафиксировать».</p>}
        {[...a.locks].reverse().map((l) => {
          const sent = a.sent_lock === l.hash;
          return (
            <div className="lock" key={l.hash}>
              <div className="row between">
                <div className="row"><span className="hash">lock {l.hash}</span><span className="hint">{fmtDate(l.created_at)} · база {l.base || '—'}</span>{sent && <span className="pill good"><i>✓</i>отправлено</span>}</div>
                <div className="row">
                  <button className="btn sm" onClick={() => setOpen(l)}>Посмотреть</button>
                  <a className="btn sm" href={`/api/applications/${a.id}/locks/${l.hash}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                  <a className="btn sm" href={`/api/applications/${a.id}/locks/${l.hash}/pdf?download=1`}>Скачать</a>
                  <button className="btn sm" onClick={() => void fetch(`/api/applications/${a.id}/locks/${l.hash}/text`).then((r) => r.text()).then(copyText).then((ok) => toast(ok ? 'Текст для формы скопирован' : 'Не удалось скопировать'))}>Текст для формы</button>
                  {!sent && <button className="btn sm primary" onClick={() => void act(() => api.post(`/api/applications/${a.id}/send`, { hash: l.hash }), `Отмечено: отправлен lock ${l.hash}. Follow-up через 7 дней.`)}>Отметить отправленным</button>}
                </div>
              </div>
              <ul className="diff">{l.patch.length ? l.patch.map((p, i) => <li key={i} className={p.startsWith('+ ') ? 'add' : p.startsWith('− ') ? 'remove' : 'order'}>{p}</li>) : <li>без правок к базе</li>}</ul>
            </div>
          );
        })}
      </section>
      {open && (
        <Modal onClose={() => setOpen(null)} title={<>Что ушло в {a.company_name || 'компанию'} · <span className="hash">lock {open.hash}</span></>}>
          <p className="hint">Ровно этот текст видел интервьюер. Подсвечены отличия от базового рецепта на момент фиксации.</p>
          <ResumeFrame resolved={open.resolved} maxScale={0.9} highlight={{ ids: open.patch.filter((p) => p.startsWith('+ ')).map((p) => p.slice(2)), summary: open.patch.some((p) => p.startsWith('саммари')), headline: open.patch.some((p) => p.startsWith('заголовок')) }} />
        </Modal>
      )}
    </div>
  );
}

function Timeline({ a, patch }: { a: Application; patch: (p: Record<string, unknown>) => Promise<unknown> }) {
  const [e, setE] = useState({ date: new Date().toLocaleDateString('sv-SE'), kind: 'заметка', text: '' });
  const KINDS = ['заметка', 'письмо', 'созвон', 'скрининг', 'интервью', 'тестовое', 'follow-up', 'отказ', 'оффер'];
  return (
    <section className="panel" style={{ maxWidth: 820 }}>
      <ul className="tl">
        {a.timeline.map((t, i) => (
          <li key={i}><span className="d">{fmtDate(t.date)}</span><span><span className="k">{t.kind}</span>{t.text}</span>
            <button className="icon-btn" aria-label="Удалить запись" onClick={() => void patch({ timeline: a.timeline.filter((_, j) => j !== i) })}>✕</button></li>
        ))}
      </ul>
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); if (!e.text.trim()) return; void act(() => api.post(`/api/applications/${a.id}/timeline`, e)).then(() => setE({ ...e, text: '' })); }}>
        <input type="date" value={e.date} onChange={(x) => setE({ ...e, date: x.target.value })} style={{ width: 'auto' }} aria-label="Дата" />
        <select value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value })} style={{ width: 'auto' }} aria-label="Тип">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input type="text" className="grow" value={e.text} onChange={(x) => setE({ ...e, text: x.target.value })} placeholder="Что произошло" style={{ width: 'auto' }} />
        <button className="btn">Добавить</button>
      </form>
    </section>
  );
}
