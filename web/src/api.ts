import type { RouteDocument, RouteSnapshot, User } from './model';
let csrf = '';
/** Safe public API failure with the server trace ID for diagnostic correlation. */
export class ApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public trace = '',
  ) {
    super(message);
  }
}
/** Call a friendly same-origin API path and unwrap its JSON envelope.
 * @param signal Abort old lookups when the route position changes or the viewer closes.
 * @throws ApiFailure for a rejected response or malformed JSON. */
export async function request<T>(
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    method,
    signal,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json().catch(() => {
    throw new ApiFailure('invalid_response', 'The server returned an invalid response.');
  });
  if (!response.ok)
    throw new ApiFailure(
      result.error?.code ?? 'internal_error',
      result.error?.message ?? 'Request failed.',
      result.trace_id,
    );
  return result.data as T;
}
/** Bootstrap current account and CSRF token; retain the HttpOnly session cookie in the browser. */
export async function session(): Promise<User | null> {
  const data = await request<{ user: User | null; csrf: string }>('/session');
  csrf = data.csrf;
  return data.user;
}
/** Log in with the current CSRF token and replace it after session rotation. */
export async function login(email: string, password: string): Promise<User> {
  const data = await request<{ user: User; csrf: string }>('/login', 'POST', { email, password });
  csrf = data.csrf;
  return data.user;
}
/** Rotate the session and retain the replacement anonymous CSRF token. */
export async function logout(): Promise<void> {
  const data = await request<{ csrf: string }>('/logout', 'POST', {});
  csrf = data.csrf;
}
/** Create a first draft or append the next revision with the expected variant version. */
export function saveDocument(
  document: RouteDocument,
  previous: RouteSnapshot | null,
): Promise<RouteSnapshot> {
  return previous
    ? request(`/routes/${previous.id}/draft`, 'PUT', {
        ...document,
        expectedVersion: previous.version,
      })
    : request('/routes', 'POST', document);
}
/** Build a report URL for the exact revision and language without API query parameters. */
export function reportUrl(route: RouteSnapshot, lang: string, format: 'pdf' | 'html'): string {
  return `/api/v1/routes/${route.id}/revisions/${route.revisionId}/report/${lang}.${format}`;
}
/** Build an authorized media URL; the server independently checks revision visibility. */
export const mediaUrl = (id: string) => `/api/v1/media/${encodeURIComponent(id)}`;
/** Stream a multipart file with progress and cancellation; no base64 video or JSON upload body. */
export function uploadMedia(
  file: File,
  kind: 'photo' | 'video',
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('POST', `/api/v1/media/${kind === 'photo' ? 'photos' : 'videos'}`);
    xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress((e.loaded / e.total) * 100);
    };
    const done = () => signal.removeEventListener('abort', abort);
    xhr.onload = () => {
      done();
      let data: any;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new ApiFailure(
            xhr.status === 413 ? 'media_too_large' : 'invalid_response',
            'Upload failed.',
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.data);
      else
        reject(
          new ApiFailure(
            data.error?.code ?? 'internal_error',
            data.error?.message ?? 'Upload failed.',
            data.trace_id,
          ),
        );
    };
    xhr.onerror = () => {
      done();
      reject(new ApiFailure('upload_failed', 'Upload failed.'));
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
