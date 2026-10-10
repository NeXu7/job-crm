// Job capture: link (or HTML from the extension) → files in the application folder → Claude analysis.
import fs from 'node:fs/promises';
import { writeAtomic } from '../fsio';
import { DESKTOP_UA, getBrowser } from '../browser';
import { appPath, createApp, db, getApp, loadApp, newAppId, patchApp, serial } from '../store';
import { fromAts, type AtsResult } from './ats';
import { readable, snapshotHtml, htmlToMarkdown } from './extract';
import { analyzeApp } from '../analyze';
import { today } from '../../shared/pipeline';

export type CaptureInput = { url?: string; html?: string; title?: string; text?: string; source?: string };

const atsMarkdown = (ats: AtsResult) =>
  `# ${ats.title}\n\n${[ats.company && `**Company:** ${ats.company}`, ats.location && `**Location:** ${ats.location}`, ats.comp && `**Compensation:** ${ats.comp}`].filter(Boolean).join('  \n')}\n\n${htmlToMarkdown(ats.html)}`;

function hostOf(url?: string) {
  try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}

function sourceOf(url?: string, given?: string) {
  if (given) return given;
  const h = hostOf(url);
  if (h.includes('linkedin.')) return 'LinkedIn';
  if (/greenhouse|lever\.co|ashbyhq|workable|workday|myworkdayjobs|smartrecruiters|bamboohr|recruitee|personio|teamtailor/.test(h)) return `ATS (${h})`;
  if (/wellfound|ycombinator|otta|welcometothejungle|remoteok|weworkremotely|indeed|glassdoor|hh\.ru|djinni|builtin/.test(h)) return `борд (${h})`;
  return h ? `сайт (${h})` : 'вручную';
}

/** Normalizes a LinkedIn link to the stable form /jobs/view/<id>. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('linkedin.')) {
      const id = u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'refId', 'trackingId', 'trk'].forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch { return url.trim(); }
}

export function findDuplicate(url?: string) {
  if (!url) return null;
  const n = normalizeUrl(url);
  return [...db.apps.values()].find((a) => a.url && normalizeUrl(a.url) === n) || null;
}

/** Guesses the company from the link — for the folder id and the card label before analysis. */
export function guessFromUrl(url?: string): { company: string; idHint: string } {
  if (!url) return { company: '', idHint: 'vacancy' };
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const h = u.hostname.replace(/^www\./, '');
    if (/greenhouse\.io$|^jobs\.lever\.co$|^jobs\.ashbyhq\.com$|workable\.com$|recruitee\.com$|teamtailor\.com$/.test(h) && parts[0]) return { company: '', idHint: parts[0] };
    if (h.endsWith('myworkdayjobs.com')) return { company: '', idHint: h.split('.')[0] };
    if (h.includes('linkedin.')) return { company: '', idHint: `linkedin-${url.match(/(\d{6,})/)?.[1] || 'job'}` };
    const root = h.split('.').slice(-2, -1)[0] || h;
    return { company: '', idHint: root };
  } catch { return { company: '', idHint: 'vacancy' }; }
}

/** Creates the application right away (the card appears in the funnel); capture and analysis run in the background. */
export async function startCapture(input: CaptureInput) {
  const url = input.url ? normalizeUrl(input.url) : undefined;
  const dup = findDuplicate(url);
  if (dup && !input.html) return { app: dup, duplicate: true };
  const app = dup ?? (await createApp({
    id: newAppId(guessFromUrl(url).idHint, ''),
    url,
    source: sourceOf(url, input.source),
    company_name: '',
    role: input.title?.slice(0, 120) || '',
    capture: { status: 'pending' },
    analysis: { status: 'pending' },
    timeline: [{ date: today(), kind: 'найдено', text: `${sourceOf(url, input.source)}${input.html ? ', захват из браузера' : ''}` }],
    next: { text: 'Проверить разбор и заполнить «почему они / почему я»', date: today() },
  }));
  void runCapture(app.id, { ...input, url }).catch((e) => console.error('[capture]', e));
  return { app, duplicate: false };
}

