// Data file watcher: edits by the agent or by hand are picked up immediately and pushed to the UI.
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { P, ROOT } from './config';
import { isSelfWrite } from './fsio';
import {
  changed, loadApp, loadCompanies, loadFacts, loadIcp, loadProfile, loadNotes, loadQuestions, loadRecipes, loadStories, loadStrengths, loadSummaries, serial,
} from './store';

const timers = new Map<string, NodeJS.Timeout>();

function scopeOf(file: string): { scope: string; id?: string; load: () => Promise<void> } | null {
  const f = path.resolve(file);
  if (f === P.profile) return { scope: 'profile', load: loadProfile };
  if (f === P.icp) return { scope: 'icp', load: loadIcp };
  if (f === P.summaries) return { scope: 'summaries', load: loadSummaries };
  if (f === P.stories) return { scope: 'stories', load: loadStories };
  if (f === P.strengths) return { scope: 'strengths', load: loadStrengths };
  if (f.startsWith(P.notes + path.sep)) return { scope: 'notes', load: loadNotes };
  if (f.startsWith(P.facts + path.sep)) return { scope: 'facts', load: loadFacts };
  if (f.startsWith(P.questions + path.sep)) return { scope: 'questions', load: loadQuestions };
  if (f.startsWith(P.recipes + path.sep)) return { scope: 'recipes', load: loadRecipes };
  if (f.startsWith(P.companies + path.sep)) return { scope: 'companies', load: loadCompanies };
  if (f.startsWith(P.apps + path.sep)) {
    const id = path.relative(P.apps, f).split(path.sep)[0];
    return { scope: 'applications', id, load: () => loadApp(id) };
  }
  return null;
}

export function startWatcher() {
  // chokidar never picks up a nested watched dir (04-resume/recipes) created after start, so create them all first.
  for (const d of [P.facts, P.questions, P.notes, P.recipes, P.companies, P.apps]) fs.mkdirSync(d, { recursive: true });
  const w = chokidar.watch([path.join(ROOT, '00-profile'), path.join(ROOT, '02-pipeline'), path.join(ROOT, '04-resume/recipes')], {
    ignoreInitial: true,
    ignored: (p: string) => /\.tmp-\d+-\d+$/.test(p) || p.includes(`${path.sep}capture${path.sep}`) || p.endsWith('.DS_Store'),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  w.on('all', (_ev, file) => {
    if (isSelfWrite(file)) return;
    const s = scopeOf(file);
    if (!s) return;
    const key = s.scope + (s.id || '');
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      serial(s.load).then(() => changed({ scope: s.scope, id: s.id, by: 'external', message: `${path.relative(ROOT, file)} изменён вне интерфейса` }));
    }, 200));
  });
  return w;
}
