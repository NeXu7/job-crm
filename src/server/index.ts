// CRM HTTP server: API, events (SSE), fonts, the built UI.
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import YAML from 'yaml';
import { z } from 'zod';
import { APP_DIR, ENV_FILE, EXTENSION_DIR, ORIGIN, PORT, ROOT } from './config';
import {
  addTimeline, bank, bus, createApp, createFact, createLock, db, deleteApp, deleteExperience, deleteFact, deleteRecipe,
  getApp, appPath, loadAll, patchApp, reorderFacts, saveAppRecipe, saveIcp, saveProfile, saveRecipe, saveSummaries,
  updateFact, upsertCompany, upsertExperience, UserError, formatZod, type ChangeEvent,
  createQuestion, updateQuestion, deleteQuestion, questionById, upsertStory, deleteStory,
  patchPrepItem, addPrepItem, deletePrepItem, promotePrepItem,
  upsertSide, deleteSide, createNote, appendNote, setNoteStatus, deleteNote, readNote, type SideKind,
} from './store';
import { docTodos } from './docs';
import { computeGaps } from '../shared/gaps';
import { draftAnswer, findPrepItem, prepApp } from './prep';
import { startWatcher } from './watch';
import { checkRepo, dirtyFiles, gitWarnings, journal, queueCommit } from './git';
import { checkClaudeAuth, claudeStatus } from './claude';
import { runCapture, startCapture } from './capture';
import { analyzeApp } from './analyze';
import { lockPdf, renderPdf } from './pdf';
import { closeBrowser } from './browser';
import { addDays, today } from '../shared/pipeline';
import { pdfName, resolveRecipe } from '../shared/resume';
import { renderResumeText } from '../shared/template';
import { IcpSchema, type AppState, type PrepItem, type QuestionCategory, type Recipe } from '../shared/schema';

const app = new Hono();

app.onError((e, c) => {
  if (e instanceof UserError) return c.json({ error: e.message, code: e.code }, e.status as 400);
  if (e instanceof z.ZodError) return c.json({ error: `Неверные данные: ${formatZod(e)}`, code: 'invalid' }, 400);
  console.error(e);
  return c.json({ error: (e as Error).message }, 500);
});

// DNS rebinding: a foreign page whose domain resolves to 127.0.0.1 reaches this server with its own name in
// Host and could read GET /api/state (profile, contacts, facts). Only local names pass; any port, because the
// Vite dev server forwards Host unchanged.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use('*', async (c, next) => {
  if (!LOCAL_HOST.test(c.req.header('host') || '')) return c.json({ error: 'Неизвестный адрес: CRM открывается только как localhost' }, 403);
  await next();
});

// Mutating requests from other web pages (CSRF): a browser always sends Origin on a cross-site POST, and a
// text/plain POST skips the CORS preflight. Allowed: the UI itself (any localhost port, incl. the Vite dev
// server) and the browser extension. A capture would otherwise spend the user's Claude quota.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const EXT_ORIGIN = /^chrome-extension:\/\//;
app.use('/api/*', async (c, next) => {
  const o = c.req.header('origin');
  if (o && c.req.method !== 'GET' && c.req.method !== 'HEAD' && !LOCAL_ORIGIN.test(o) && !EXT_ORIGIN.test(o)) {
    return c.json({ error: 'Запрос с посторонней страницы отклонён' }, 403);
  }
  await next();
});
// The browser extension sends a capture from chrome-extension://…
app.use('/api/capture', cors({ origin: (o) => (EXT_ORIGIN.test(o) ? o : null), allowMethods: ['POST', 'OPTIONS'] }));
app.use('/fonts/*', cors({ origin: '*' }));

const body = async <T>(c: Context) => (await c.req.json().catch(() => ({}))) as T;

/** ICP criteria of template/: a workspace still holding them word for word has not written its own yet. */
const TEMPLATE_ICP = (() => {
  try { return IcpSchema.parse(YAML.parse(readFileSync(path.join(APP_DIR, 'template/00-profile/icp.yaml'), 'utf8'))).criteria; } catch { return []; }
})();
const icpFromTemplate = () =>
  db.icp.criteria.filter((c) => TEMPLATE_ICP.some((t) => t.id === c.id && t.target === c.target && t.reject === c.reject)).map((c) => c.id);

