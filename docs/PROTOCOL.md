# Protocol notes

Implements the Crowdwave v2 specification with the changes below. All WebSocket frames: `{v:1,t,id,room?,from?,to?,ts,body}`; the server answers requests with `t:"ack"` and `body:{re:<id>,ok,error?,...}`.

## Deliberate differences from the spec
| Spec | This implementation | Why |
|---|---|---|
| peerId = hash of signing key | peerId = base32(SHA-256(signPub ‖ dhPub)[0..16]) | Binds the ECDH key to the identity so a relay cannot swap it. |
| Binary frame has `payload length` | Header field is the fragment **offset**; length is the message length | Unordered 16 KiB fragments need an offset to be reassembled. |
| Handle assigned at MANIFEST time | handle = first 4 bytes of `transferId` | Needs no negotiation; collisions are detected and ignored. |
| Chunks in OPFS via SyncAccessHandle | Chunks in IndexedDB, saved through the File System Access API when available | Works in every browser, no worker needed; trade-off: higher overhead for multi-GB files. |
| `room.joinResult` carries members + key envelope | `room.joinResult{approved}` only, then the client calls `room.join` and receives the full state | One code path for first join and reconnects. |
| Server tables `questions`, `votes` | Not present | Q&A is end-to-end encrypted; the node cannot read it. |
| PEX message | Not implemented | The tracker already provides peer discovery for room-sized swarms. |
| Bloom filter + LRU for dedup | LRU `Map` of 5000 ids | Sufficient at room scale. |
| Playwright 50-browser swarm harness | Fluid simulator (`bench/`) using the production scheduler | Reproducible with one command; real-device trials still needed for the final numbers. |

## Added in this version
- Manifest fields `keyMode` (`room` | `file`) and `embargoUntil` (ms or null), covered by the author's signature. `file` mode encrypts chunks with a per-file key.
- Gossip channels `receipts` and `unlocks` (all members may post; semantics are checked by receivers). Payloads: `{k:'receipt',tid,root,at}` and `{k:'unlock',tid,key}`; both travel encrypted under the room key like every other message.
- Data-channel frames carry `lastData` activity only locally (UI); no wire change.

## Message types
Signaling: `challenge, hello, welcome, ack, error, room.create, room.join, room.leave, room.joinRequest, room.joinResult, room.approve, room.reject, room.rekey, room.removed, room.setRole, member.update, peer.joined, peer.left, rtc.offer, rtc.answer, rtc.ice, tracker.announce, tracker.peers, manifest.publish, manifest.new, msg.put, msg.new`.
Data channel `ctrl`: `ping, pong, MANIFEST, HAVE, HAVE_DELTA, REQUEST, CANCEL, CHOKE, UNCHOKE, MSG, SYNC_SUMMARY, SYNC_PULL, BYE`. Channel `data`: `PIECE`, `PIECE_NACK` frames.
HTTP: `GET /api/health`, `GET /api/metrics`, `GET /api/rooms/:id`, `GET /api/rooms/:id/manifests`, `GET /api/chunks/:tid` (bitfield), `GET|PUT /api/chunks/:tid/:idx`. Member requests carry `x-cw-auth: peerId.ts.signature`.
