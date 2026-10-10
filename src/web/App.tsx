import { useEffect, useState } from 'react';
import { useAppState, useToasts, dismissToast, toast, act, useExternalNote, clearExternalNote } from './store';
import { useRoute, href, go } from './router';
import { api } from './api';
import { Modal, plural } from './ui';
import { Today, actionRows } from './views/Today';
import { Pipeline } from './views/Pipeline';
import { AppPage } from './views/AppPage';
import { Builder } from './views/Builder';
import { Facts } from './views/Facts';
import { Interview } from './views/Interview';
import { Fill } from './views/Fill';
import { Guide } from './views/Guide';
import { questionStatus } from '../shared/interview';
import { computeGaps } from '../shared/gaps';

const NAV: [string, string][] = [['today', 'Сегодня'], ['pipeline', 'Воронка'], ['builder', 'Конструктор резюме'], ['facts', 'Банк фактов'], ['interview', 'Интервью'], ['fill', 'Наполнение'], ['guide', 'Как пользоваться']];

export function App() {
  const s = useAppState();
  const route = useRoute();
  const toasts = useToasts();
  const ext = useExternalNote();
  const [capture, setCapture] = useState<string | null>(null);

  // A link pasted anywhere outside an input — offer to save the vacancy
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text')?.trim() || '';
      if (/^https?:\/\/\S+$/.test(text)) { e.preventDefault(); setCapture(text); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    if (ext) { toast(`Обновлено вне интерфейса: ${ext}`); clearExternalNote(); }
  }, [ext]);

  if (!s) return <div style={{ padding: 32 }} className="muted">Загрузка…</div>;
  const view = route[0];
  const known = view === 'app' || NAV.some(([id]) => id === view);
  const badge: Record<string, number> = {
    today: actionRows(s).length,
    pipeline: s.applications.filter((a) => a.stage !== 'closed').length,
    facts: s.facts.filter((f) => f.status !== 'verified').length,
    // frequent questions without a ready answer
    interview: s.questions.filter((q) => q.priority === 'high' && q.category !== 'reverse' && !q.app_field && questionStatus(q) !== 'ready').length,
    // level-1 gaps
    fill: computeGaps(s).gaps.filter((g) => g.level === 1).length,
  };

  return (
    <div className="app">
      <nav className="rail" aria-label="Разделы">
        <div className="brand"><b>Job CRM</b><span>поиск работы · localhost</span></div>
        <div className="nav">
          {NAV.map(([id, name]) => (
            <a key={id} href={href(id)} className={view === id || (id === 'pipeline' && view === 'app') ? 'on' : ''}>
              <span>{name}</span>{badge[id] ? <span className="badge">{badge[id]}</span> : null}
            </a>
          ))}
        </div>
        <button className="btn primary" onClick={() => setCapture('')}>+ Вакансия</button>
        <div className="rail-foot">
          <ClaudeStatus status={s.claude.status} message={s.claude.message} />
          {s.errors.length > 0 && <a href={href('today')} className="pill bad wrap"><i>!</i>ошибок в файлах: {s.errors.length}</a>}
          {!!s.warnings?.length && <a href={href('today')} className="pill warn wrap" title={s.warnings.join('\n')}><i>!</i>{s.warnings.length === 1 ? 'есть предупреждение' : `предупреждений: ${s.warnings.length}`}</a>}
          <span>Вставь ссылку в любом месте страницы, чтобы сохранить вакансию.</span>
        </div>
      </nav>
      <main>
        {view === 'today' && <Today s={s} />}
        {view === 'pipeline' && <Pipeline s={s} onCapture={() => setCapture('')} />}
        {view === 'app' && <AppPage s={s} id={route[1]} tab={route[2] || 'overview'} />}
        {view === 'builder' && <Builder s={s} appId={route[1]} />}
        {view === 'facts' && <Facts s={s} section={route[1]} />}
        {view === 'interview' && <Interview s={s} section={route[1]} />}
        {view === 'fill' && <Fill s={s} level={route[1]} bank={route[2]} />}
        {view === 'guide' && <Guide s={s} section={route[1]} />}
        {!known && <p>Такой страницы нет. <a href={href('today')}>На «Сегодня»</a></p>}
      </main>
      {capture !== null && <CaptureModal initial={capture} onClose={() => setCapture(null)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind || ''}`}>
            <span>{t.text}</span>
            {t.action && (t.action.href
              ? <a className="btn sm" href={t.action.href} onClick={() => dismissToast(t.id)}>{t.action.label}</a>
              : <button className="btn sm" onClick={() => { t.action?.run?.(); dismissToast(t.id); }}>{t.action.label}</button>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClaudeStatus({ status, message }: { status: string; message?: string }) {
  const check = () => void act(() => api.post<{ status: string }>('/api/claude/check')).then((r) => r && toast(r.status === 'ok' ? 'Claude подключён' : 'Claude CLI всё ещё не авторизован'));
  if (status === 'ok') return <span className="pill good"><i>✓</i>Claude подключён</span>;
  const label = status === 'auth' ? 'Claude: нужен вход' : status === 'missing' ? 'Claude CLI не найден' : status === 'error' ? 'Claude: ошибка' : 'Claude: статус неизвестен';
  return (
    <div className="stack tight">
      <span className={`pill ${status === 'unknown' ? '' : 'bad'} wrap`} title={message}><i>!</i>{label}</span>
      {status === 'auth' && <span>В терминале: <code className="mono">claude auth login</code></span>}
      <button className="btn sm" onClick={check}>Проверить</button>
    </div>
  );
}

function CaptureModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [url, setUrl] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await act(() => api.post<{ id: string; duplicate: boolean }>('/api/capture', url.trim() ? { url: url.trim() } : { text }));
    setBusy(false);
    if (!r) return;
    onClose();
    if (r.duplicate) toast('Эта вакансия уже сохранена', undefined, { label: 'Открыть', href: href(`app/${r.id}`) });
    else { toast('Сохраняю страницу и отдаю на разбор Claude. Карточка уже в воронке.'); go(`app/${r.id}`); }
  };
  return (
    <Modal onClose={onClose} narrow title="Новая вакансия">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field"><span>Ссылка</span>
          <input type="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… LinkedIn, сайт компании, Greenhouse, Lever, Ashby" />
        </label>
        <p className="hint">Сервер откроет страницу в браузере без окна, сохранит снимок и текст, затем Claude заполнит карточку. LinkedIn без входа часто прячет описание: такие страницы сохраняй расширением из своего браузера.</p>
        {!url.trim() && (
          <label className="field"><span>…или текст вакансии</span>
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Вставь текст, если ссылки нет" />
          </label>
        )}
        <div className="row">
          <button className="btn primary" disabled={busy || (!url.trim() && !text.trim())}>{busy ? 'Сохраняю…' : 'Сохранить и разобрать'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
        </div>
      </form>
    </Modal>
  );
}

export const pluralFacts = (n: number) => `${n} ${plural(n, 'факт', 'факта', 'фактов')}`;
