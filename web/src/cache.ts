import type {RouteSnapshot} from './model';
const DB = 'gtt-trainer-study';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('snapshots');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function cachePublished(routes: RouteSnapshot[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(routes.filter(r => r.status === 'published' && !r.deleted), 'routes');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}
export async function readPublished(): Promise<RouteSnapshot[]> {
  const db = await open();
  return new Promise<RouteSnapshot[]>((resolve, reject) => {
    const tx = db.transaction('snapshots'); const req = tx.objectStore('snapshots').get('routes');
    req.onsuccess = () => resolve(req.result ?? []); req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
