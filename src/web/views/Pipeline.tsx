import { useState } from 'react';
import { api, ApiError } from '../api';
import { act, toast } from '../store';
import { go, href } from '../router';
import { dueLabel, fmtDate, FitBadge, plural } from '../ui';
import { daysBetween, fitScore, STAGES, STAGE_NAMES } from '../../shared/pipeline';
import type { Application, Stage } from '../../shared/schema';
import type { State } from '../store';

export async function moveStage(a: Application, stage: Stage) {
  try {
    await api.patch(`/api/applications/${a.id}`, { stage });
  } catch (e) {
    const err = e as ApiError;
    if (err.code === 'why') toast(err.message, 'bad', { label: 'Заполнить', href: href(`app/${a.id}`) });
    else if (err.code === 'lock') toast(err.message, 'bad', { label: 'В конструктор', href: href(`builder/${a.id}`) });
    else toast(err.message, 'bad');
  }
}

export const hostOf = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return u || ''; } };

function Card({ a, s }: { a: Application; s: State }) {
  const d = a.next ? daysBetween(s.today, a.next.date) : null;
  const closed = a.stage === 'closed';
  const busy = a.capture.status === 'running' || a.capture.status === 'pending' || a.analysis.status === 'running';
  const days = a.stage_since ? daysBetween(a.stage_since, s.today) : 0;
  const track = s.recipes.find((r) => r.id === a.track);
  return (
    <a className="card" href={href(`app/${a.id}`)} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.currentTarget.classList.add('dragging'); }}
      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}>
      <div className="card-top"><b>{a.company_name || (busy ? 'Разбираю…' : 'Без компании')}</b><FitBadge score={fitScore(a)} max={s.icp.criteria.length * 2} /></div>
      <div className="card-role">{a.role || hostOf(a.url) || 'роль не указана'}</div>
      <div className="card-tags">
        {track && <span className="tag">{track.name}</span>}
        {a.sent_lock ? <span className="hash">lock {a.sent_lock}</span> : a.locks.length ? <span className="hash" title="Зафиксировано, ещё не отправлено">lock {a.locks.at(-1)!.hash}</span> : null}
        {busy && <span className="pill accent"><span className="spin" />разбор</span>}
        {(a.capture.status === 'failed' || a.analysis.status === 'failed') && <span className="pill bad"><i>!</i>ошибка</span>}
        {a.capture.status === 'authwall' && <span className="pill warn"><i>!</i>нужен вход</span>}
        {a.flags.length > 0 && !closed && <span className="pill warn"><i>!</i>{a.flags.length} {plural(a.flags.length, 'флаг', 'флага', 'флагов')}</span>}
        {a.stage === 'research' && !(a.whyThem.trim() && a.whyMe.trim()) && !busy && <span className="pill">нет «почему»</span>}
      </div>
      {a.next && !closed && d !== null && <div className={`card-next ${d < 0 ? 'bad' : d <= 1 ? 'warn' : ''}`}>{dueLabel(d)} · {a.next.text}</div>}
      {closed && <div className="card-next">{a.outcome || 'закрыто'}</div>}
      <div className="card-meta">{closed ? `закрыто: ${fmtDate(a.stage_since)}` : `в стадии ${days} ${plural(days, 'день', 'дня', 'дней')}`}</div>
    </a>
  );
}

export function Pipeline({ s, onCapture }: { s: State; onCapture: () => void }) {
  const [over, setOver] = useState<Stage | null>(null);
  const [url, setUrl] = useState('');
  const capture = async () => {
    if (!url.trim()) return onCapture();
    const r = await act(() => api.post<{ id: string; duplicate: boolean }>('/api/capture', { url: url.trim() }));
    if (!r) return;
    setUrl('');
    if (r.duplicate) toast('Эта вакансия уже сохранена', undefined, { label: 'Открыть', href: href(`app/${r.id}`) });
    else toast('Сохраняю и отдаю на разбор Claude', undefined, { label: 'Открыть', href: href(`app/${r.id}`) });
  };
  return (
    <>
      <header className="vh"><div><h1>Воронка</h1><p className="sub">Перетаскивай карточки между стадиями. Без «почему они / почему я» карточка не уйдёт дальше «Исследую», без зафиксированного резюме — дальше «Готов к отклику».</p></div></header>
      <form className="capture-bar" onSubmit={(e) => { e.preventDefault(); void capture(); }}>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Ссылка на вакансию: LinkedIn, сайт компании, Greenhouse, Lever, Ashby…" aria-label="Ссылка на вакансию" />
        <button className="btn primary">Сохранить и разобрать</button>
        <button type="button" className="btn" onClick={() => void act(async () => { const a = await api.post<Application>('/api/applications', { company_name: '', role: '' }); go(`app/${a.id}`); })}>Пустая карточка</button>
      </form>
      <div className="board">
        {STAGES.map((st) => {
          const items = s.applications.filter((a) => a.stage === st).sort((a, b) => (b.stage_since || '').localeCompare(a.stage_since || ''));
          return (
            <section key={st} className={`col ${over === st ? 'drop' : ''}`} aria-label={STAGE_NAMES[st]}
              onDragOver={(e) => { e.preventDefault(); setOver(st); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const a = s.applications.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (a && a.stage !== st) void moveStage(a, st); }}>
              <div className="col-h"><h3>{STAGE_NAMES[st]}</h3><span className="badge">{items.length}</span></div>
              {items.map((a) => <Card key={a.id} a={a} s={s} />)}
            </section>
          );
        })}
      </div>
    </>
  );
}