function snapshot(): AppState & { errors: typeof db.errors } {
  return {
    profile: db.profile, icp: db.icp, summaries: db.summaries, experiences: db.experiences, facts: db.facts,
    recipes: db.recipes, companies: db.companies, applications: [...db.apps.values()],
    questions: db.questions, stories: db.stories, strengths: db.strengths, weaknesses: db.weaknesses, notes: db.notes,
    claude: { ...claudeStatus }, today: today(), errors: db.errors,
    root: ROOT, extensionDir: EXTENSION_DIR, warnings: gitWarnings(), icpTemplate: icpFromTemplate(),
  };
}

// ---------- state and events ----------
app.get('/api/state', (c) => c.json(snapshot()));

const clients = new Set<(ev: ChangeEvent) => void>();
bus.on('change', (ev: ChangeEvent) => {
  clients.forEach((send) => send(ev));
  if (ev.by !== 'external' && ev.message) queueCommit(ev.message);
});

app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const send = (ev: ChangeEvent) => void stream.writeSSE({ event: 'change', data: JSON.stringify(ev) });
    clients.add(send);
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 25_000);
    await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
    clearInterval(ping);
    clients.delete(send);
  }),
);

app.post('/api/claude/check', async (c) => {
  const before = claudeStatus.status;
  const st = await checkClaudeAuth();
  if (before !== 'ok' && st.status === 'ok') retryFailedAnalyses();
  bus.emit('change', { scope: 'claude', by: 'system' });
  return c.json(st);
});

/** After signing in to Claude — re-run analysis and question selection for jobs that failed on auth. */
function retryFailedAnalyses() {
  const authFail = (e?: string) => /authenticat|login|oauth/i.test(e || '');
  for (const a of db.apps.values()) {
    if (a.analysis.status === 'failed' && authFail(a.analysis.error) && a.files.md) {
      void analyzeApp(a.id).catch((e) => console.warn('[analyze]', e.message));
    } else if (a.prep.claude.status === 'failed' && authFail(a.prep.claude.error)) {
      void prepApp(a.id).catch((e) => console.warn('[prep]', e.message));
    }
  }
}

app.get('/api/journal', async (c) => c.json({ entries: await journal(), dirty: await dirtyFiles() }));

// ---------- fact bank ----------
app.post('/api/facts', async (c) => {
  const { exp, after, ...data } = await body<{ exp: string; after?: string } & Record<string, unknown>>(c);
  return c.json(await createFact(exp, data, after));
});
app.put('/api/facts/:id', async (c) => c.json(await updateFact(c.req.param('id'), await body(c))));
app.delete('/api/facts/:id', async (c) => { await deleteFact(c.req.param('id')); return c.json({ ok: true }); });
app.post('/api/experiences/:id/order', async (c) => { await reorderFacts(c.req.param('id'), (await body<{ ids: string[] }>(c)).ids); return c.json({ ok: true }); });
app.post('/api/experiences', async (c) => c.json(await upsertExperience(await body(c), true)));
app.put('/api/experiences/:id', async (c) => c.json(await upsertExperience({ ...(await body<object>(c)), id: c.req.param('id') }, false)));
app.delete('/api/experiences/:id', async (c) => { await deleteExperience(c.req.param('id')); return c.json({ ok: true }); });
app.put('/api/summaries', async (c) => { const b = await body<{ summaries: never[]; message?: string }>(c); await saveSummaries(b.summaries, b.message || 'саммари изменены'); return c.json({ ok: true }); });
app.put('/api/profile', async (c) => { await saveProfile(await body(c)); return c.json({ ok: true }); });
app.put('/api/icp', async (c) => { await saveIcp(await body(c)); return c.json({ ok: true }); });

// ---------- recipes ----------
app.post('/api/recipes', async (c) => c.json(await saveRecipe(await body<Recipe>(c), true)));
app.put('/api/recipes/:id', async (c) => c.json(await saveRecipe({ ...(await body<Recipe>(c)), id: c.req.param('id') })));
app.delete('/api/recipes/:id', async (c) => { await deleteRecipe(c.req.param('id')); return c.json({ ok: true }); });

app.post('/api/resume/pdf', async (c) => {
  const { recipe } = await body<{ recipe: Recipe }>(c);
  const resolved = resolveRecipe(recipe, bank());
  const buf = await renderPdf(resolved);
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${pdfName(resolved.name, resolved.headline)}"` } });
});
app.post('/api/resume/text', async (c) => {
  const { recipe } = await body<{ recipe: Recipe }>(c);
  return c.text(renderResumeText(resolveRecipe(recipe, bank())));
});

