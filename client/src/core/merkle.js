import { sha256 } from './crypto.js';
import { concat } from './bytes.js';
const NODE = new Uint8Array([1]);
/** Merkle root over leaf hashes (Uint8Array[]); odd node is paired with itself. */
export async function merkleRoot(leaves) {
  if (!leaves.length) return sha256(new Uint8Array(0));
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256(concat(NODE, level[i], level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}
