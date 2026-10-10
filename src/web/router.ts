// Hash routes: #/today, #/pipeline, #/app/<id>/<tab>, #/builder/<appId>, #/facts/<exp>, #/interview/<category|stories|sides>, #/fill[/<level>[/<bank>]], #/guide/<section>
import { useSyncExternalStore } from 'react';

const subscribe = (f: () => void) => { window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); };
const get = () => location.hash.replace(/^#\/?/, '');

export function useRoute(): string[] {
  const h = useSyncExternalStore(subscribe, get);
  return (h || 'today').split('/').map(decodeURIComponent);
}

export const go = (path: string) => { location.hash = '#/' + path; };
export const href = (path: string) => '#/' + path;
