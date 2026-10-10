// The «classic» resume template. The same HTML feeds the preview (iframe) and the PDF (Chromium).
import type { Resolved } from './schema';

export const A4_HEIGHT_PX = 1122.52; // 297mm at 96 dpi
export const A4_WIDTH_PX = 793.7; // 210mm
export const PAGE_MARGIN = { top: 13, side: 15, bottom: 13 }; // mm

export type RenderOptions = {
  /** Server origin that fonts are loaded from (http://localhost:4317). Empty — relative path. */
  fontBase?: string;
  /** Highlight differences from the base recipe (screen only, not in PDF). */
  highlight?: { ids: string[]; summary?: boolean; headline?: boolean };
};

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD';
const CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

function faces(base: string) {
  const f = (family: string, pkg: string, weight: number, style = 'normal') =>
    [['latin', LATIN], ['cyrillic', CYR]]
      .map(([sub, range]) => `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url('${base}/fonts/${pkg}/${pkg}-${sub}-${weight}-${style}.woff2') format('woff2');unicode-range:${range}}`)
      .join('');
  return [
    f('Source Serif 4', 'source-serif-4', 400), f('Source Serif 4', 'source-serif-4', 400, 'italic'),
    f('Source Serif 4', 'source-serif-4', 600), f('Source Serif 4', 'source-serif-4', 700),
    f('Golos Text', 'golos-text', 600), f('Golos Text', 'golos-text', 400),
  ].join('\n');
}

export function renderResumeHTML(r: Resolved, opts: RenderOptions = {}): string {
  const hl = new Set(opts.highlight?.ids || []);
  const li = (b: { id: string; text: string }) => `<li${hl.has(b.id) ? ' class="hl"' : ''} data-id="${esc(b.id)}">${esc(b.text)}</li>`;
  const ul = (bs: { id: string; text: string }[]) => (bs.length ? `<ul>${bs.map(li).join('')}</ul>` : '');
  const m = PAGE_MARGIN;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.name)} — ${esc(r.headline)}</title>
<style>
${faces(opts.fontBase ?? '')}
@page{size:A4;margin:${m.top}mm ${m.side}mm ${m.bottom}mm}
*{box-sizing:border-box}
html{background:#fff}
body{margin:0;color:#1a1b1e;font:10pt/1.4 'Source Serif 4',Georgia,serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:lining-nums}
@media screen{body{width:210mm;padding:${m.top}mm ${m.side}mm ${m.bottom}mm}}
.name{font-size:21pt;font-weight:700;line-height:1.1;letter-spacing:-.01em}
.headline{font-size:11.5pt;font-weight:600;color:#575c66;margin-top:2pt}
.contacts{font:8.5pt/1.4 'Golos Text',system-ui,sans-serif;color:#575c66;margin-top:4pt}
.contacts span+span::before{content:"·";margin:0 5pt;color:#9a9ea8}
h2{font:600 7.8pt 'Golos Text',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;border-bottom:.6pt solid #cfd3da;padding-bottom:2pt;margin:11pt 0 5pt;break-after:avoid}
p{margin:0}
.job{margin-top:6pt;break-inside:avoid-page}
.job:first-of-type{margin-top:0}
.row{display:flex;justify-content:space-between;gap:10pt;break-after:avoid}
.row b{font-weight:700}
.row .per{color:#575c66;white-space:nowrap}
ul{margin:2pt 0 0;padding-left:12pt}
li{margin:1.2pt 0}
li::marker{color:#8a8f99}
@media screen{.hl{background:#fff0b3;box-shadow:0 0 0 2px #fff0b3}}
</style></head><body>
<div class="name">${esc(r.name)}</div>
<div class="headline${opts.highlight?.headline ? ' hl' : ''}">${esc(r.headline)}</div>
${r.contacts.length ? `<div class="contacts">${r.contacts.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
${r.summary ? `<h2>Summary</h2><p><span${opts.highlight?.summary ? ' class="hl"' : ''}>${esc(r.summary)}</span></p>` : ''}
${r.jobs.length ? `<h2>Experience</h2>${r.jobs.map((j) => `<div class="job"><div class="row"><div><b>${esc(j.org)}</b>${j.title ? ` · ${esc(j.title)}` : ''}</div><div class="per">${esc(j.period)}</div></div>${ul(j.bullets)}</div>`).join('')}` : ''}
${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${ul(s.bullets)}`).join('')}
${r.education.length ? `<h2>Education</h2>${r.education.map((e) => `<div class="row"><div><b>${esc(e.school)}</b>${e.field ? ` · ${esc(e.field)}` : ''}${e.degree ? `, ${esc(e.degree)}` : ''}</div><div class="per">${esc(e.period)}</div></div>`).join('')}` : ''}
</body></html>`;
}

/** Plain text for pasting into ATS forms. */
export function renderResumeText(r: Resolved): string {
  const L: string[] = [r.name, r.headline, r.contacts.join(' · '), ''];
  if (r.summary) L.push('SUMMARY', r.summary, '');
  if (r.jobs.length) {
    L.push('EXPERIENCE');
    for (const j of r.jobs) {
      L.push(`${j.org}${j.title ? ' — ' + j.title : ''} (${j.period})`);
      j.bullets.forEach((b) => L.push('• ' + b.text));
      L.push('');
    }
  }
  for (const s of r.sections) { L.push(s.title.toUpperCase()); s.bullets.forEach((b) => L.push('• ' + b.text)); L.push(''); }
  if (r.education.length) { L.push('EDUCATION'); r.education.forEach((e) => L.push(`${e.school}, ${e.field} (${e.period})`)); }
  return L.join('\n').trim() + '\n';
}
