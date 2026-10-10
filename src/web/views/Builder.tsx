// «Конструктор резюме»: fact bank → recipe → live A4 sheet. For a vacancy — with a requirement coverage check.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadPost } from '../api';
import { act, toast, type State } from '../store';
import { go, href } from '../router';
import { copyText, Modal, Seg, StatusPill, TextInput, fmtDate, plural } from '../ui';
import { ResumeFrame } from '../components/ResumeFrame';
import { FactCard, useFactUsage } from '../components/FactCard';
import { canonical, cloneRecipe, diffRecipe, diffText, highlightFrom, pdfName, recipeIds, resolveRecipe } from '../../shared/resume';
import { slugify } from '../../shared/pipeline';
import type { Application, Fact, Lock, Recipe } from '../../shared/schema';

export function Builder({ s, appId }: { s: State; appId?: string }) {
  // the key resets working state when the vacancy changes
  return <BuilderInner key={appId || '—'} s={s} app={appId ? s.applications.find((a) => a.id === appId) : undefined} />;
}

function startRecipe(s: State, app?: Application, baseId?: string): Recipe | null {
  // working version → last locked → the track's base recipe
  const fromApp = app?.recipe || app?.locks.at(-1)?.recipe;
  if (fromApp && !baseId) return { ...cloneRecipe(fromApp), base: fromApp.base || fromApp.id };
  const base = s.recipes.find((r) => r.id === (baseId || app?.track)) || s.recipes[0];
  return base ? { ...cloneRecipe(base), base: base.id } : null;
}

