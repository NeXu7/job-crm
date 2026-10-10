// Wrappers over the server API.
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = r.headers.get('content-type') || '';
  const data = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError((data as { error?: string })?.error || r.statusText, r.status, (data as { code?: string })?.code);
  return data as T;
}

export const api = {
  get: <T>(u: string) => call<T>('GET', u),
  post: <T>(u: string, b?: unknown) => call<T>('POST', u, b ?? {}),
  put: <T>(u: string, b?: unknown) => call<T>('PUT', u, b ?? {}),
  patch: <T>(u: string, b?: unknown) => call<T>('PATCH', u, b ?? {}),
  del: <T>(u: string) => call<T>('DELETE', u),
};

export async function downloadPost(url: string, body: unknown, filename: string) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new ApiError(await r.text(), r.status);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
