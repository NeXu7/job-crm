import { useEffect, useState } from 'react';
import { api } from '../api';
import { href } from '../router';
import { dueLabel, fmtDate, plural } from '../ui';
import { daysBetween, stageIndex } from '../../shared/pipeline';
import type { Application, JournalEntry, Stage } from '../../shared/schema';
import type { State } from '../store';
import { prepStats } from './Prep';

type Row = { a: Application; pills: [string, string, string][]; sev: number };

export function actionRows(s: State): Row[] {
  const rows: Row[] = [];
  for (const a of s.applications) {
    if (a.stage === 'closed') continue;
    const pills: Row['pills'] = [];
    let sev = 0;
    if (a.next) {
      const d = daysBetween(s.today, a.next.date);
      if (d < 0) { pills.push(['bad', '×', dueLabel(d)]); sev = 3; }
      else if (d <= 4) { pills.push([d <= 1 ? 'warn' : '', '', dueLabel(d)]); sev = Math.max(sev, d <= 1 ? 2 : 1); }
    }
    if (a.capture.status === 'running' || a.analysis.status === 'running') pills.push(['accent', '', 'разбирается']);
    if (a.capture.status === 'authwall') { pills.push(['warn', '!', 'нужен захват из браузера']); sev = Math.max(sev, 2); }
    if (a.analysis.status === 'failed' || a.capture.status === 'failed') { pills.push(['bad', '!', 'ошибка разбора']); sev = Math.max(sev, 2); }
    if (a.stage === 'research' && !(a.whyThem.trim() && a.whyMe.trim())) { pills.push(['', '', 'нет «почему они»']); sev = Math.max(sev, 1); }
    if (a.stage === 'ready' && !a.locks.length) { pills.push(['', '', 'нет резюме']); sev = Math.max(sev, 1); }
    if (a.flags.length && stageIndex(a.stage) <= stageIndex('ready')) { pills.push(['warn', '!', 'красный флаг']); sev = Math.max(sev, 2); }
    if (stageIndex(a.stage) >= stageIndex('screen') && stageIndex(a.stage) <= stageIndex('interview')) {
      const p = prepStats(a, s);
      if (p.open) { pills.push(['', '', `подготовка: ${p.label}`]); sev = Math.max(sev, 1); }
    }
    if (pills.length) rows.push({ a, pills, sev });
  }
  return rows.sort((x, y) => y.sev - x.sev || (x.a.next?.date || '9').localeCompare(y.a.next?.date || '9'));
}

const FUNNEL: [string, Stage][] = [['Найдено', 'research'], ['Готов к отклику', 'ready'], ['Отклик', 'applied'], ['Ответ компании', 'screen'], ['Интервью', 'interview'], ['Оффер', 'offer']];

