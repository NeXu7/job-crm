// Grabs the DOM of the active tab as the user sees it (logged in) and sends it to the local CRM.
// The CRM port defaults to 4317; change it in the popup when the server runs with another CRM_PORT.
const DEFAULT_PORT = '4317';
const out = document.getElementById('out');
const btn = document.getElementById('save');
const portInput = document.getElementById('port');

function getPort() {
  try { return localStorage.getItem('crmPort') || DEFAULT_PORT; } catch { return DEFAULT_PORT; }
}
portInput.value = getPort();
portInput.addEventListener('change', () => {
  const v = portInput.value.trim();
  const ok = /^\d{2,5}$/.test(v) ? v : DEFAULT_PORT;
  portInput.value = ok;
  try { localStorage.setItem('crmPort', ok); } catch { /* storage unavailable: keep the default */ }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  document.getElementById('where').textContent = tab?.url ? new URL(tab.url).hostname : '';
});

function grabPage() {
  // Expand collapsed descriptions (LinkedIn and similar), wait for a repaint, return the DOM.
  const more = document.querySelectorAll(
    'button[aria-label*="see more" i], button[aria-label*="show more" i], .jobs-description__footer-button, .show-more-less-html__button--more, .inline-show-more-text__button',
  );
  more.forEach((b) => { try { b.click(); } catch (e) { /* nothing */ } });
  return new Promise((resolve) => setTimeout(() => resolve({
    url: location.href,
    title: document.title,
    html: '<!doctype html>' + document.documentElement.outerHTML,
    text: String(getSelection() || ''),
  }), more.length ? 600 : 50));
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  out.className = '';
  out.textContent = 'Сохраняю…';
  const crm = `http://localhost:${getPort()}`;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabPage });
    const r = await fetch(`${crm}/api/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: result.url, html: result.html, title: result.title, text: result.text || undefined }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    out.className = 'ok';
    out.innerHTML = '';
    out.append(j.duplicate ? 'Уже было в CRM, снимок обновлён. ' : 'Сохранено, Claude разбирает. ');
    const a = document.createElement('a');
    a.href = j.url; a.target = '_blank'; a.textContent = 'Открыть карточку';
    out.append(a);
  } catch (e) {
    out.className = 'err';
    out.textContent = String(e.message || e).includes('Failed to fetch')
      ? `CRM не отвечает на ${crm}. Запусти в папке рабочего пространства: npm --prefix app start`
      : `Ошибка: ${e.message || e}`;
  } finally {
    btn.disabled = false;
  }
});
