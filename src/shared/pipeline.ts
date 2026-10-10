// Pipeline rules: stage gates, fit, dates. Shared by the server (validation) and the UI (hints).
import { STAGES, STAGE_NAMES, stageIndex, type Application, type ApplicationMeta, type Stage } from './schema';

export type Gate = { code: 'why' | 'lock' | 'capture'; message: string };

/** Why moving to stage `to` is not allowed. null — allowed. Moving back or to «Закрыто» is always allowed. */
export function gateFor(a: Pick<Application, 'stage' | 'whyThem' | 'whyMe' | 'locks' | 'legacy'>, to: Stage): Gate | null {
  if (a.legacy || to === 'closed' || stageIndex(to) <= stageIndex(a.stage)) return null;
  if (stageIndex(to) >= stageIndex('ready') && !(a.whyThem.trim() && a.whyMe.trim()))
    return { code: 'why', message: 'Нет ответа на «почему они» и «почему я». Нет ответа — нет отклика: заполни оба поля.' };
  if (stageIndex(to) >= stageIndex('applied') && a.locks.length === 0)
    return { code: 'lock', message: 'Нет зафиксированного резюме. Собери его в конструкторе и сделай lock.' };
  return null;
}

export const fitScore = (a: Pick<ApplicationMeta, 'fit'>) => {
  const v = Object.values(a.fit || {});
  return v.length ? v.reduce((s, x) => s + x, 0) : null;
};
export const fitMax = (criteria: number) => criteria * 2;

export const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in the local timezone
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

export const maxStage = (a: Stage, b: Stage): Stage => (stageIndex(a) >= stageIndex(b) ? a : b);
export { STAGES, STAGE_NAMES, stageIndex };

export function slugify(s: string): string {
  const map: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return s.toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
}
