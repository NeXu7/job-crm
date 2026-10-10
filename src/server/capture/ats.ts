// Public job-board APIs (ATS). They return clean posting text without the site's layout.
//   Greenhouse: boards-api.greenhouse.io/v1/boards/{board}/jobs/{id} (also company sites with ?gh_jid=)
//   Lever:      api.lever.co/v0/postings/{company}/{id}
//   Ashby:      api.ashbyhq.com/posting-api/job-board/{org}
export type AtsResult = { ats: string; title: string; company?: string; location?: string; comp?: string; html: string };

const getJson = async (url: string) => {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

type GreenhouseJob = { title: string; company_name?: string; location?: { name?: string }; content?: string; pay_input_ranges?: { min_cents: number; max_cents: number; currency_type: string }[] };

async function greenhouse(board: string, jobId: string): Promise<AtsResult> {
  const j: GreenhouseJob = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}?pay_transparency=true`);
  const pay = (j.pay_input_ranges || []).map((p) =>
    `${p.currency_type} ${Math.round(p.min_cents / 100).toLocaleString('en-US')}–${Math.round(p.max_cents / 100).toLocaleString('en-US')}`).join('; ');
  return { ats: 'greenhouse', title: j.title, company: j.company_name, location: j.location?.name, comp: pay || undefined, html: decodeEntities(j.content || '') };
}

/** Board tokens for a Greenhouse job embedded on a company site (`?gh_jid=`): from the page HTML, else from the domain. */
function greenhouseBoards(u: URL, html?: string): string[] {
  const out: string[] = [];
  const add = (b?: string | null) => { if (b && /^[\w-]+$/.test(b) && !out.includes(b.toLowerCase())) out.push(b.toLowerCase()); };
  add(u.searchParams.get('for') || u.searchParams.get('board'));
  const page = html || '';
  for (const m of page.matchAll(/greenhouse\.io\/embed\/job_(?:board|app)[^"'\s]*?[?&;]for=([\w-]+)/g)) add(m[1]);
  for (const m of page.matchAll(/(?:boards|job-boards)\.greenhouse\.io\/([\w-]+)/g)) if (m[1] !== 'embed') add(m[1]);
  const labels = u.hostname.replace(/^www\./, '').split('.').slice(0, -1).filter((l) => !/^(careers?|jobs?|work|apply|join|boards?|job-boards|team)$/.test(l));
  labels.reverse().forEach(add); // careers.acme.com → acme
  return out;
}

/** `html` is the rendered page: a second chance to find the Greenhouse board token. */
export async function fromAts(rawUrl: string, html?: string): Promise<AtsResult | null> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const parts = u.pathname.split('/').filter(Boolean);

  // Greenhouse: boards.greenhouse.io/<board>/jobs/<id>, job-boards.greenhouse.io/<board>/jobs/<id>,
  // …/embed/job_app?for=<board>&token=<id>
  if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
    if (parts[1] === 'jobs' && parts[2]) return greenhouse(parts[0], parts[2]);
    const token = u.searchParams.get('token') || u.searchParams.get('gh_jid');
    if (parts[0] === 'embed' && u.searchParams.get('for') && token) return greenhouse(u.searchParams.get('for')!, token);
    if (parts[0] && parts[0] !== 'embed' && token) return greenhouse(parts[0], token); // boards.greenhouse.io/<board>?gh_jid=<id>
  }
  // Greenhouse embedded on a company site: careers.acme.com/job?gh_jid=<id>
  const ghJid = u.searchParams.get('gh_jid');
  if (ghJid && /^\d+$/.test(ghJid)) {
    for (const board of greenhouseBoards(u, html)) {
      const r = await greenhouse(board, ghJid).catch(() => null);
      if (r) return r;
    }
    return null;
  }

  // Lever: jobs.lever.co/<company>/<uuid>
  if (u.hostname === 'jobs.lever.co' && parts[1]) {
    const j = await getJson(`https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}`);
    const lists = (j.lists || []).map((l: { text: string; content: string }) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join('');
    const sr = j.salaryRange ? `${j.salaryRange.currency} ${j.salaryRange.min}–${j.salaryRange.max} ${j.salaryRange.interval || ''}`.trim() : undefined;
    return { ats: 'lever', title: j.text, company: parts[0], location: j.categories?.location, comp: sr, html: `${j.description || ''}${lists}${j.additional || ''}` };
  }

  // Ashby: jobs.ashbyhq.com/<org>/<uuid>
  if (u.hostname === 'jobs.ashbyhq.com' && parts[1]) {
    const board = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${parts[0]}?includeCompensation=true`);
    const j = (board.jobs || []).find((x: { id: string }) => x.id === parts[1]);
    if (!j) return null;
    return {
      ats: 'ashby', title: j.title, company: parts[0], location: [j.location, j.isRemote ? 'Remote' : ''].filter(Boolean).join(', '),
      comp: j.compensation?.compensationTierSummary, html: j.descriptionHtml || '',
    };
  }
  return null;
}
