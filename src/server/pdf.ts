// PDF from the same HTML template as the preview. Cache by content_hash in 04-resume/build/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBrowser } from './browser';
import { ORIGIN, P } from './config';
import { exists } from './fsio';
import { renderResumeHTML } from '../shared/template';
import type { Resolved } from '../shared/schema';

export async function renderPdf(resolved: Resolved): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(renderResumeHTML(resolved, { fontBase: ORIGIN }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally {
    await page.close();
  }
}

export async function lockPdf(contentHash: string, resolved: Resolved): Promise<Buffer> {
  const file = path.join(P.build, `${contentHash.slice(0, 16)}.pdf`);
  if (await exists(file)) return fs.readFile(file);
  const buf = await renderPdf(resolved);
  await fs.mkdir(P.build, { recursive: true });
  await fs.writeFile(file, buf);
  return buf;
}
