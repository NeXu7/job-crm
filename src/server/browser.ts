// One headless Chromium for the whole server: for capturing job pages and printing PDFs.
import { chromium, type Browser } from 'playwright';
import { UserError } from './store';

let browser: Promise<Browser> | null = null;

/** `npm install` does not download Playwright's Chromium; replace its ASCII-box error with a short hint. */
export const NO_BROWSER_HINT = 'Не установлен браузер для сохранения вакансий и PDF. Выполни в папке приложения: npx playwright install chromium';

export function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch({ headless: true }).catch((e: Error) => {
      browser = null;
      if (/Executable doesn't exist|playwright install/i.test(e.message)) throw new UserError(NO_BROWSER_HINT, 503, 'browser');
      throw e;
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) (await browser.catch(() => null))?.close().catch(() => undefined);
  browser = null;
}

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
