// Reading and writing data files. All writes are atomic and marked as "own",
// so the file watcher doesn't mistake them for external edits.
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const selfWrites = new Map<string, number>();
export const markSelf = (p: string) => selfWrites.set(path.resolve(p), Date.now());
export const isSelfWrite = (p: string) => {
  const t = selfWrites.get(path.resolve(p));
  return t !== undefined && Date.now() - t < 2500;
};

export async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function readText(p: string) {
  return fs.readFile(p, 'utf8');
}

export async function writeAtomic(p: string, data: string | Buffer) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  markSelf(p);
  await fs.rename(tmp, p);
}

export async function removeFile(p: string) {
  markSelf(p);
  await fs.rm(p, { force: true });
}

/** Drops undefined and empty optional fields to keep the YAML clean. */
export function prune<T>(v: T): T {
  if (Array.isArray(v)) return v.map(prune) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined || x === null || x === '') continue;
      out[k] = prune(x);
    }
    return out as T;
  }
  return v;
}

/** Drops empty lists and objects — for files where empty means the default value (not for recipes). */
export function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(compact) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const c = compact(x);
      if (Array.isArray(c) && !c.length) continue;
      if (c && typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length) continue;
      out[k] = c;
    }
    return out as T;
  }
  return v;
}

/** Short scalar lists (tags, roles, fact ids) are written inline: [a, b, c]. */
function flowShortLists(doc: YAML.Document) {
  YAML.visit(doc, {
    Seq(_k, node) {
      const items = node.items as unknown[];
      if (items.length && items.every((i) => YAML.isScalar(i) && String((i as YAML.Scalar).value).length < 60)) {
        const len = items.reduce<number>((s, i) => s + String((i as YAML.Scalar).value).length + 2, 0);
        if (len < 160) node.flow = true;
      }
    },
  });
}

export function yamlString(obj: unknown) {
  const doc = new YAML.Document(obj);
  flowShortLists(doc);
  return doc.toString({ lineWidth: 0, indentSeq: true, flowCollectionPadding: false });
}

export function toYaml(obj: unknown, header?: string) {
  const head = header ? header.trim().split('\n').map((l) => (l ? `# ${l}` : '#')).join('\n') + '\n\n' : '';
  return head + yamlString(obj);
}

export async function readYaml<T = unknown>(p: string): Promise<T> {
  return YAML.parse(await readText(p)) as T;
}

export async function writeYaml(p: string, obj: unknown, header?: string) {
  await writeAtomic(p, toYaml(prune(obj), header));
}

// --- Markdown with a YAML header and "## Heading" sections ---

export function parseFrontmatter(src: string): { meta: Record<string, unknown>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  return { meta: (YAML.parse(m[1]) as Record<string, unknown>) || {}, body: m[2] };
}

export function serializeFrontmatter(meta: unknown, body: string) {
  return `---\n${yamlString(prune(meta))}---\n\n${body.trim()}\n`;
}

/** Splits the body into sections by second-level headings. Text before the first heading goes under the key ''. */
export function parseSections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let key = '';
  let buf: string[] = [];
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      out.set(key, buf.join('\n').trim());
      key = h[1];
      buf = [];
    } else buf.push(line);
  }
  out.set(key, buf.join('\n').trim());
  return out;
}

export function buildSections(title: string, sections: [string, string][]) {
  return [`# ${title}`, ...sections.map(([h, t]) => `## ${h}\n\n${t.trim()}`)].join('\n\n');
}
