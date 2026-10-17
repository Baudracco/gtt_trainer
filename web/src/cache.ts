import type { RouteSnapshot } from './model';
const DB = 'gtt-trainer-study';
/** Keep private source evidence out of the shared offline publication cache. */
export function studySnapshot(route: RouteSnapshot): RouteSnapshot {
  const { provenance: _private, ...source } = route.source;
  return { ...route, source };
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('snapshots');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** Replace the IndexedDB study cache with current nontrashed publications only. Drafts/sessions/media are excluded. */
export async function cachePublished(routes: RouteSnapshot[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(
      routes.filter((r) => r.status === 'published' && !r.deleted).map(studySnapshot),
      'routes',
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}
/** Read the last publication cache when the API is unreachable; the UI marks offline mode. */
export async function readPublished(): Promise<RouteSnapshot[]> {
  const db = await open();
  return new Promise<RouteSnapshot[]>((resolve, reject) => {
    const tx = db.transaction('snapshots');
    const req = tx.objectStore('snapshots').get('routes');
    req.onsuccess = () => resolve((req.result ?? []).map(studySnapshot));
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