export async function runCapture(id: string, input: CaptureInput) {
  await patchApp(id, { capture: { status: 'running', at: new Date().toISOString() } }, 'system');
  const dir = appPath(id, 'capture');
  await fs.mkdir(dir, { recursive: true });
  let method = '';
  let finalUrl = input.url || '';
  let html = input.html || '';
  let screenshot: Buffer | undefined;
  let md = '';
  let status: 'done' | 'authwall' | 'failed' = 'done';
  let error: string | undefined;
  const meta: Record<string, unknown> = { url: input.url, captured_at: new Date().toISOString() };

  try {
    // 1. Public ATS API — the cleanest text
    if (input.url && !input.html) {
      const ats = await fromAts(input.url).catch(() => null);
      if (ats) {
        method = `ats:${ats.ats}`;
        md = atsMarkdown(ats);
        Object.assign(meta, { ats: ats.ats, title: ats.title, company: ats.company, location: ats.location, comp: ats.comp });
      }
    }
    // 2. Render the page in Chromium — snapshot for the archive (and the text if there was no API)
    if (input.url && !input.html) {
      const browser = await getBrowser();
      const ctx = await browser.newContext({ userAgent: DESKTOP_UA, locale: 'en-US', viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      try {
        const resp = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
        // expand "show more" on typical sites
        await page.locator('button:has-text("Show more"), button:has-text("See more"), .show-more-less-html__button--more').first().click({ timeout: 1500 }).catch(() => undefined);
        finalUrl = page.url();
        html = await page.content();
        screenshot = await page.screenshot({ fullPage: true, type: 'png', timeout: 15_000 }).catch(() => undefined);
        meta.http_status = resp?.status();
        meta.title = meta.title || (await page.title());
        if (/linkedin\.com\/(authwall|login|checkpoint)/.test(finalUrl) || /authwall/i.test(html.slice(0, 20000))) status = 'authwall';
      } finally { await ctx.close(); }
      method = method || 'browser';
      // a Greenhouse job embedded on the company site: the board token may only be in the rendered page
      if (!md && html && new URL(input.url).searchParams.has('gh_jid')) {
        const ats = await fromAts(input.url, html).catch(() => null);
        if (ats) {
          method = `ats:${ats.ats}`;
          md = atsMarkdown(ats);
          Object.assign(meta, { ats: ats.ats, title: ats.title, company: ats.company, location: ats.location, comp: ats.comp });
        }
      }
    }
    if (input.html) { method = 'extension'; finalUrl = input.url || ''; }
    if (!html && !md && input.text) { md = input.text; method = method || 'text'; }

    if (html) {
      await writeAtomic(`${dir}/page.html`, snapshotHtml(html, finalUrl || 'about:blank'));
      if (!md) md = readable(html, finalUrl || 'http://localhost/').markdown;
    }
    if (screenshot) await writeAtomic(`${dir}/screenshot.png`, screenshot);
    if (md) await writeAtomic(`${dir}/page.md`, md + '\n');
    meta.final_url = finalUrl;
    meta.method = method;
    await writeAtomic(`${dir}/meta.json`, JSON.stringify(meta, null, 2) + '\n');
    if (!md.trim()) { status = 'failed'; error = 'Не удалось достать текст вакансии'; }
    if (status === 'authwall' && md.length > 1500) status = 'done'; // the LinkedIn guest page sometimes returns text
  } catch (e) {
    status = 'failed';
    error = (e as Error).message.slice(0, 300);
  }

  const a = getApp(id);
  const metaTitle = typeof meta.title === 'string' ? meta.title : '';
  const metaCompany = typeof meta.company === 'string' ? meta.company : '';
  await patchApp(id, {
    ...(!a.role && metaTitle ? { role: metaTitle.replace(/\s*[|–-]\s*(LinkedIn|Greenhouse|Lever|Ashby).*$/i, '').slice(0, 120) } : {}),
    ...(!a.company_name && metaCompany && meta.ats === 'greenhouse' ? { company_name: metaCompany } : {}),
    capture: { status, method, at: new Date().toISOString(), error, final_url: finalUrl || undefined },
    ...(status === 'authwall' ? { timeline: [...a.timeline, { date: today(), kind: 'захват', text: 'LinkedIn просит вход: сохрани страницу через расширение браузера' }] } : {}),
  }, 'system', `${id}: захват ${status}`);
  await serial(() => loadApp(id)); // re-read the snapshot file flags

  if (status === 'done') await analyzeApp(id).catch((e) => console.error('[analyze]', e.message));
  else await patchApp(id, { analysis: { status: 'none' } }, 'system');
}
