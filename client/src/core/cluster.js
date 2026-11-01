// Duplicate-question clustering. Default: offline lexical embedding (hashed word + trigram vectors).
// Optional: MiniLM sentence embeddings via transformers.js, lazy-loaded behind a feature flag.
const STOP = new Set('a an the is are was were be been to of in on for and or how what why when do does did i you we it this that can could should would with my your at as by from about please sir mam'.split(' '));
const DIM = 512;
const stem = (w) => w.replace(/(ing|ed|es|s)$/,'').replace(/(.)\1$/,'$1');
function h32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function normalize(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; }
export function lexVec(text) {
  const v = new Float32Array(DIM);
  const toks = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).map(stem).filter(Boolean);
  const add = (k, w) => { const h = h32(k); v[h % DIM] += (h & 0x80000000 ? -1 : 1) * w; };
  toks.forEach((t, i) => {
    add('w:' + t, 1);
    if (i > 0) add('b:' + toks[i - 1] + '_' + t, 0.5);
    for (let j = 0; j + 3 <= t.length; j++) add('t:' + t.slice(j, j + 3), 0.25);
  });
  return normalize(v);
}
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** items: [{id, vec, votes}] -> clusters ranked by total votes */
export function clusterItems(items, threshold = 0.5) {
  const clusters = [];
  for (const it of items) {
    let best = null, bs = -1;
    for (const c of clusters) { const s = cosine(it.vec, c.centroid); if (s > bs) { bs = s; best = c; } }
    if (best && bs >= threshold) {
      best.items.push(it);
      const sum = new Float32Array(best.sum.length);
      for (let i = 0; i < sum.length; i++) sum[i] = best.sum[i] + it.vec[i];
      best.sum = sum; best.centroid = normalize(sum);
    } else clusters.push({ id: it.id, items: [it], sum: Float32Array.from(it.vec), centroid: Float32Array.from(it.vec) });
  }
  for (const c of clusters) c.votes = c.items.reduce((a, x) => a + (x.votes || 0), 0);
  return clusters.sort((a, b) => b.votes - a.votes || b.items.length - a.items.length);
}
let miniPromise = null;
export function loadMiniLM() {
  miniPromise ??= (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = true; env.localModelPath = '/models/';
    if (import.meta.env?.VITE_OFFLINE_MODEL === '1') { env.allowRemoteModels = false; env.backends.onnx.wasm.wasmPaths = '/ort/'; }
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    return async (text) => Float32Array.from((await pipe(text, { pooling: 'mean', normalize: true })).data);
  })();
  return miniPromise;
}
