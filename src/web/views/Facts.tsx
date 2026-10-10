// «Банк фактов»: experiences and facts, summaries, profile, ICP criteria.
import { useMemo, useState } from 'react';
import { api } from '../api';
import { act, type State } from '../store';
import { href } from '../router';
import { AutoText, ConfirmButton, Seg, TextInput, plural } from '../ui';
import { FactCard, useFactUsage } from '../components/FactCard';
import { FACT_STATUSES, type Experience, type FactStatus, type Icp, type Profile, type Summary } from '../../shared/schema';
import { period } from '../../shared/resume';
import { slugify } from '../../shared/pipeline';

const TABS: [string, string][] = [['', 'Факты'], ['summaries', 'Саммари'], ['profile', 'Профиль'], ['icp', 'Критерии ICP']];

export function Facts({ s, section }: { s: State; section?: string }) {
  const tab = ['summaries', 'profile', 'icp'].includes(section || '') ? section! : '';
  return (
    <>
      <header className="vh">
        <div><h1>Банк фактов</h1><p className="sub">Одна цифра живёт в одном месте. Резюме, истории для интервью и разбор вакансий ссылаются на эти записи по id. Всё сохраняется в 00-profile/ при выходе из поля.</p></div>
      </header>
      <nav className="tabs">{TABS.map(([t, l]) => <a key={t} href={href(t ? `facts/${t}` : 'facts')} className={tab === t ? 'on' : ''}>{l}</a>)}</nav>
      {tab === '' && <FactsTab s={s} exp={section} />}
      {tab === 'summaries' && <SummariesTab s={s} />}
      {tab === 'profile' && <ProfileTab p={s.profile} />}
      {tab === 'icp' && <IcpTab icp={s.icp} />}
    </>
  );
}

