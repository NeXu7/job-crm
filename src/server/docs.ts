// TODOs in free-form profile documents (positioning.md etc.) are also gaps to fill.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config';
import type { DocTodo } from '../shared/gaps';

const DIRS = ['00-profile'];

export async function docTodos(): Promise<DocTodo[]> {
  const out: DocTodo[] = [];
  for (const dir of DIRS) {
    let files: string[] = [];
    try { files = (await fs.readdir(path.join(ROOT, dir))).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of files.sort()) {
      const text = await fs.readFile(path.join(ROOT, dir, f), 'utf8').catch(() => '');
      text.split('\n').forEach((line, i) => {
        if (!line.includes('TODO')) return;
        const clean = line.replace(/[`*|>]/g, ' ').replace(/\s+/g, ' ').trim();
        out.push({ file: `${dir}/${f}`, line: i + 1, text: clean.length > 160 ? clean.slice(0, 157) + '…' : clean });
      });
    }
  }
  return out;
}