// ---------- applications ----------
app.post('/api/capture', async (c) => {
  const b = await body<{ url?: string; html?: string; title?: string; text?: string; source?: string }>(c);
  if (!b.url && !b.html && !b.text) throw new UserError('Нужна ссылка, HTML или текст вакансии');
  if (b.html && b.html.length > 15_000_000) throw new UserError('Страница слишком большая');
  const { app: a, duplicate } = await startCapture(b);
  return c.json({ id: a.id, duplicate, url: `${ORIGIN}/#/app/${a.id}` });
});

app.post('/api/applications', async (c) => {
  const b = await body<{ company_name?: string; role?: string; url?: string; source?: string; legacy?: boolean }>(c);
  const a = await createApp({ ...b, timeline: [{ date: today(), kind: 'найдено', text: b.source || 'добавлено вручную' }] });
  if (b.company_name) await upsertCompany({ name: b.company_name }).then((co) => patchApp(a.id, { company: co.slug }, 'system'));
  return c.json(a);
});

const PATCHABLE = ['company_name', 'role', 'track', 'stage', 'outcome', 'url', 'source', 'location', 'team_tz', 'comp', 'summary', 'fit', 'fit_notes',
  'flags', 'requirements', 'next', 'people', 'whyThem', 'whyMe', 'notes', 'legacy', 'timeline', 'why_points', 'questions'] as const;
app.patch('/api/applications/:id', async (c) => {
  const b = await body<Record<string, unknown>>(c);
  const patch = Object.fromEntries(Object.entries(b).filter(([k]) => (PATCHABLE as readonly string[]).includes(k)));
  if (b.next === null) (patch as Record<string, unknown>).next = undefined;
  return c.json(await patchApp(c.req.param('id'), patch));
});
app.delete('/api/applications/:id', async (c) => { await deleteApp(c.req.param('id')); return c.json({ ok: true }); });
app.post('/api/applications/:id/timeline', async (c) => {
  const b = await body<{ date?: string; kind: string; text: string }>(c);
  return c.json(await addTimeline(c.req.param('id'), { date: b.date || today(), kind: b.kind || 'заметка', text: b.text || '' }));
});
app.put('/api/applications/:id/recipe', async (c) => c.json(await saveAppRecipe(c.req.param('id'), (await body<{ recipe: Recipe | null }>(c)).recipe)));

app.post('/api/applications/:id/lock', async (c) => {
  const lock = await createLock(c.req.param('id'), (await body<{ recipe: Recipe }>(c)).recipe);
  void lockPdf(lock.content_hash, lock.resolved).catch((e) => console.warn('[pdf]', e.message));
  return c.json(lock);
});

app.post('/api/applications/:id/send', async (c) => {
  const id = c.req.param('id');
  const { hash, via } = await body<{ hash?: string; via?: string }>(c);
  const a = getApp(id);
  const lock = hash ? a.locks.find((l) => l.hash === hash) : a.locks.at(-1);
  if (!lock) throw new UserError('Сначала зафиксируй резюме (lock)', 409, 'lock');
  return c.json(await patchApp(id, {
    stage: a.stage === 'research' || a.stage === 'ready' ? 'applied' : a.stage,
    sent_lock: lock.hash,
    next: { text: 'Follow-up, если нет ответа', date: addDays(today(), 7) },
    timeline: [...a.timeline, { date: today(), kind: 'отклик', text: `отправлено резюме lock ${lock.hash}${via ? ` · ${via}` : ''}` }],
  }, 'ui', `${id}: отклик отправлен, lock ${lock.hash}`));
});

app.post('/api/applications/:id/recapture', async (c) => {
  const a = getApp(c.req.param('id'));
  if (!a.url) throw new UserError('У отклика нет ссылки');
  void runCapture(a.id, { url: a.url }).catch((e) => console.error('[capture]', e));
  return c.json({ ok: true });
});
app.post('/api/applications/:id/analyze', async (c) => {
  const a = getApp(c.req.param('id'));
  void analyzeApp(a.id).catch((e) => console.error('[analyze]', e.message));
  return c.json({ ok: true });
});
app.post('/api/applications/:id/text', async (c) => {
  // manual paste of the job text if the page is unavailable
  const a = getApp(c.req.param('id'));
  const { text } = await body<{ text: string }>(c);
  if (!text?.trim()) throw new UserError('Пустой текст');
  void runCapture(a.id, { text, url: undefined }).catch((e) => console.error('[capture]', e));
  return c.json({ ok: true });
});