function FactsTab({ s, exp }: { s: State; exp?: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | FactStatus>('all');
  const [tag, setTag] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [newExp, setNewExp] = useState(false);
  const usage = useFactUsage(s);
  const tags = useMemo(() => [...new Set(s.facts.flatMap((f) => f.tags))].sort(), [s.facts]);
  const ql = q.trim().toLowerCase();
  const match = (f: (typeof s.facts)[number]) =>
    (status === 'all' || f.status === status) && (!tag || f.tags.includes(tag))
    && (!ql || `${f.id} ${f.text} ${f.ru || ''} ${f.short || ''} ${f.tags.join(' ')} ${f.metrics.join(' ')}`.toLowerCase().includes(ql));
  const exps = exp && s.experiences.some((e) => e.id === exp) ? s.experiences.filter((e) => e.id === exp) : s.experiences;

  // Vacancy requirements with no matching facts in the bank — candidates for new facts
  const gaps = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const a of s.applications) {
      if (a.stage === 'closed') continue;
      for (const r of a.requirements) {
        if (r.fact_ids.length || s.facts.some((f) => f.status !== 'draft' && f.tags.some((t) => r.tags.includes(t)))) continue;
        out.set(r.text, [...(out.get(r.text) || []), a.company_name || a.id]);
      }
    }
    return [...out.entries()];
  }, [s.applications, s.facts]);
  const proof = s.facts.filter((f) => f.status === 'needs-proof').length;
  const drafts = s.facts.filter((f) => f.status === 'draft').length;

  return (
    <div className="f-layout">
      <aside className="f-side" aria-label="Опыт">
        <a href={href('facts')} className={!exp ? 'on' : ''}><span>Весь опыт</span><span className="badge">{s.facts.length}</span></a>
        {s.experiences.map((e) => (
          <a key={e.id} href={href(`facts/${e.id}`)} className={exp === e.id ? 'on' : ''}><span>{e.org}</span><span className="badge">{s.facts.filter((f) => f.exp === e.id).length}</span></a>
        ))}
        <button className="btn sm ghost" onClick={() => setNewExp(true)}>+ Опыт</button>
      </aside>
      <div className="stack">
        {(proof > 0 || drafts > 0 || gaps.length > 0) && (
          <section className="panel">
            <h3>Что дополнить</h3>
            <div className="row">
              {proof > 0 && <button className="pill warn" onClick={() => setStatus('needs-proof')}><i>!</i>{proof} {plural(proof, 'факт', 'факта', 'фактов')} нужно подкрепить</button>}
              {drafts > 0 && <button className="pill accent" onClick={() => setStatus('draft')}><i>✎</i>{drafts} {plural(drafts, 'черновик ждёт', 'черновика ждут', 'черновиков ждут')} решения</button>}
            </div>
            {gaps.length > 0 && <>
              <p className="hint">Вакансии просят, а фактов нет:</p>
              <ul className="list">{gaps.slice(0, 10).map(([t, cs]) => <li key={t}>{t} <span className="muted">— {cs.join(', ')}</span></li>)}</ul>
            </>}
          </section>
        )}
        <div className="row">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по тексту, id, метрике" style={{ maxWidth: 300 }} aria-label="Поиск" />
          <Seg value={status} onChange={setStatus} options={[['all', 'Все'], ...FACT_STATUSES.map((x) => [x, x === 'verified' ? 'Проверены' : x === 'needs-proof' ? 'Подкрепить' : 'Черновики'] as [FactStatus, string])]} />
          <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} aria-label="Тег"><option value="">все теги</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
        </div>
        {newExp && <NewExperience onDone={() => setNewExp(false)} />}
        {!s.experiences.length && !newExp && (
          <div className="callout stack tight">
            <b>Банк пуст.</b>
            <span>Нажми «+ Опыт» (место работы или секция резюме — проекты, преподавание), потом добавляй в него факты: глагол, что сделал, масштаб, цифра. Быстрее — сбросить сырьё в <a href={href('fill')}>«Наполнении»</a> и пройти сессию <code className="mono">/fill</code> в Claude Code: он задаст вопросы и запишет черновики.</span>
            <div><button className="btn sm primary" onClick={() => setNewExp(true)}>+ Опыт</button></div>
          </div>
        )}
        {exps.map((e) => {
          const fs = s.facts.filter((f) => f.exp === e.id && match(f));
          const total = s.facts.filter((f) => f.exp === e.id).length;
          return (
            <section className="f-exp" key={e.id}>
              <ExperienceHeader e={e} count={total} />
              {adding === e.id ? <NewFact exp={e.id} onDone={() => setAdding(null)} /> : <div><button className="btn sm" onClick={() => setAdding(e.id)}>+ Факт в {e.org}</button></div>}
              {fs.map((f) => <FactCard key={f.id} f={f} s={s} usage={usage.get(f.id)} />)}
              {total > 0 && fs.length === 0 && <p className="hint">Под фильтр ничего не подходит.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ExperienceHeader({ e, count }: { e: Experience; count: number }) {
  const [open, setOpen] = useState(false);
  const save = (p: Partial<Experience>) => act(() => api.put(`/api/experiences/${e.id}`, { ...e, ...p }));
  return (
    <div className="stack tight">
      <div className="f-exp-h">
        <span><b>{e.org}</b> <span className="muted">{e.kind === 'section' ? 'секция резюме' : [e.title, period(e.start, e.end)].filter(Boolean).join(' · ')}</span></span>
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'Свернуть' : 'Изменить опыт'}</button>
      </div>
      {e.blurb && !open && <p className="hint">{e.blurb}</p>}
      {open && (
        <section className="panel">
          <div className="fields">
            <label className="field"><span>{e.kind === 'section' ? 'Заголовок секции' : 'Компания'}</span><TextInput value={e.org} onCommit={(v) => void save({ org: v })} /></label>
            {e.kind === 'job' && <label className="field"><span>Должность</span><TextInput value={e.title} onCommit={(v) => void save({ title: v })} /></label>}
            {e.kind === 'job' && <label className="field"><span>Начало (ГГГГ-ММ)</span><TextInput value={e.start || ''} onCommit={(v) => void save({ start: v })} placeholder="2022-03" /></label>}
            {e.kind === 'job' && <label className="field"><span>Конец (ГГГГ-ММ или present)</span><TextInput value={e.end || ''} onCommit={(v) => void save({ end: v })} placeholder="present" /></label>}
            {e.kind === 'job' && <label className="field"><span>Локация</span><TextInput value={e.location || ''} onCommit={(v) => void save({ location: v })} /></label>}
            <label className="field"><span>Порядок</span><TextInput value={String(e.order)} onCommit={(v) => void save({ order: Number(v) || 0 })} /></label>
            <label className="field"><span>Тип</span><select value={e.kind} onChange={(x) => void save({ kind: x.target.value as Experience['kind'] })}><option value="job">место работы</option><option value="section">секция</option></select></label>
          </div>
          <label className="field"><span>Описание для себя</span><AutoText value={e.blurb || ''} onCommit={(v) => void save({ blurb: v })} rows={1} /></label>
          {count === 0 && <div><ConfirmButton onConfirm={() => void act(() => api.del(`/api/experiences/${e.id}`), 'Опыт удалён')}>Удалить опыт</ConfirmButton></div>}
        </section>
      )}
    </div>
  );
}

function NewFact({ exp, onDone }: { exp: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [id, setId] = useState('');
  const [status, setStatus] = useState<FactStatus>('verified');
  const auto = `${exp}.${slugify(text).split('-').filter((w) => w.length > 2).slice(0, 3).join('-') || 'fact'}`;
  return (
    <form className="fc" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void act(() => api.post('/api/facts', { exp, id: id.trim() || auto, text: text.trim(), status }), 'Факт добавлен').then((r) => r && onDone()); }}>
      <textarea autoFocus className="main" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Led …, cut … from X to Y, shipped … to …" />
      <div className="row">
        <label className="field" style={{ minWidth: 260 }}><span>id</span><input type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder={auto} /></label>
        <Seg value={status} onChange={setStatus} options={[['verified', 'Проверен'], ['needs-proof', 'Подкрепить'], ['draft', 'Черновик']]} />
        <span className="grow" />
        <button className="btn primary">Добавить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
      <p className="hint">Теги, метрики и треки — после создания, в карточке факта.</p>
    </form>
  );
}

function NewExperience({ onDone }: { onDone: () => void }) {
  const [e, setE] = useState({ org: '', title: '', start: '', end: '', kind: 'job' as Experience['kind'] });
  return (
    <form className="panel" onSubmit={(ev) => { ev.preventDefault(); if (!e.org.trim()) return; void act(() => api.post('/api/experiences', { ...e, id: slugify(e.org) }), 'Опыт добавлен').then((r) => r && onDone()); }}>
      <h3>Новый опыт</h3>
      <div className="fields">
        <label className="field"><span>Компания или секция</span><input type="text" autoFocus value={e.org} onChange={(x) => setE({ ...e, org: x.target.value })} /></label>
        <label className="field"><span>Тип</span><select value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value as Experience['kind'] })}><option value="job">место работы</option><option value="section">секция (проекты, преподавание)</option></select></label>
        {e.kind === 'job' && <label className="field"><span>Должность</span><input type="text" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></label>}
        {e.kind === 'job' && <label className="field"><span>Начало</span><input type="text" value={e.start} onChange={(x) => setE({ ...e, start: x.target.value })} placeholder="2022-03" /></label>}
        {e.kind === 'job' && <label className="field"><span>Конец</span><input type="text" value={e.end} onChange={(x) => setE({ ...e, end: x.target.value })} placeholder="present" /></label>}
      </div>
      <div className="row"><button className="btn primary">Добавить</button><button type="button" className="btn ghost" onClick={onDone}>Отмена</button></div>
    </form>
  );
}

