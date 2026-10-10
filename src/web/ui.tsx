// Small shared UI components.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { FactStatus } from '../shared/schema';

export const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function fmtDate(d?: string) {
  if (!d) return '';
  const p = d.slice(0, 10).split('-');
  if (p.length === 2) return `${MON[+p[1] - 1]} ${p[0]}`;
  if (p.length === 1) return p[0];
  return `${+p[2]} ${MON[+p[1] - 1]}${p[0] !== String(new Date().getFullYear()) ? ' ' + p[0] : ''}`;
}
export const plural = (n: number, a: string, b: string, c: string) => {
  const m = n % 10, h = n % 100;
  return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c;
};
export function dueLabel(d: number) {
  return d < 0 ? `просрочено ${-d} ${plural(-d, 'день', 'дня', 'дней')}` : d === 0 ? 'сегодня' : d === 1 ? 'завтра' : `через ${d} ${plural(d, 'день', 'дня', 'дней')}`;
}

export const STATUS: Record<FactStatus, { cls: string; icon: string; label: string }> = {
  verified: { cls: 'good', icon: '✓', label: 'проверен' },
  'needs-proof': { cls: 'warn', icon: '!', label: 'нужно подкрепить' },
  draft: { cls: 'accent', icon: '✎', label: 'черновик' },
};
export function StatusPill({ s }: { s: FactStatus }) {
  const st = STATUS[s];
  return <span className={`pill ${st.cls}`}><i>{st.icon}</i>{st.label}</span>;
}

export function FitBadge({ score, max }: { score: number | null; max: number }) {
  // no ICP criteria: a 0/0 badge means nothing
  if (score === null || max <= 0) return null;
  const cls = score >= max * 0.75 ? 'good' : score <= max * 0.45 ? 'warn' : '';
  return <span className={`fit ${cls}`} title="Fit по критериям ICP">{score}/{max}</span>;
}

export function Dots({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const inner = <><i className={value >= 1 ? 'on' : ''} /><i className={value >= 2 ? 'on' : ''} /></>;
  if (!onChange) return <span className="dots" aria-label={`${value} из 2`}>{inner}</span>;
  return <button type="button" className="dots" aria-label={`${value} из 2, нажми чтобы изменить`} onClick={() => onChange((value + 1) % 3)}>{inner}</button>;
}

/** Local draft of a value: not overwritten from the server while the user is typing. */
export function useDraft<T>(value: T): [T, (v: T) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setDraft(value); }, [value]);
  return [draft, (v: T) => { dirty.current = true; setDraft(v); }, () => { dirty.current = false; }];
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

/** Text field that saves on blur. */
export function AutoText(props: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; id?: string; warnEmpty?: boolean; rows?: number }) {
  const [draft, setDraft, clean] = useDraft(props.value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => autosize(ref.current), [draft]);
  return (
    <textarea
      ref={ref} id={props.id} rows={props.rows ?? 2} placeholder={props.placeholder}
      className={`${props.className || ''} ${props.warnEmpty && !draft.trim() ? 'empty-field' : ''}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { clean(); if (draft !== props.value) props.onCommit(draft); }}
    />
  );
}

export function TextInput(props: { value: string; onCommit: (v: string) => void; placeholder?: string; id?: string; type?: string; className?: string }) {
  const [draft, setDraft, clean] = useDraft(props.value);
  return (
    <input
      id={props.id} type={props.type || 'text'} placeholder={props.placeholder} className={props.className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { clean(); if (draft !== props.value) props.onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function TagInput({ value, onChange, suggestions = [], placeholder }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const listId = useRef('tags-' + Math.random().toString(36).slice(2)).current;
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setText('');
  };
  return (
    <div className="tagbox">
      {value.map((t) => (
        <span className="tag" key={t}>{t}<button type="button" aria-label={`Убрать ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button></span>
      ))}
      <input
        list={listId} value={text} placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1)); else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, l]) => <button type="button" key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Modal({ onClose, children, narrow, title }: { onClose: () => void; children: ReactNode; narrow?: boolean; title?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="row between"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button></div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Button that confirms on a second click (no system dialogs). */
export function ConfirmButton({ onConfirm, children, className = 'btn sm danger', confirmText = 'Точно?' }: { onConfirm: () => void; children: ReactNode; className?: string; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button type="button" className={className} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>{armed ? confirmText : children}</button>;
}

/** Minimal Markdown: headings, lists, paragraphs, **bold**, [links](url). */
export function Markdown({ text }: { text: string }) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const out: string[] = [];
  let list = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*+]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (!li && list) { out.push('</ul>'); list = false; }
    if (h) out.push(`<h${Math.min(3, h[1].length)}>${inline(h[2])}</h${Math.min(3, h[1].length)}>`);
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return <div className="md" dangerouslySetInnerHTML={{ __html: out.join('') }} />;
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
