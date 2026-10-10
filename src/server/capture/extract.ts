// HTML → readable Markdown (Readability + Turndown) and a "lightweight" page snapshot without scripts.
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import TurndownService from 'turndown';

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
td.remove(['script', 'style', 'noscript', 'iframe', 'button', 'form']);
td.remove((n) => n.nodeName === 'SVG');

const quiet = () => {
  const vc = new VirtualConsole();
  return vc; // silence CSS/JS errors from the parsed pages
};

export function htmlToMarkdown(html: string): string {
  return td.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
}

export function readable(html: string, url: string): { title: string; markdown: string; text: string } {
  const dom = new JSDOM(html, { url, virtualConsole: quiet() });
  const doc = dom.window.document;
  const title = doc.title || '';
  // LinkedIn and many sites put the job description in recognizable containers — use them if present.
  const preferred = doc.querySelector(
    '.jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, .description__text, #job-details, [data-testid="job-description"], .job-description, .posting-page, #content .job__description',
  );
  let mdBody = '';
  if (preferred && (preferred.textContent || '').trim().length > 400) {
    const head = doc.querySelector('h1, .top-card-layout__title, .job-details-jobs-unified-top-card__job-title')?.textContent?.trim();
    const comp = doc.querySelector('.job-details-jobs-unified-top-card__company-name, .topcard__org-name-link, .top-card-layout__second-subline')?.textContent?.trim();
    mdBody = [head ? `# ${head}` : '', comp ? `**${comp.replace(/\s+/g, ' ')}**` : '', htmlToMarkdown(preferred.innerHTML)].filter(Boolean).join('\n\n');
  } else {
    const art = new Readability(doc.cloneNode(true) as Document).parse();
    if (art?.content && (art.textContent || '').trim().length > 300) mdBody = `# ${art.title || title}\n\n${htmlToMarkdown(art.content)}`;
    else mdBody = htmlToMarkdown(doc.body?.innerHTML || '');
  }
  dom.window.close();
  return { title, markdown: mdBody, text: mdBody.replace(/[#*_`>-]/g, ' ') };
}

/** Snapshot for viewing: no scripts, with <base> so images and styles load from the site. */
export function snapshotHtml(html: string, url: string): string {
  const dom = new JSDOM(html, { url, virtualConsole: quiet() });
  const doc = dom.window.document;
  doc.querySelectorAll('script, noscript, iframe, link[rel="preload"], link[rel="modulepreload"]').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) if (a.name.startsWith('on')) el.removeAttribute(a.name);
  });
  let base = doc.querySelector('base');
  if (!base) { base = doc.createElement('base'); doc.head?.prepend(base); }
  base.setAttribute('href', url);
  const meta = doc.createElement('meta');
  meta.setAttribute('name', 'crm-captured-from');
  meta.setAttribute('content', url);
  doc.head?.prepend(meta);
  const out = dom.serialize();
  dom.window.close();
  return out;
}