function BuilderInner({ s, app }: { s: State; app?: Application }) {
  const [recipe, setRecipe] = useState<Recipe | null>(() => startRecipe(s, app));
  const [hl, setHl] = useState(true);
  const [q, setQ] = useState('');
  const [libMode, setLibMode] = useState<'all' | 'jd' | 'track'>('all');
  const [fill, setFill] = useState(0);
  const [editFact, setEditFact] = useState<string | null>(null);
  const [lastLock, setLastLock] = useState<Lock | null>(null);
  const [newTrack, setNewTrack] = useState<string | null>(null);
  const usage = useFactUsage(s);

  // autosave of the vacancy's working recipe
  const firstSave = useRef(true);
  useEffect(() => {
    if (!app || !recipe) return;
    if (firstSave.current) { firstSave.current = false; return; }
    const t = setTimeout(() => void api.put(`/api/applications/${app.id}/recipe`, { recipe }).catch((e) => toast(e.message, 'bad')), 700);
    return () => clearTimeout(t);
  }, [recipe, app?.id]);

  // a recipe may appear while the page is open: the first track created here, by the agent or in another tab
  useEffect(() => { if (!recipe && s.recipes.length) setRecipe(startRecipe(s, app)); }, [recipe, s.recipes.length]);

  const bank = useMemo(() => ({ experiences: s.experiences, facts: s.facts, summaries: s.summaries, profile: s.profile }), [s]);
  const factById = useMemo(() => new Map(s.facts.map((f) => [f.id, f])), [s.facts]);

  if (!recipe) return <FirstTrack s={s} />;
  const baseId = recipe.base || recipe.id;
  const base = s.recipes.find((r) => r.id === baseId);
  const resolved = resolveRecipe(recipe, bank);
  const diff = diffRecipe(recipe, base);
  const orgOf = (e: string) => s.experiences.find((x) => x.id === e)?.org || e;
  const sel = new Set(recipeIds(recipe));
  const selFacts = [...sel].map((id) => factById.get(id)).filter((f): f is Fact => !!f);
  const selTags = new Set(selFacts.flatMap((f) => f.tags));
  const reqs = app?.requirements || [];
  const cov = reqs.map((r) => {
    const ok = r.fact_ids.some((id) => sel.has(id)) || r.tags.some((t) => selTags.has(t));
    const cand = ok ? undefined : r.fact_ids.find((id) => factById.get(id)?.status !== 'draft' && !sel.has(id))
      || s.facts.find((f) => f.status !== 'draft' && !sel.has(f.id) && f.tags.some((t) => r.tags.includes(t)))?.id;
    const none = !ok && !cand;
    return { ...r, ok, cand, none };
  });
  const jdIds = new Set(reqs.flatMap((r) => r.fact_ids));
  const jdTags = new Set(reqs.flatMap((r) => r.tags));
  const isJd = (f: Fact) => jdIds.has(f.id) || f.tags.some((t) => jdTags.has(t));
  const proof = selFacts.filter((f) => f.status !== 'verified');
  const noNum = selFacts.filter((f) => !/\d/.test(f.text)).length;
  const dirtyBase = !app && base && canonical({ ...recipe, base: undefined }) !== canonical({ ...base, base: undefined });
  const sentLock = app?.locks.find((l) => l.hash === app.sent_lock);

  const set = (fn: (r: Recipe) => void) => setRecipe((r) => { if (!r) return r; const n = cloneRecipe(r); fn(n); return n; });
  const toggle = (f: Fact) => set((r) => {
    const list = r.facts[f.exp] ?? (r.facts[f.exp] = []);
    const i = list.indexOf(f.id);
    if (i >= 0) list.splice(i, 1); else list.push(f.id);
  });
  const move = (exp: string, id: string, to: number) => set((r) => {
    const list = r.facts[exp]; const i = list.indexOf(id);
    if (i < 0 || to < 0 || to >= list.length) return;
    list.splice(i, 1); list.splice(to, 0, id);
  });
  const switchBase = (id: string) => setRecipe(startRecipe(s, app, id));

  const ql = q.trim().toLowerCase();
  const visible = (f: Fact) =>
    (!ql || `${f.id} ${f.text} ${f.ru || ''} ${f.tags.join(' ')}`.toLowerCase().includes(ql))
    && (libMode !== 'jd' || isJd(f)) && (libMode !== 'track' || f.roles.includes(baseId));
  const pagesTarget = recipe.pages || 1;
  const fillPct = Math.round(fill * 100);
  const overflow = fill > pagesTarget + 0.005;

  const lock = async () => {
    if (!app) return;
    const l = await act(() => api.post<Lock>(`/api/applications/${app.id}/lock`, { recipe }));
    if (l) { setLastLock(l); toast(`Зафиксировано: lock ${l.hash}`); }
  };

  return (
    <>
      <header className="vh">
        <div>
          <h1>Конструктор резюме</h1>
          <p className="sub">{app
            ? <>Версия под <a href={href(`app/${app.id}`)}>{app.company_name || 'вакансию'} · {app.role}</a>. Сохраняется сама; отличия от базового рецепта подсвечены.</>
            : <>Базовые рецепты по трекам. Под конкретную вакансию открывай конструктор из её карточки или выбери вакансию ниже.</>}</p>
        </div>
      </header>

      <div className="b-bar">
        <label className="field"><span>Вакансия</span>
          <select value={app?.id || ''} onChange={(e) => go(e.target.value ? `builder/${e.target.value}` : 'builder')}>
            <option value="">— базовые рецепты —</option>
            {s.applications.filter((a) => !a.legacy && a.stage !== 'closed').map((a) => <option key={a.id} value={a.id}>{a.company_name || a.id} · {a.role}</option>)}
          </select>
        </label>
        <label className="field"><span>Базовый рецепт (трек)</span>
          <select value={baseId} onChange={(e) => switchBase(e.target.value)}>{s.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </label>
        <div className="meters">
          <span className={`pill ${overflow ? 'bad' : fill > pagesTarget - 0.04 ? 'warn' : 'good'}`}><i>{overflow ? '×' : '✓'}</i>{overflow ? `не влезает в ${pagesTarget} стр.: ${fillPct}%` : `${pagesTarget} стр., заполнено ${Math.round((fill / pagesTarget) * 100)}%`}</span>
          {cov.length > 0 && <span className={`pill ${cov.every((c) => c.ok) ? 'good' : 'warn'}`}><i>{cov.every((c) => c.ok) ? '✓' : '!'}</i>требования {cov.filter((c) => c.ok).length}/{cov.length}</span>}
          {proof.length > 0 && <span className="pill warn"><i>!</i>{proof.length} не проверено</span>}
          {sentLock && <span className="hash" title="Эта версия ушла работодателю">отправлен lock {sentLock.hash}</span>}
        </div>
      </div>

      {sentLock && <div className="callout" style={{ marginBottom: 12 }}>Резюме уже ушло в {app?.company_name || 'компанию'} (lock {sentLock.hash}). Отправленный lock не меняется; правки здесь станут новой версией.</div>}
      <div className="b-grid">
        <section className="panel">
          <div className="panel-h"><h2>Банк фактов</h2><a className="hint" href={href('facts')}>редактировать</a></div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по тексту, id, тегам…" aria-label="Поиск по фактам" />
          <Seg value={libMode} onChange={setLibMode} options={[['all', 'Все'], ['track', 'Под трек'], ...(reqs.length ? [['jd', 'Под вакансию'] as ['jd', string]] : [])]} />
          {!s.facts.length && <p className="hint">Банк фактов пуст. <a href={href('facts')}>Добавь опыт и факты</a> или наполни банк с Claude Code (<code className="mono">/fill</code>) — факты появятся здесь.</p>}
          {s.experiences.map((e) => {
            const fs = s.facts.filter((f) => f.exp === e.id && visible(f));
            if (!fs.length) return null;
            return (
              <div className="lib-g" key={e.id}>
                <h3>{e.org}</h3>
                {fs.map((f) => {
                  const on = sel.has(f.id);
                  return (
                    <div key={f.id} className={`fact ${on ? 'sel' : ''}`}>
                      <button className="add" onClick={() => toggle(f)} disabled={f.status === 'draft' && !on} title={f.status === 'draft' ? 'Черновик: сначала прими его в банке фактов' : on ? 'Убрать' : 'Добавить'} aria-label={on ? `Убрать ${f.id}` : `Добавить ${f.id}`}>{on ? '✓' : '+'}</button>
                      <div>
                        <div className="txt">{f.text || <span className="muted">пустой факт</span>}</div>
                        <div className="meta">
                          <span className="id">{f.id}</span>
                          {isJd(f) && reqs.length > 0 && <span className="jd" title="Закрывает требование вакансии">JD</span>}
                          {f.status !== 'verified' && <StatusPill s={f.status} />}
                          {usage.get(f.id) && <span className="hint">отправлен {usage.get(f.id)!.n}×</span>}
                          <button className="icon-btn" title="Редактировать факт" aria-label={`Редактировать ${f.id}`} onClick={() => setEditFact(f.id)}>✎</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Рецепт</h2><span className="hint">{base?.name}</span></div>
            <label className="field"><span>Заголовок под именем</span><TextInput value={recipe.headline} onCommit={(v) => set((r) => { r.headline = v; })} /></label>
            <label className="field"><span>Саммари · <a href={href('facts/summaries')}>редактировать</a></span>
              <select value={recipe.summary} onChange={(e) => set((r) => { r.summary = e.target.value; })}>
                <option value="">— без саммари —</option>
                {s.summaries.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}{x.status !== 'verified' ? ' (не проверено)' : ''}</option>)}
              </select>
            </label>
            {s.experiences.map((e) => <Block key={e.id} exp={e.id} s={s} recipe={recipe} base={base} factById={factById} set={set} move={move} />)}
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Отличия от базы</h2><label className="row small"><input type="checkbox" checked={hl} onChange={(e) => setHl(e.target.checked)} /> подсветить</label></div>
            <ul className="diff">{diff.length ? diff.map((d, i) => <li key={i} className={d.kind}>{diffText(d, orgOf)}</li>) : <li>совпадает с базовым рецептом — вычитывать нечего</li>}</ul>
          </section>

          <section className="panel">
            <h2>Проверки</h2>
            <ul className="checks">
              <li>{overflow ? <span className="pill bad"><i>×</i>страница</span> : <span className="pill good"><i>✓</i>страница</span>}
                <span>{overflow ? `Не влезает в ${pagesTarget} стр. Убери факт или замени на короткий вариант.` : `Влезает в ${pagesTarget} стр.`}</span></li>
              {cov.map((c, i) => (
                <li key={i}>{c.ok ? <span className="pill good"><i>✓</i>JD</span> : <span className="pill warn"><i>!</i>JD</span>}
                  <span>{c.text}{!c.ok && c.cand && <> · <button className="btn sm" onClick={() => { const f = factById.get(c.cand!); if (f) toggle(f); }}>+ {c.cand}</button></>}{c.none && <span className="hint"> · фактов под это нет: кандидат в банк</span>}</span></li>
              ))}
              {proof.map((f) => <li key={f.id}><StatusPill s={f.status} /><span><span className="id">{f.id}</span> {f.status === 'draft' ? 'Черновик в резюме не попадает: прими его в банке фактов или убери из рецепта. ' : ''}{f.note}</span></li>)}
              <li><span className="pill"><i>#</i>цифры</span><span>{!selFacts.length ? 'Буллетов пока нет — отметь факты в банке слева' : noNum ? `${noNum} ${plural(noNum, 'буллет', 'буллета', 'буллетов')} без цифр` : 'В каждом буллете есть цифра'}</span></li>
            </ul>
            <div className="row">
              {app && <button className="btn primary" onClick={() => void lock()}>Зафиксировать (lock)</button>}
              {!app && dirtyBase && <button className="btn primary" onClick={() => void act(() => api.put(`/api/recipes/${baseId}`, { ...recipe, base: undefined }), `Базовый рецепт «${base?.name}» сохранён`)}>Сохранить базовый рецепт</button>}
              {!app && dirtyBase && <button className="btn ghost" onClick={() => switchBase(baseId)}>Сбросить</button>}
              <button className="btn" onClick={() => void act(() => downloadPost('/api/resume/pdf', { recipe }, pdfName(resolved.name, resolved.headline)))}>Скачать PDF</button>
              <button className="btn" onClick={() => void act(async () => { const t = await api.post<string>('/api/resume/text', { recipe }); toast((await copyText(t)) ? 'Текст для формы скопирован' : 'Не удалось скопировать'); })}>Текст для формы</button>
              {!app && <button className="btn ghost" onClick={() => setNewTrack('')}>Сохранить как новый трек</button>}
            </div>
            {app && (lastLock || app.locks.length > 0) && (
              <LockBox app={app} lock={lastLock || app.locks.at(-1)!} />
            )}
          </section>
        </div>

        <section className="preview-col">
          <ResumeFrame resolved={resolved} highlight={hl ? highlightFrom(diff) : undefined} onMeasure={setFill} />
        </section>
      </div>

      {editFact && factById.get(editFact) && (
        <Modal onClose={() => setEditFact(null)} title="Факт">
          <FactCard f={factById.get(editFact)!} s={s} usage={usage.get(editFact)} />
          <p className="hint">Правка факта меняет банк: она попадёт во все резюме, кроме уже зафиксированных.</p>
        </Modal>
      )}
      {newTrack !== null && (
        <Modal narrow onClose={() => setNewTrack(null)} title="Новый трек">
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            const name = newTrack.trim(); if (!name) return;
            void act(() => api.post('/api/recipes', { ...recipe, base: undefined, id: slugify(name), name, headline: recipe.headline }), `Трек «${name}» создан`).then(() => setNewTrack(null));
          }}>
            <label className="field"><span>Название</span><input type="text" autoFocus value={newTrack} onChange={(e) => setNewTrack(e.target.value)} placeholder="Например, Product Manager" /></label>
            <p className="hint">Текущий набор фактов станет базовым рецептом нового трека.</p>
            <div className="row"><button className="btn primary">Создать</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Empty state: no base recipes yet. Creates the first track; the builder opens on it once the state reloads. */
function FirstTrack({ s }: { s: State }) {
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState(s.summaries[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const id = slugify(name);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await act(() => api.post('/api/recipes', { id, name: name.trim(), headline: headline.trim(), summary, facts: {}, template: 'classic', pages: 1 }), `Трек «${name.trim()}» создан`);
    setBusy(false);
  };
  return (
    <>
      <header className="vh">
        <div><h1>Конструктор резюме</h1><p className="sub">Резюме собирается из фактов банка по рецепту: какие факты, в каком порядке, заголовок и саммари. На каждый трек — свой базовый рецепт, под вакансию — копия с отличиями от базы.</p></div>
      </header>
      <section className="panel stack" style={{ maxWidth: 640 }}>
        <h2>Создай первый трек</h2>
        <p className="hint">Трек — направление ролей, на которые ты откликаешься. Хватит одного; ещё треки можно сохранить из конструктора позже. Рецепты лежат в <span className="mono">04-resume/recipes/</span>.</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="field"><span>Название трека</span><input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Product Manager" /></label>
          <label className="field"><span>Заголовок под именем (по-английски, можно позже)</span><input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Senior Product Manager" /></label>
          {s.summaries.length > 0 && (
            <label className="field"><span>Саммари</span>
              <select value={summary} onChange={(e) => setSummary(e.target.value)}>
                <option value="">— без саммари —</option>
                {s.summaries.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
              </select>
            </label>
          )}
          {name.trim() && <p className="hint">id трека: <span className="mono">{id}</span> — на него будут ссылаться отклики, не меняй его потом.</p>}
          <div className="row"><button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Создаю…' : 'Создать трек'}</button></div>
        </form>
        {!s.facts.length && <p className="callout">Банк фактов пока пуст — резюме будет без буллетов. Начни с <a href={href('facts')}>банка фактов</a> или сессии <code className="mono">/fill</code> в Claude Code.</p>}
      </section>
    </>
  );
}

function Block({ exp, s, recipe, base, factById, set, move }: {
  exp: string; s: State; recipe: Recipe; base?: Recipe; factById: Map<string, Fact>;
  set: (fn: (r: Recipe) => void) => void; move: (exp: string, id: string, to: number) => void;
}) {
  const e = s.experiences.find((x) => x.id === exp)!;
  const ids = recipe.facts[exp];
  const baseIds = base?.facts[exp] || [];
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (ids === undefined) {
    return (
      <div className="blk"><div className="blk-h"><span className="muted">{e.org} — скрыт</span>
        <button className="btn sm ghost" onClick={() => set((r) => { r.facts[exp] = []; })}>Показать</button></div></div>
    );
  }
  return (
    <div className="blk">
      <div className="blk-h"><span><b>{e.org}</b>{e.title && <span className="muted"> · {e.title}</span>}</span>
        <button className="btn sm ghost" onClick={() => set((r) => { delete r.facts[exp]; })}>Скрыть блок</button></div>
      {ids.length === 0 && <div className="r-empty">{e.kind === 'section' ? 'пусто — секция не попадёт в резюме' : 'только строка с ролью и датами'}</div>}
      {ids.map((id, i) => {
        const f = factById.get(id);
        return (
          <div key={id} className={`ri ${baseIds.includes(id) ? '' : 'new'} ${over === id && drag !== id ? 'over' : ''}`} draggable
            onDragStart={() => setDrag(id)} onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={(ev) => { ev.preventDefault(); setOver(id); }}
            onDrop={(ev) => { ev.preventDefault(); if (drag && drag !== id) move(exp, drag, i); setDrag(null); setOver(null); }}>
            <span>{f ? f.text : <span className="muted">нет факта {id} в банке</span>}</span>
            <span className="ctl">
              <button className="icon-btn" disabled={i === 0} onClick={() => move(exp, id, i - 1)} aria-label="Выше">↑</button>
              <button className="icon-btn" disabled={i === ids.length - 1} onClick={() => move(exp, id, i + 1)} aria-label="Ниже">↓</button>
              <button className="icon-btn" onClick={() => set((r) => { r.facts[exp] = r.facts[exp].filter((x) => x !== id); })} aria-label="Убрать">✕</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LockBox({ app, lock }: { app: Application; lock: Lock }) {
  const sent = app.sent_lock === lock.hash;
  return (
    <div className="callout good stack tight">
      <div className="row"><span className="hash">lock {lock.hash}</span><span>зафиксирован {fmtDate(lock.created_at)}</span>{sent && <b>· отправлен</b>}</div>
      <div className="row">
        <a className="btn sm" href={`/api/applications/${app.id}/locks/${lock.hash}/pdf`} target="_blank" rel="noreferrer">Открыть PDF</a>
        <a className="btn sm" href={`/api/applications/${app.id}/locks/${lock.hash}/pdf?download=1`}>Скачать</a>
        {!sent && <button className="btn sm primary" onClick={() => void act(() => api.post(`/api/applications/${app.id}/send`, { hash: lock.hash }), `Отклик отмечен, follow-up через 7 дней`)}>Отметить отправленным</button>}
        <a className="btn sm ghost" href={href(`app/${app.id}/resume`)}>Все версии</a>
      </div>
    </div>
  );
}