const CAPTURE_FILES: Record<string, string> = { 'page.html': 'text/html; charset=utf-8', 'page.md': 'text/markdown; charset=utf-8', 'screenshot.png': 'image/png', 'meta.json': 'application/json' };
app.get('/api/applications/:id/capture/:file', async (c) => {
  const file = c.req.param('file');
  const type = CAPTURE_FILES[file];
  if (!type) throw new UserError('Нет такого файла', 404);
  const p = appPath(getApp(c.req.param('id')).id, 'capture', file);
  const buf = await fs.readFile(p).catch(() => null);
  if (!buf) throw new UserError('Файл не найден', 404);
  const headers: Record<string, string> = { 'content-type': type };
  if (file === 'page.html') headers['content-security-policy'] = 'sandbox; script-src \'none\'';
  return new Response(new Uint8Array(buf), { headers });
});

app.get('/api/applications/:id/locks/:hash/pdf', async (c) => {
  const a = getApp(c.req.param('id'));
  const lock = a.locks.find((l) => l.hash === c.req.param('hash'));
  if (!lock) throw new UserError('Нет такого lock', 404);
  const buf = await lockPdf(lock.content_hash, lock.resolved);
  const disp = c.req.query('download') ? 'attachment' : 'inline';
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `${disp}; filename="${pdfName(lock.resolved.name, lock.resolved.headline)}"` } });
});
app.get('/api/applications/:id/locks/:hash/text', async (c) => {
  const lock = getApp(c.req.param('id')).locks.find((l) => l.hash === c.req.param('hash'));
  if (!lock) throw new UserError('Нет такого lock', 404);
  return c.text(renderResumeText(lock.resolved));
});

// ---------- interviews: question bank, stories, «Подготовка» ----------
app.post('/api/questions', async (c) => {
  const { category, ...data } = await body<{ category: QuestionCategory } & Record<string, unknown>>(c);
  return c.json(await createQuestion(category, data));
});
app.put('/api/questions/:id', async (c) => {
  const { message, ...patch } = await body<{ message?: string } & Record<string, unknown>>(c);
  return c.json(await updateQuestion(c.req.param('id'), patch, message));
});
app.delete('/api/questions/:id', async (c) => { await deleteQuestion(c.req.param('id')); return c.json({ ok: true }); });
app.post('/api/questions/:id/draft', async (c) => {
  const q = questionById(c.req.param('id'));
  if (!q) throw new UserError('Нет такого вопроса', 404);
  const { app: appId } = await body<{ app?: string }>(c);
  return c.json(await draftAnswer({ question: q, appId }));
});

app.post('/api/stories', async (c) => c.json(await upsertStory(undefined, await body(c), true)));
app.put('/api/stories/:id', async (c) => c.json(await upsertStory(c.req.param('id'), await body(c), false)));
app.delete('/api/stories/:id', async (c) => { await deleteStory(c.req.param('id')); return c.json({ ok: true }); });

app.post('/api/applications/:id/prep/generate', async (c) => {
  const a = getApp(c.req.param('id'));
  void prepApp(a.id).catch((e) => console.error('[prep]', e.message));
  return c.json({ ok: true });
});
app.post('/api/applications/:id/prep/items', async (c) => c.json(await addPrepItem(c.req.param('id'), await body<Partial<PrepItem>>(c))));
app.put('/api/applications/:id/prep/items/:key', async (c) => {
  const { message, ...patch } = await body<{ message?: string } & Partial<PrepItem>>(c);
  return c.json(await patchPrepItem(c.req.param('id'), c.req.param('key'), patch, message));
});
app.delete('/api/applications/:id/prep/items/:key', async (c) => { await deletePrepItem(c.req.param('id'), c.req.param('key')); return c.json({ ok: true }); });
app.post('/api/applications/:id/prep/items/:key/promote', async (c) => {
  const { category } = await body<{ category: QuestionCategory }>(c);
  return c.json(await promotePrepItem(c.req.param('id'), c.req.param('key'), category));
});
app.post('/api/applications/:id/prep/items/:key/draft', async (c) => {
  const a = getApp(c.req.param('id'));
  const key = c.req.param('key');
  const q = questionById(key);
  const item = findPrepItem(a, key);
  if (!q && !item) throw new UserError('Нет такого вопроса', 404);
  return c.json(await draftAnswer({ question: q, item, appId: a.id }));
});

