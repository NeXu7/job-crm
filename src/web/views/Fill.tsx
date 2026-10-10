// «Наполнение»: progress per bank, gap queue by importance, and raw notes (dictated, session logs).
// The same queue Claude sees in a fill session: `npm --prefix app run -s bank -- gaps`, the /fill skill.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { act, type State } from '../store';
import { href } from '../router';
import { ConfirmButton, Markdown, Modal, Seg, fmtDate, plural } from '../ui';
import { computeGaps, GAP_BANKS, progressPct, type DocTodo, type GapBank } from '../../shared/gaps';
import type { Note } from '../../shared/schema';

type Level = '1' | '2' | '3';
const asLevel = (x?: string): Level | undefined => (x === '1' || x === '2' || x === '3' ? x : undefined);
const asBank = (x?: string): GapBank | undefined => GAP_BANKS.find(([id]) => id === x)?.[0];

/** Route #/fill[/<level>[/<bank>]] opens the queue on that level and bank, e.g. #/fill/3/docs for document TODOs. */
export function Fill({ s, level: levelParam, bank: bankParam }: { s: State; level?: string; bank?: string }) {
  const [docs, setDocs] = useState<DocTodo[]>([]);
  useEffect(() => { void api.get<DocTodo[]>('/api/doc-todos').then(setDocs).catch(() => setDocs([])); }, [s]);
  const { gaps, progress } = useMemo(() => computeGaps(s, docs), [s, docs]);
  const [level, setLevel] = useState<Level>(asLevel(levelParam) ?? '1');
  const [bank, setBank] = useState<'' | GapBank>((asLevel(levelParam) && asBank(bankParam)) || '');
  // a link to #/fill/<level>[/<bank>] while the page is open
  useEffect(() => {
    const l = asLevel(levelParam);
    if (!l) return;
    setLevel(l);
    setBank(asBank(bankParam) ?? '');
  }, [levelParam, bankParam]);
  const list = gaps.filter((g) => g.level === Number(level) && (!bank || g.bank === bank));
  const count = (l: number) => gaps.filter((g) => g.level === l && (!bank || g.bank === bank)).length;
  const bankName = new Map(GAP_BANKS);

  return (
    <>
      <header className="vh">
        <div><h1>Наполнение</h1><p className="sub">Что не заполнено в банках — по важности. Эту же очередь видит Claude в сессии наполнения: открой Claude Code в папке своего рабочего пространства (там, где лежат <span className="mono">00-profile/</span> и <span className="mono">CLAUDE.md</span>) и набери <code className="mono">/fill</code>. <a href={href('guide/scenarios')}>Как это устроено</a></p></div>
      </header>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="progress">
          {progress.map((p, i) => {
            const pct = progressPct(p);
            return (
              <div className="pg" key={i}>
                <div className="row between"><span>{p.label}</span><b className="num" title={pct === null ? 'Пока нечего считать' : `${pct}%`}>{p.total ? `${p.done}/${p.total}` : '—'}</b></div>
                <div className="pg-bar" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-valuetext={pct === null ? 'пока нечего считать' : `${pct}%`} aria-label={p.label}><i style={{ width: `${pct ?? 0}%` }} /></div>
                {p.hint && <small className="hint">{p.hint}</small>}
              </div>
            );
          })}
        </div>
      </section>
      <div className="cols">
        <section className="stack">
          <div className="row">
            <Seg value={level} onChange={setLevel} options={[['1', `Сначала · ${count(1)}`], ['2', `Потом · ${count(2)}`], ['3', `Когда-нибудь · ${count(3)}`]]} />
            <select value={bank} onChange={(e) => setBank(e.target.value as GapBank | '')} style={{ width: 'auto' }} aria-label="Банк">
              <option value="">все банки</option>{GAP_BANKS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </div>
          <p className="hint">{level === '1' ? 'Спросят на ближайшем интервью или попадёт в резюме.' : level === '2' ? 'Важно, но не горит.' : 'Когда дойдут руки: редкие вопросы, TODO в документах.'}</p>
          {!list.length && <p className="callout good">Здесь пусто.</p>}
          <ul className="gaps">
            {list.map((g) => (
              <li key={g.key}>
                <span className="tag">{bankName.get(g.bank)}</span>
                <div className="gap-b">
                  <a href={href(g.link)}>{g.title}</a>
                  {g.ask && <p className="hint">{g.ask}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <Inbox notes={s.notes} />
      </div>
    </>
  );
}

function Inbox({ notes }: { notes: Note[] }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<Note | null>(null);
  const fresh = notes.filter((n) => n.status === 'new');
  return (
    <section className="stack">
      <section className="panel">
        <h3>Сбросить сырьё</h3>
        <p className="hint">Надиктуй или вставь как есть: истории, цифры, мысли про сильные стороны, вопросы с интервью. Claude в сессии наполнения разберёт это в банки черновиками — сырьё стоит первым в его очереди.</p>
        <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void act(() => api.post('/api/notes', { title: title.trim() || 'Сырьё', text }), 'Сохранено в сырьё').then((r) => { if (r) { setTitle(''); setText(''); } }); }}>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="О чём: провал на проекте, конфликт с заказчиком…" aria-label="Тема" />
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст как есть — можно с «э» и повторами, Claude почистит" aria-label="Текст" />
          <div><button className="btn primary" disabled={!text.trim()}>Сохранить в сырьё</button></div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-h"><h3>Сырьё · {notes.length}</h3>{fresh.length > 0 && <span className="pill warn">не разобрано: {fresh.length}</span>}</div>
        {!notes.length && <p className="hint">Пусто. Логи сессий наполнения с Claude тоже попадают сюда.</p>}
        <div className="mini-list">
          {notes.map((n) => (
            <div className="mini" key={n.file}>
              <span>
                <span className={`pill ${n.status === 'new' ? 'warn' : 'good'}`}>{n.status === 'new' ? 'новое' : 'разобрано'}</span>{' '}
                <button className="link" onClick={() => setOpen(n)}>{n.title}</button>{' '}
                <span className="muted small">{n.kind === 'session' ? 'сессия' : 'сырьё'} · {fmtDate(n.date)} · {n.words} {plural(n.words, 'слово', 'слова', 'слов')}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
      {open && <NoteModal n={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function NoteModal({ n, onClose }: { n: Note; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => { void api.get<{ body: string }>(`/api/notes/${encodeURIComponent(n.file)}`).then((r) => setBody(r.body)); }, [n.file, n.words]);
  const status = (st: Note['status']) => act(() => api.put(`/api/notes/${encodeURIComponent(n.file)}`, { status: st }), st === 'processed' ? 'Отмечено разобранным' : 'Вернул в неразобранное').then(onClose);
  return (
    <Modal onClose={onClose} title={<>{n.title} <span className="muted small mono">{n.file}</span></>}>
      {body === null ? <p className="hint">Загрузка…</p> : <Markdown text={body} />}
      <div className="row">
        {n.status === 'new'
          ? <button className="btn" onClick={() => void status('processed')}>Отметить разобранным</button>
          : <button className="btn" onClick={() => void status('new')}>Вернуть в неразобранное</button>}
        <span className="grow" />
        <ConfirmButton onConfirm={() => void act(() => api.del(`/api/notes/${encodeURIComponent(n.file)}`), 'Удалено').then(onClose)}>Удалить</ConfirmButton>
      </div>
    </Modal>
  );
}
