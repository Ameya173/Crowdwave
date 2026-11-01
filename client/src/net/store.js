// Minimal promise wrapper around IndexedDB (database "crowdwave").
let dbp;
const db = () => (dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('crowdwave', 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    d.createObjectStore('identity');
    d.createObjectStore('rooms', { keyPath: 'roomId' });
    d.createObjectStore('manifests', { keyPath: 'transferId' }).createIndex('room', 'roomId');
    d.createObjectStore('chunks');
    d.createObjectStore('chunkMap');
    d.createObjectStore('messages', { keyPath: 'msgId' }).createIndex('room', 'room');
    d.createObjectStore('settings');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
function run(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB error'));
  }));
}
export const get = (s, k) => run(s, 'readonly', (o) => o.get(k));
export const put = (s, v, k) => run(s, 'readwrite', (o) => (k === undefined ? o.put(v) : o.put(v, k)));
export const del = (s, k) => run(s, 'readwrite', (o) => o.delete(k));
export const all = (s) => run(s, 'readonly', (o) => o.getAll());
export const byIndex = (s, idx, key) => run(s, 'readonly', (o) => o.index(idx).getAll(key));
export const putChunk = (sk, i, u8) => put('chunks', u8, `${sk}:${i}`);
export const getChunk = (sk, i) => get('chunks', `${sk}:${i}`);
export const dropChunks = (sk) => run('chunks', 'readwrite', (o) => o.delete(IDBKeyRange.bound(sk + ':', sk + ':\uffff')));
export async function estimate() { try { return await navigator.storage.estimate(); } catch { return {}; } }