function SummariesTab({ s }: { s: State }) {
  const save = (list: Summary[], msg: string) => act(() => api.put('/api/summaries', { summaries: list, message: msg }));
  const upd = (i: number, p: Partial<Summary>) => void save(s.summaries.map((x, j) => (j === i ? { ...x, ...p } : x)), `саммари ${s.summaries[i].id} изменено`);
  const [nid, setNid] = useState('');
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      {s.summaries.map((x, i) => (
        <article key={x.id} className={`fc ${x.status}`}>
          <div className="fc-h">
            <div className="row"><span className="id">{x.id}</span><TextInput value={x.label} onCommit={(v) => upd(i, { label: v })} placeholder="Название варианта" /></div>
            <Seg value={x.status} onChange={(v) => upd(i, { status: v })} options={[['verified', 'Проверен'], ['needs-proof', 'Подкрепить'], ['draft', 'Черновик']]} />
          </div>
          <AutoText className="main" value={x.text} onCommit={(v) => upd(i, { text: v })} />
          <div className="row">
            <span className="hint">Используется в: {s.recipes.filter((r) => r.summary === x.id).map((r) => r.name).join(', ') || 'нигде'}</span>
            <span className="grow" />
            <ConfirmButton onConfirm={() => void save(s.summaries.filter((_, j) => j !== i), `саммари ${x.id} удалено`)}>Удалить</ConfirmButton>
          </div>
        </article>
      ))}
      <form className="row" onSubmit={(e) => { e.preventDefault(); const id = slugify(nid); if (!id || s.summaries.some((x) => x.id === id)) return; void save([...s.summaries, { id, label: nid, text: '', status: 'draft', roles: [] }], `саммари ${id} создано`); setNid(''); }}>
        <input type="text" value={nid} onChange={(e) => setNid(e.target.value)} placeholder="Новый вариант: название" style={{ maxWidth: 300 }} />
        <button className="btn">Добавить вариант</button>
      </form>
    </div>
  );
}