export function Today({ s }: { s: State }) {
  const [journal, setJournal] = useState<{ entries: JournalEntry[]; dirty: string[] } | null>(null);
  useEffect(() => { void api.get<typeof journal>('/api/journal').then(setJournal); }, [s]);

  const rows = actionRows(s);
  const apps = s.applications;
  const reached = (st: Stage) => apps.filter((a) => stageIndex(a.reached) >= stageIndex(st)).length;
  const fd = FUNNEL.map(([l, st], i) => ({ l, n: reached(st), prev: i ? reached(FUNNEL[i - 1][1]) : null }));
  const max = Math.max(1, fd[0].n);
  const active = apps.filter((a) => a.stage !== 'closed' && stageIndex(a.stage) >= stageIndex('applied')).length;
  const inInt = apps.filter((a) => a.stage !== 'closed' && stageIndex(a.stage) >= stageIndex('screen')).length;
  const overdue = apps.filter((a) => a.stage !== 'closed' && a.next && daysBetween(s.today, a.next.date) < 0).length;
  const proof = s.facts.filter((f) => f.status === 'needs-proof').length;
  const drafts = s.facts.filter((f) => f.status === 'draft').length;
  const dl = new Date(s.today + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  // first run: an empty profile or fact bank — point to the checklist
  const firstRun = [!s.profile.name?.trim() && 'в профиле нет имени', !s.facts.length && 'банк фактов пуст'].filter(Boolean);

  return (
    <>
      <header className="vh"><div><h1>{dl[0].toUpperCase() + dl.slice(1)}</h1><p className="sub">Что требует действия, как идёт воронка и кто что менял в данных.</p></div></header>
      {s.errors.length > 0 && (
        <div className="callout bad" style={{ marginBottom: 14 }}>
          <b>Файлы с ошибками — они не загружены:</b>
          <ul className="list">{s.errors.map((e) => <li key={e.file}><span className="mono">{e.file}</span>: {e.message.slice(0, 300)}</li>)}</ul>
        </div>
      )}
      {!!s.warnings?.length && (
        <div className="callout warn" style={{ marginBottom: 14 }}>
          <b>Окружение:</b>
          <ul className="list">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {firstRun.length > 0 && (
        <div className="callout" style={{ marginBottom: 14 }}>
          <b>Похоже, CRM только настроена:</b> {firstRun.join(', ')}. Открой <a href={href('guide/start')}>«Как пользоваться» → «С чего начать»</a> — там чек-лист первых шагов по твоим данным: профиль, критерии ICP, первые факты, резюме и вакансия.
        </div>
      )}
      {s.claude.status === 'auth' && <div className="callout warn" style={{ marginBottom: 14 }}>{s.claude.message} Без этого вакансии сохраняются, но не разбираются; после входа упавшие разборы перезапустятся сами.</div>}
      <div className="strip">
        <div className="stat"><b>{active}</b><span>активных откликов</span></div>
        <div className="stat"><b>{inInt}</b><span>на этапе интервью</span></div>
        <div className="stat"><b style={{ color: overdue ? 'var(--bad)' : undefined }}>{overdue}</b><span>просрочено</span></div>
        <div className="stat"><b>{s.facts.length}</b><span>фактов в банке{proof || drafts ? ` · ${proof} подкрепить, ${drafts} черновиков` : ''}</span></div>
      </div>
      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>Требует действия</h2>
            {rows.length ? (
              <ul className="todo">
                {rows.map((r) => (
                  <li key={r.a.id}>
                    <a href={href(`app/${r.a.id}`)}>
                      <span className="who">{r.a.company_name || 'Без компании'} <span>· {r.a.role || 'роль не указана'}</span></span>
                      <span className="pills">{r.pills.map((p, i) => <span key={i} className={`pill ${p[0]}`}>{p[1] && <i>{p[1]}</i>}{p[2]}</span>)}</span>
                      <span className="what">{r.a.next?.text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">Срочного нет. Хорошее время пополнить банк фактов или добавить вакансию.</p>}
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Журнал изменений</h2><span className="hint">git log по данным</span></div>
            {journal?.dirty.length ? <p className="callout">Не закоммичено: {journal.dirty.length} {plural(journal.dirty.length, 'файл', 'файла', 'файлов')} ({journal.dirty.slice(0, 3).join(', ')}{journal.dirty.length > 3 ? '…' : ''})</p> : null}
            {journal?.entries.length ? (
              <ul className="feed">
                {journal.entries.slice(0, 14).map((e) => (
                  <li key={e.hash}>
                    <span className={`av ${e.agent}`} aria-hidden="true">{e.agent === 'claude' ? 'C' : e.agent === 'ui' ? 'Я' : '·'}</span>
                    <div><div className="t"><b>{e.agent === 'claude' ? 'Claude' : e.agent === 'ui' ? 'Интерфейс' : 'Git'}</b> · {fmtDate(e.date)} {e.date.slice(11, 16)} · <span className="mono">{e.hash}</span></div><p>{e.subject}</p></div>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">Пока пусто.</p>}
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <h2>Воронка</h2>
            <div className="funnel">
              {fd.map((r) => {
                const pct = r.prev ? Math.round((r.n / r.prev) * 100) : null;
                return (
                  <div key={r.l} style={{ display: 'contents' }}>
                    <div className="lbl">{r.l}</div>
                    <div className="track" title={r.prev !== null ? `${r.n} из ${r.prev}` : String(r.n)}><div className="bar" style={{ width: `${r.n ? Math.max(2, (r.n / max) * 100) : 0}%` }} /></div>
                    <div className="val">{r.n}<span>{pct !== null ? `${pct}%` : ' '}</span></div>
                  </div>
                );
              })}
            </div>
            <p className="hint">n = {fd[0].n}. При такой выборке доли — сигнал, а не статистика.</p>
          </section>
          <section className="panel">
            <h2>По трекам</h2>
            {s.recipes.length ? <table className="t">
              <thead><tr><th>Трек</th><th className="r">Отклики</th><th className="r">Ответы</th></tr></thead>
              <tbody>
                {s.recipes.map((r) => {
                  const sent = apps.filter((a) => a.track === r.id && stageIndex(a.reached) >= stageIndex('applied'));
                  return <tr key={r.id}><td>{r.name}</td><td className="r">{sent.length}</td><td className="r">{sent.filter((a) => stageIndex(a.reached) >= stageIndex('screen')).length}</td></tr>;
                })}
              </tbody>
            </table> : <p className="hint">Треков пока нет — создай первый в <a href={href('builder')}>«Конструкторе резюме»</a>.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
