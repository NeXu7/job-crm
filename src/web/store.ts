// Global state: a snapshot of /api/state + reload on server events (SSE) + toasts.
import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { AppState } from '../shared/schema';

export type State = AppState & { errors: { file: string; message: string }[] };
export type Toast = { id: number; text: string; kind?: 'bad'; action?: { label: string; href?: string; run?: () => void } };

let state: State | null = null;
let toasts: Toast[] = [];
let externalNote: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };

export async function refresh() {
  state = await api.get<State>('/api/state');
  emit();
}

let timer: number | undefined;
export function startEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('change', (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as { by: string; message?: string };
    if (ev.by === 'external' && ev.message) { externalNote = ev.message; }
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 120);
  });
  // after a server restart the browser reconnects on its own — pull the fresh state
  es.onopen = () => void refresh();
  es.onerror = () => { /* the browser will reconnect on its own */ };
}

export const useAppState = () => useSyncExternalStore(subscribe, () => state);
export const useToasts = () => useSyncExternalStore(subscribe, () => toasts);
export const useExternalNote = () => useSyncExternalStore(subscribe, () => externalNote);
export const clearExternalNote = () => { externalNote = null; emit(); };

let tid = 0;
export function toast(text: string, kind?: 'bad', action?: Toast['action']) {
  const t = { id: ++tid, text, kind, action };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }, action ? 7000 : 4000);
}
export function dismissToast(id: number) { toasts = toasts.filter((x) => x.id !== id); emit(); }

/** Run an action and show a server error as a toast. */
export async function act<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast((e as Error).message, 'bad');
    return undefined;
  }
}