function ProfileTab({ p }: { p: Profile }) {
  // only the changed field goes to the server (merged there), so fast consecutive commits don't overwrite each other
  const save = (patch: Partial<Profile>) => act(() => api.put('/api/profile', patch));
  const c = p.contacts || {};
  const setC = (k: keyof Profile['contacts'], v: string) => void save({ contacts: { [k]: v } });
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <section className="panel">
        <h3>Шапка резюме</h3>
        <div className="fields">
          <label className="field"><span>Имя</span><TextInput value={p.name} onCommit={(v) => void save({ name: v })} /></label>
          <label className="field"><span>Локация</span><TextInput value={p.location} onCommit={(v) => void save({ location: v })} /></label>
          <label className="field"><span>Email</span><TextInput value={c.email || ''} onCommit={(v) => setC('email', v)} /></label>
          <label className="field"><span>Телефон</span><TextInput value={c.phone || ''} onCommit={(v) => setC('phone', v)} /></label>
          <label className="field"><span>LinkedIn</span><TextInput value={c.linkedin || ''} onCommit={(v) => setC('linkedin', v)} placeholder="linkedin.com/in/…" /></label>
          <label className="field"><span>GitHub</span><TextInput value={c.github || ''} onCommit={(v) => setC('github', v)} /></label>
          <label className="field"><span>Сайт</span><TextInput value={c.website || ''} onCommit={(v) => setC('website', v)} /></label>
        </div>
      </section>
      <section className="panel">
        <h3>Образование</h3>
        {p.education.map((ed, i) => {
          const upd = (q: Partial<typeof ed>) => void save({ education: p.education.map((x, j) => (j === i ? { ...x, ...q } : x)) });
          return (
            <div className="fields" key={ed.id}>
              <label className="field"><span>Вуз</span><TextInput value={ed.school} onCommit={(v) => upd({ school: v })} /></label>
              <label className="field"><span>Направление</span><TextInput value={ed.field} onCommit={(v) => upd({ field: v })} /></label>
              <label className="field"><span>Степень</span><TextInput value={ed.degree || ''} onCommit={(v) => upd({ degree: v })} placeholder="MSc, BSc…" /></label>
              <label className="field"><span>Годы</span><div className="row" style={{ flexWrap: 'nowrap' }}><TextInput value={ed.start || ''} onCommit={(v) => upd({ start: v })} /><TextInput value={ed.end || ''} onCommit={(v) => upd({ end: v })} /></div></label>
            </div>
          );
        })}
        <div><button className="btn sm" onClick={() => void save({ education: [...p.education, { id: `edu-${p.education.length + 1}`, school: 'Новый вуз', field: '' }] })}>+ Образование</button></div>
      </section>
      <section className="panel">
        <h3>Позиционирование</h3>
        <p className="hint">Одна-две строки по-английски о том, кто ты и что ищешь. Claude использует это при разборе вакансий и подготовке к интервью. Подробный нарратив — в <span className="mono">00-profile/positioning.md</span>.</p>
        <AutoText value={p.positioning || ''} onCommit={(v) => void save({ positioning: v })} placeholder="Product manager with 6 years in B2B SaaS, looking for a senior PM role" />
      </section>
      <section className="panel">
        <h3>Контекст поиска</h3>
        <p className="hint">Свободный текст по-английски для Claude: часовой пояс, где живёшь и готов ли к переезду, формат найма (штат, контрактор, EoR), другие ограничения — офис или удалёнка, право на работу, виза. Уходит в запросы к Claude при разборе вакансий (флаги, fit) и подготовке к интервью. Пусто — не учитывается. В резюме не попадает.</p>
        <AutoText value={p.context || ''} onCommit={(v) => void save({ context: v })} placeholder="Based in Lisbon (UTC+0). Open to remote EU roles or hybrid in Lisbon. Employee, contractor or EoR. No relocation to the US." />
      </section>
    </div>
  );
}

