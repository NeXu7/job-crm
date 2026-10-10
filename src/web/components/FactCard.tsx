// Fact card with inline editing. Used in the fact bank and in the builder.
import { useMemo } from 'react';
import { api } from '../api';
import { act, type State } from '../store';
import { AutoText, ConfirmButton, Seg, TagInput, TextInput, plural } from '../ui';
import { RefPicker, storyOptions } from './Interview';
import { href } from '../router';
import { FACT_STATUSES, type Fact, type FactStatus } from '../../shared/schema';
import { recipeIds } from '../../shared/resume';
import { stageIndex } from '../../shared/pipeline';

export function useFactUsage(s: State) {
  return useMemo(() => {
    const m = new Map<string, { n: number; rep: number }>();
    for (const a of s.applications) {
      const sent = a.locks.find((l) => l.hash === a.sent_lock);
      if (!sent) continue;
      const replied = stageIndex(a.reached) >= stageIndex('screen');
      for (const id of recipeIds(sent.recipe)) {
        const u = m.get(id) || { n: 0, rep: 0 };
        u.n++; if (replied) u.rep++;
        m.set(id, u);
      }
    }
    return m;
  }, [s.applications]);
}

const STATUS_LABEL: Record<FactStatus, string> = { verified: 'Проверен', 'needs-proof': 'Подкрепить', draft: 'Черновик' };

export function FactCard({ f, s, usage }: { f: Fact; s: State; usage?: { n: number; rep: number } }) {
  const save = (p: Partial<Fact>) => act(() => api.put(`/api/facts/${encodeURIComponent(f.id)}`, p));
  const allTags = useMemo(() => [...new Set(s.facts.flatMap((x) => x.tags))].sort(), [s.facts]);
  const inRecipes = s.recipes.filter((r) => recipeIds(r).includes(f.id)).map((r) => r.name);
  return (
    <article className={`fc ${f.status}`} id={`fact-${f.id}`}>
      <div className="fc-h">
        <div className="row"><span className="id">{f.id}</span>{f.derived_from && <span className="hint">на основе {f.derived_from}</span>}</div>
        <Seg value={f.status} onChange={(v) => void save({ status: v })} options={FACT_STATUSES.map((x) => [x, STATUS_LABEL[x]] as [FactStatus, string])} />
      </div>
      {f.note && <div className={`callout ${f.status === 'needs-proof' ? 'warn' : ''}`}>{f.note}</div>}
      <AutoText className="main" value={f.text} warnEmpty onCommit={(v) => void save({ text: v })} placeholder="Формулировка для резюме, по-английски: глагол, что сделал, цифра" />
      <div className="grid2">
        <label className="field"><span>Короткий вариант</span><AutoText value={f.short || ''} rows={1} onCommit={(v) => void save({ short: v })} placeholder="Для плотных резюме" /></label>
        <label className="field"><span>По-русски, для себя</span><AutoText value={f.ru || ''} rows={1} onCommit={(v) => void save({ ru: v })} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Теги</span><TagInput value={f.tags} onChange={(v) => void save({ tags: v })} suggestions={allTags} placeholder="тема, навык…" /></label>
        <label className="field"><span>Метрики</span><TagInput value={f.metrics} onChange={(v) => void save({ metrics: v })} placeholder="−40% время обработки…" /></label>
      </div>
      <div className="field"><span>Подходит трекам</span>
        <div className="row">{s.recipes.map((r) => (
          <button type="button" key={r.id} className={`tag ${f.roles.includes(r.id) ? 'on' : ''}`} onClick={() => void save({ roles: f.roles.includes(r.id) ? f.roles.filter((x) => x !== r.id) : [...f.roles, r.id] })}>{r.name}</button>
        ))}</div>
      </div>
      <details>
        <summary>Источник, истории, заметка{usage?.n ? ` · отправлялся в ${usage.n} ${plural(usage.n, 'резюме', 'резюме', 'резюме')}, ответов ${usage.rep}` : ''}{inRecipes.length ? ` · в базовых: ${inRecipes.join(', ')}` : ''}</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <div className="grid2">
            <label className="field"><span>Источник</span><TextInput value={f.source || ''} onCommit={(v) => void save({ source: v })} placeholder="Откуда цифра: документ, отчёт, разговор…" /></label>
            <label className="field"><span>Истории</span><RefPicker value={f.stories} options={storyOptions(s)} onChange={(v) => void save({ stories: v })} add="+ история" link={() => href('interview/stories')} /></label>
          </div>
          <label className="field"><span>Заметка</span><AutoText value={f.note || ''} rows={1} onCommit={(v) => void save({ note: v })} placeholder="Что подкрепить, откуда цифра, оговорки" /></label>
          <div className="row">
            <label className="field" style={{ minWidth: 200 }}><span>Опыт</span>
              <select value={f.exp} onChange={(e) => void save({ exp: e.target.value })}>{s.experiences.map((e) => <option key={e.id} value={e.id}>{e.org}</option>)}</select>
            </label>
            <span className="grow" />
            <ConfirmButton onConfirm={() => void act(() => api.del(`/api/facts/${encodeURIComponent(f.id)}`), `Факт ${f.id} удалён`)}>Удалить факт</ConfirmButton>
          </div>
        </div>
      </details>
    </article>
  );
}
