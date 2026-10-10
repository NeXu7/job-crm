// Resume assembly from the fact bank: recipe → resolved text (Resolved), diff against the base recipe.
import type { Experience, Fact, Profile, Recipe, Resolved, Summary } from './schema';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtMonth(ym?: string): string {
  if (!ym) return '';
  if (ym === 'present') return 'Present';
  const [y, m] = ym.split('-');
  return m ? `${MONTHS[+m - 1]} ${y}` : y;
}

export function period(start?: string, end?: string): string {
  if (!start && !end) return '';
  return [fmtMonth(start), fmtMonth(end)].filter(Boolean).join(' – ');
}

export type Bank = {
  experiences: Experience[];
  facts: Fact[];
  summaries: Summary[];
  profile: Profile;
};

export function contactLine(p: Profile): string[] {
  const c = p.contacts || {};
  return [p.location, c.email, c.phone, c.linkedin, c.github, c.website].filter((x): x is string => !!x && !!x.trim());
}

export function resolveRecipe(recipe: Recipe, bank: Bank): Resolved {
  const byId = new Map(bank.facts.map((f) => [f.id, f]));
  const exps = [...bank.experiences].sort((a, b) => a.order - b.order);
  // Drafts never reach a resume, a preview or a lock, even when a hand-edited recipe lists them (`check` flags it).
  const bullets = (expId: string) =>
    (recipe.facts[expId] || []).map((id) => byId.get(id)).filter((f): f is Fact => !!f && f.status !== 'draft').map((f) => ({ id: f.id, text: f.text }));
  const summary = bank.summaries.find((s) => s.id === recipe.summary);
  return {
    name: bank.profile.name,
    headline: recipe.headline,
    contacts: contactLine(bank.profile),
    summary: summary?.text || '',
    summaryId: recipe.summary,
    jobs: exps
      .filter((e) => e.kind === 'job' && recipe.facts[e.id] !== undefined)
      .map((e) => ({ exp: e.id, org: e.org, title: e.title, period: period(e.start, e.end), location: e.location, bullets: bullets(e.id) })),
    sections: exps
      .filter((e) => e.kind === 'section' && bullets(e.id).length > 0)
      .map((e) => ({ exp: e.id, title: e.org, bullets: bullets(e.id) })),
    education: bank.profile.education.map((ed) => ({ school: ed.school, field: ed.field, degree: ed.degree, period: period(ed.start, ed.end) })),
  };
}

export type DiffItem =
  | { kind: 'summary'; from: string; to: string }
  | { kind: 'headline'; from: string; to: string }
  | { kind: 'add'; id: string; exp: string }
  | { kind: 'remove'; id: string; exp: string }
  | { kind: 'order'; exp: string }
  | { kind: 'show'; exp: string }
  | { kind: 'hide'; exp: string };

export function diffRecipe(recipe: Recipe, base: Recipe | undefined): DiffItem[] {
  if (!base) return [];
  const out: DiffItem[] = [];
  if (recipe.headline !== base.headline) out.push({ kind: 'headline', from: base.headline, to: recipe.headline });
  if (recipe.summary !== base.summary) out.push({ kind: 'summary', from: base.summary, to: recipe.summary });
  const keys = new Set([...Object.keys(recipe.facts), ...Object.keys(base.facts)]);
  for (const exp of keys) {
    const x = recipe.facts[exp], y = base.facts[exp];
    if (x === undefined) { out.push({ kind: 'hide', exp }); continue; }
    if (y === undefined) out.push({ kind: 'show', exp });
    const yy = y || [];
    x.filter((id) => !yy.includes(id)).forEach((id) => out.push({ kind: 'add', id, exp }));
    yy.filter((id) => !x.includes(id)).forEach((id) => out.push({ kind: 'remove', id, exp }));
    const cx = x.filter((id) => yy.includes(id)), cy = yy.filter((id) => x.includes(id));
    if (cx.join() !== cy.join()) out.push({ kind: 'order', exp });
  }
  return out;
}

export function diffText(d: DiffItem, orgOf: (exp: string) => string = (e) => e): string {
  switch (d.kind) {
    case 'summary': return `саммари: ${d.from} → ${d.to}`;
    case 'headline': return `заголовок: ${d.from} → ${d.to}`;
    case 'add': return `+ ${d.id}`;
    case 'remove': return `− ${d.id}`;
    case 'order': return `порядок в ${orgOf(d.exp)} изменён`;
    case 'show': return `+ блок ${orgOf(d.exp)}`;
    case 'hide': return `− блок ${orgOf(d.exp)}`;
  }
}

export function highlightFrom(diff: DiffItem[]) {
  return {
    ids: diff.filter((d) => d.kind === 'add').map((d) => (d as { id: string }).id),
    summary: diff.some((d) => d.kind === 'summary'),
    headline: diff.some((d) => d.kind === 'headline'),
  };
}

/** Stable serialization for hashing: same content → same hash. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export const recipeIds = (r: Recipe) => Object.values(r.facts).flat();

export function cloneRecipe(r: Recipe): Recipe {
  return JSON.parse(JSON.stringify(r));
}

export function pdfName(name: string, headline: string): string {
  const clean = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${clean(name) || 'Resume'}_${clean(headline) || 'CV'}.pdf`;
}