function IcpTab({ icp }: { icp: Icp }) {
  const save = (criteria: Icp['criteria']) => act(() => api.put('/api/icp', { criteria }));
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <p className="hint">По каждому критерию Claude ставит вакансии 0–2. Сумма — fit-score на карточке. «Целюсь» — что тебе подходит, «Отсекаю» — что не подходит. Пиши конкретно: «продуктовая компания после раунда, команда 50–500» работает лучше, чем «хорошая компания».</p>
      {!icp.criteria.length && <p className="callout">Критериев пока нет — без них Claude не ставит fit. Добавь 4–6 штук: формат и таймзона, право на работу, сегмент, стадия компании, роль, компенсация.</p>}
      {icp.criteria.map((c, i) => {
        const upd = (q: Partial<typeof c>) => void save(icp.criteria.map((x, j) => (j === i ? { ...x, ...q } : x)));
        return (
          <section className="panel" key={c.id}>
            <div className="row"><span className="id">{c.id}</span><TextInput value={c.name} onCommit={(v) => upd({ name: v })} /></div>
            <label className="field"><span>Целюсь</span><AutoText value={c.target} rows={1} onCommit={(v) => upd({ target: v })} /></label>
            <label className="field"><span>Отсекаю</span><AutoText value={c.reject} rows={1} onCommit={(v) => upd({ reject: v })} /></label>
            <div><ConfirmButton onConfirm={() => void save(icp.criteria.filter((_, j) => j !== i))}>Удалить критерий</ConfirmButton></div>
          </section>
        );
      })}
      <div><button className="btn sm" onClick={() => void save([...icp.criteria, { id: `c${icp.criteria.length + 1}`, name: 'Новый критерий', target: '', reject: '' }])}>+ Критерий</button></div>
    </div>
  );
}
