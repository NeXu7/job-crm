// Headless Claude Code (`claude -p`) with structured output via JSON Schema.
// Lean call: no tools, MCP servers, skills, CLAUDE.md or Claude Code's own system prompt —
// the model reads the given text and returns JSON. Only our prompt and data count against the quota.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, claudeTask, type ClaudeTask } from './config';
import type { Profile } from '../shared/schema';

/** Who the candidate is, from the profile only (positioning, context); '' when both are empty. No defaults. */
export function candidateBlock(p: Pick<Profile, 'positioning' | 'context'>): string {
  const positioning = p.positioning?.trim().replace(/\.+$/, '');
  const context = p.context?.trim();
  return [
    positioning ? `Candidate: ${positioning}.` : '',
    context ? `Candidate context (time zone, location, employment format, constraints): ${context}` : '',
  ].filter(Boolean).join('\n');
}

export type ClaudeStatus = { status: 'unknown' | 'ok' | 'auth' | 'missing' | 'error'; message?: string };
export const claudeStatus: ClaudeStatus = { status: 'unknown' };

const AUTH_HINT = 'Claude CLI не авторизован: выполни в терминале `claude auth login`, затем нажми «Проверить».';

/** Login check without a model request: `claude auth status` prints JSON. */
export function checkClaudeAuth(): Promise<ClaudeStatus> {
  return new Promise((resolve) => {
    execFile(CLAUDE_BIN, ['auth', 'status'], { timeout: 15_000 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        Object.assign(claudeStatus, { status: 'missing', message: `Не найден ${CLAUDE_BIN}. Установи Claude Code CLI.` });
      } else {
        try {
          const j = JSON.parse(stdout);
          if (j.loggedIn) Object.assign(claudeStatus, { status: 'ok', message: undefined });
          else Object.assign(claudeStatus, { status: 'auth', message: AUTH_HINT });
        } catch {
          Object.assign(claudeStatus, { status: 'unknown', message: undefined });
        }
      }
      resolve({ ...claudeStatus });
    });
  });
}

export class ClaudeError extends Error {
  constructor(message: string, public kind: 'auth' | 'missing' | 'timeout' | 'parse' | 'error') { super(message); }
}

// Empty working dir, so the headless session picks up no CLAUDE.md or project settings.
const SANDBOX = path.join(os.tmpdir(), 'job-crm-claude');
fs.mkdirSync(SANDBOX, { recursive: true });

let active = 0;
const queue: (() => void)[] = [];
const MAX_PARALLEL = 2;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new ClaudeError('Ответ без JSON', 'parse');
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * An error result may carry nothing but `subtype` (e.g. error_max_structured_output_retries) or an
 * `errors` list; keep them, else the UI shows a bare «ошибка Claude» with no cause.
 */
function errorText(res: { subtype?: unknown; result?: unknown; error?: unknown; errors?: unknown }, stderr: string): string {
  const str = (x: unknown) => (typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x)).trim();
  const parts = [res.result, res.error, ...(Array.isArray(res.errors) ? res.errors : [])].map(str).filter(Boolean);
  if (res.subtype && res.subtype !== 'success') parts.unshift(str(res.subtype));
  if (!parts.length && stderr.trim()) parts.push(stderr.trim().slice(0, 300));
  return parts.join(': ') || 'ошибка Claude';
}

/** CRM_CLAUDE_LEAN=0 falls back to Claude Code's default system prompt and config (more tokens; for debugging). */
const LEAN = process.env.CRM_CLAUDE_LEAN !== '0';

/**
 * `system` holds the instructions and the stable reference data (bank, facts, stories): it goes first
 * and repeats verbatim between calls, so it can be served from the prompt cache.
 * `input` is what changes per call (the vacancy, the question) and goes as the user message on stdin.
 */
export function runClaude<T>(opts: { task: ClaudeTask; system: string; input: string; schema: object; timeoutMs?: number }): Promise<{ data: T; model: string; costUsd?: number }> {
  return slot(() => new Promise((resolve, reject) => {
    const { model, effort } = claudeTask(opts.task);
    const args = ['-p', '--output-format', 'json', '--model', model, '--effort', effort, '--json-schema', JSON.stringify(opts.schema), '--tools', ''];
    if (LEAN) args.push('--system-prompt', opts.system, '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence');
    else args.push('--append-system-prompt', opts.system);
    if (!/sonnet|haiku/.test(model)) args.push('--fallback-model', 'sonnet');
    const child = spawn(CLAUDE_BIN, args, { cwd: SANDBOX, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new ClaudeError('Claude не ответил за отведённое время', 'timeout')); }, opts.timeoutMs ?? 240_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') {
        Object.assign(claudeStatus, { status: 'missing', message: `Не найден ${CLAUDE_BIN}. Установи Claude Code CLI.` });
        reject(new ClaudeError('Claude Code CLI не найден', 'missing'));
      } else reject(new ClaudeError(e.message, 'error'));
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        if (res.is_error) {
          const msg = errorText(res, err);
          if (/authenticat|login|oauth|credential/i.test(msg)) {
            Object.assign(claudeStatus, { status: 'auth', message: AUTH_HINT });
            return reject(new ClaudeError(msg, 'auth'));
          }
          Object.assign(claudeStatus, { status: 'error', message: msg });
          return reject(new ClaudeError(msg, 'error'));
        }
        const data = (res.structured_output ?? extractJson(String(res.result ?? ''))) as T;
        Object.assign(claudeStatus, { status: 'ok', message: undefined });
        resolve({ data, model, costUsd: res.total_cost_usd });
      } catch (e) {
        const msg = (err || out || (e as Error).message).slice(0, 500);
        reject(e instanceof ClaudeError ? e : new ClaudeError(`Не удалось прочитать ответ Claude: ${msg}`, 'parse'));
      }
    });
    child.stdin.end(opts.input);
  }));
}