// ---------- strengths and weaknesses ----------
const sideKind = (k: string): SideKind => {
  if (k !== 'strength' && k !== 'weakness') throw new UserError('Неизвестный вид записи', 404);
  return k;
};
app.post('/api/sides/:kind', async (c) => c.json(await upsertSide(sideKind(c.req.param('kind')), undefined, await body(c), true)));
app.put('/api/sides/:kind/:id', async (c) => c.json(await upsertSide(sideKind(c.req.param('kind')), c.req.param('id'), await body(c), false)));
app.delete('/api/sides/:kind/:id', async (c) => { await deleteSide(sideKind(c.req.param('kind')), c.req.param('id')); return c.json({ ok: true }); });

// ---------- «Наполнение»: raw notes and gap queue ----------
app.get('/api/gaps', async (c) => c.json(computeGaps(snapshot(), await docTodos())));
app.get('/api/doc-todos', async (c) => c.json(await docTodos()));
app.get('/api/notes/:file', async (c) => c.json(await readNote(c.req.param('file'))));
app.post('/api/notes', async (c) => {
  const b = await body<{ title?: string; text?: string; kind?: 'dump' | 'session' }>(c);
  if (!b.text?.trim()) throw new UserError('Пустая заметка');
  return c.json(await createNote({ title: b.title?.trim() || 'Сырьё', text: b.text, kind: b.kind }));
});
app.put('/api/notes/:file', async (c) => {
  const b = await body<{ status?: 'new' | 'processed'; append?: string; heading?: string }>(c);
  if (b.append?.trim()) await appendNote(c.req.param('file'), b.append, b.heading);
  if (b.status) await setNoteStatus(c.req.param('file'), b.status);
  return c.json({ ok: true });
});
app.delete('/api/notes/:file', async (c) => { await deleteNote(c.req.param('file')); return c.json({ ok: true }); });

// ---------- fonts for the resume template ----------
app.get('/fonts/:pkg/:file', async (c) => {
  const { pkg, file } = c.req.param();
  if (!/^[a-z0-9-]+$/.test(pkg) || !/^[a-z0-9-]+\.woff2$/.test(file)) throw new UserError('Нет шрифта', 404);
  const buf = await fs.readFile(path.join(APP_DIR, 'node_modules/@fontsource', pkg, 'files', file)).catch(() => null);
  if (!buf) throw new UserError('Нет шрифта', 404);
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' } });
});

// ---------- built UI ----------
const DIST = path.relative(process.cwd(), path.join(APP_DIR, 'dist/web')) || '.';
app.use('/*', serveStatic({ root: DIST }));
app.get('*', serveStatic({ path: path.join(DIST, 'index.html') }));

// ---------- startup ----------
await loadAll();
const watcher = startWatcher();
void checkRepo();
void checkClaudeAuth().then((st) => console.log(`Claude CLI: ${st.status}${st.message ? ' — ' + st.message : ''}`));
setInterval(() => {
  const before = claudeStatus.status;
  void checkClaudeAuth().then((st) => {
    if (before !== st.status) { if (st.status === 'ok') retryFailedAnalyses(); bus.emit('change', { scope: 'claude', by: 'system' }); }
  });
}, 60_000);
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`CRM: ${ORIGIN}  ·  данные: ${ROOT}`);
  console.log(`фактов ${db.facts.length}, вопросов ${db.questions.length}, историй ${db.stories.length}, откликов ${db.apps.size}, рецептов ${db.recipes.length}${db.errors.length ? `, ошибок в файлах: ${db.errors.length}` : ''}`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Порт ${PORT} занят. Скорее всего, CRM уже запущена в другом терминале — открой ${ORIGIN}.
Кто держит порт: lsof -i :${PORT}. Другой порт: CRM_PORT=${PORT + 1} перед командой запуска
(например, CRM_PORT=${PORT + 1} npm --prefix app start) или строка CRM_PORT=${PORT + 1} в ${ENV_FILE};
тогда впиши этот порт и в окошке расширения («Порт CRM»).`);
  void watcher.close().finally(() => process.exit(1));
});

const shutdown = async () => {
  await watcher.close();
  await closeBrowser();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
