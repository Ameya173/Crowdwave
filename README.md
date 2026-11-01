# Crowdwave v2

**Send it early. Prove everyone has it. Open it together.**

Swarm file distribution and messaging for rooms where many people need the same thing and the network is weak: classrooms, labs, hackathons, fests, relief camps.

### What makes Crowdwave different
A literature and landscape review (`docs/LITERATURE_REVIEW.md`) found tools that send one file to one device (Snapdrop, PairDrop), BitTorrent in the browser (WebTorrent), and offline messaging (Briar, Bridgefy), plus research on swarming, gossip and timed release. None of what I found combines swarm delivery, room encryption and offline operation with these two features, which are new here:

1. **Embargoed drops.** Share an exam paper, a results sheet or a lab pack *in advance*. It spreads through the swarm fully encrypted with its own key. At the moment you choose (or when you press "Release now") a signed key message opens it on every device at once, with no download rush. Nobody, not even the Campus Node, can read it before then.
2. **Signed delivery receipts.** Every device that finishes and verifies a file signs a receipt. You see "38 of 41 ready", who is missing, and can export a CSV. Before a release it answers "is the room ready?"; afterwards it is evidence of delivery.

Plus modern touches: live data-flow animation on the swarm map, "x% came from nearby devices" meter, screen wake-lock during transfers, dark mode, install prompt.

- Phones and laptops exchange files **directly over WebRTC**, so 50 devices do not all hammer one uplink.
- A **Campus Node** (your laptop, a Raspberry Pi, or a cloud server) provides signaling, a tracker and an encrypted chunk cache. On a Wi-Fi hotspot it works with **no internet**.
- **End-to-end encrypted rooms**, signed manifests and announcements, per-chunk integrity checks, key rotation on removal.
- **Store-and-forward gossip** for announcements, chat and Q&A, with duplicate-question clustering that works offline.
- Installable **PWA**, QR join, live swarm map, reproducible benchmarks.

Stack: React + Vite (PWA) · Node.js, Express, `ws` · SQLite (`better-sqlite3`) · WebRTC · Web Crypto · IndexedDB · Docker + coturn.
(MongoDB is not needed: the spec's SQLite choice means zero setup on a Raspberry Pi. Details in `docs/PROTOCOL.md`.)

---

## 1. What you need

| Tool | Version | Check |
|---|---|---|
| Node.js | 20 or 22 LTS (22 recommended) | `node -v` |
| npm | comes with Node | `npm -v` |
| A modern browser | Chrome / Edge / Firefox / Safari 16+ | |
| Docker (only for deployment) | any recent | `docker -v` |

`better-sqlite3` ships prebuilt binaries for Node LTS on Windows, macOS and Linux. If `npm install` tries to compile and fails on Windows, install the "Desktop development with C++" workload from Visual Studio Build Tools, or switch to Node 22 LTS.

## 2. Run it on your computer (5 minutes)

Unzip, open a terminal in the `crowdwave` folder, then:

```bash
npm install            # installs "concurrently" for the dev command
npm run setup          # installs server/ and client/ dependencies
npm test               # 14 core tests (crypto, manifests, frames, scheduler, gossip, embargo, receipts, simulators)
npm run dev            # server on :8787, client on :5173
```

Open **http://localhost:5173** in two different browsers (or one normal + one private window). `localhost` counts as a secure context, so cryptography works without HTTPS.

**Try it:**
1. Window A: set a name, **Create room** (turn on *Open join* for the demo).
2. Window A: **People & settings** → copy the invite link.
3. Window B: paste the link on the home page → **Join**. With Open join it enters automatically.
4. Window A: **Files** → share any file. Window B downloads it; the **Swarm** tab shows the connection.
5. Post an announcement, chat, and ask two similar questions in **Messages → Questions**: they group together.

**Try the differentiators (needs two windows):**
1. Window A (owner): **Files** → tick **Embargoed drop**, set the time 2 minutes ahead, share any file.
2. Window B: the file downloads at once but shows **locked** with a countdown; *Save file* is disabled.
3. Window A: under the file you see **Delivery receipts: 1 of 1 devices have it verified**. Click *Who?* or *Export CSV*.
4. Wait for the countdown (or press **Release now**): window B flips to **unlocked** within a second and *Save file* works.

## 3. Run it for real: phones on a Wi-Fi hotspot, no internet

Browsers disable Web Crypto on plain `http://192.168.x.x` addresses, so the Campus Node must serve **HTTPS**.

```bash
npm run build          # builds the PWA into client/dist
npm run start:lan      # serves everything over HTTPS with an auto-generated certificate
```

It prints addresses such as `https://192.168.1.23:8787`. Put the laptop on a hotspot (or a router with no internet), join phones to that Wi-Fi and open that address.

- The certificate is self-signed, so each phone shows a warning once: *Advanced → Proceed*. The app works after that. For a fully trusted install (and offline PWA caching, which browsers refuse on untrusted certificates), create a certificate with [mkcert](https://github.com/FiloSottile/mkcert) for your LAN IP, install mkcert's root CA on the phones, and save the files as `server/data/certs/key.pem` and `server/data/certs/cert.pem`.
- Windows firewall: allow Node.js on **Private networks** when prompted (or open TCP 8787).
- Wi-Fi with **client isolation** (many public hotspots) stops phones reaching each other. Crowdwave then falls back to the Campus Node as the source; the file card shows *Cached on Campus Node*.
- Leave the screen on while transferring. Mobile browsers pause background tabs.

Pure offline: set `CW_OFFLINE=1` in `server/.env` so clients do not try public STUN servers.

## 4. Deploy it online

Crowdwave needs a **long-lived Node process with WebSockets**, so Vercel and Netlify do not fit. Use any Docker host.

### Render / Railway / Fly.io (simplest)
1. Push this folder to a GitHub repo.
2. **Render:** New → Blueprint → select the repo (uses `render.yaml`). Or New → Web Service → Docker, add a 5 GB disk mounted at `/data`, set `TRUST_PROXY=1`.
3. Open the URL Render gives you. TLS is handled by the platform; do **not** set `HTTPS=1` there.
4. Check `https://your-app/api/health`.

### Any VPS
```bash
docker compose up -d --build            # Campus Node on :8787 (self-signed HTTPS)
# or, behind Caddy/nginx that terminates TLS:
HTTPS=0 TRUST_PROXY=1 docker compose up -d --build
```
Caddy example (automatic Let's Encrypt): `crowdwave.example.com { reverse_proxy localhost:8787 }`.

### Devices on different networks (internet use)
Direct WebRTC between strangers behind NAT needs STUN (default: Google's public STUN) and sometimes a **TURN relay**:
```bash
# edit deploy/turnserver.conf: set static-auth-secret, then:
TURN_URL=turn:YOUR_SERVER_IP:3478 TURN_SECRET=the-same-secret docker compose --profile turn up -d --build
```
Open UDP 3478 and 49160-49200. The server hands out short-lived TURN credentials automatically. The connection type per peer (direct / STUN / relay) is shown in the Swarm tab.

## 5. Settings (`server/.env`, copy from `.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | HTTP(S) port |
| `HTTPS` | 0 | `1` or `--https` = self-signed TLS |
| `DATA_DIR` | `server/data` | SQLite database, chunk cache, certificates |
| `CACHE_MB` | 2048 | Chunk cache quota (LRU eviction) |
| `CW_OFFLINE` | 0 | `1` = no public STUN |
| `ICE_SERVERS` | public STUN | JSON array of ICE servers |
| `TURN_URL`, `TURN_SECRET` | empty | coturn relay with ephemeral credentials |
| `TRUST_PROXY` | 0 | `1` behind a reverse proxy / PaaS |
| `MAX_ROOM_MEMBERS` | 300 | Per-room cap |

Metrics: `/api/metrics` (Prometheus format). Health: `/api/health`.

## 6. Benchmarks and evaluation (for your report and demo)

```bash
npm run bench                              # 500 MB to 50 peers: single source vs random vs rarest-first vs bandit, plus 20% peer failure
node bench/run.mjs --peers 20 --mb 100     # custom
npm run bench:cluster                      # precision / recall of duplicate-question grouping at several thresholds
npm run bench:gossip                       # reach and latency of gossip vs fanout and TTL (100 peers), with anti-entropy recovery
```
Results are written to `bench/out/results.json`. The in-app **Benchmark** page runs the same simulation in the browser.

On the reference run (50 peers, 500 MB, source 100 Mbps, peers about 50 Mbps up) the swarm finished in about 200 s versus 2500 s from a single source (about 12x), with the source uploading about 5.6% of the bytes, and 20% peer loss left no failed transfers. **These are simulated numbers**; for your final report, repeat the measurement with real devices (20 phones on a hotspot) and quote the hardware, number of runs and variance.

## 7. How it works

```
Browser A ──WebRTC ctrl+data──▶ Browser B ...           (chunks, HAVE/REQUEST, gossip)
    └──── WebSocket + HTTPS ───▶ Campus Node ◀──── Browser C
                                 signaling · rooms · tracker · SQLite · encrypted chunk cache
```
- **Identity:** each device generates ECDSA + ECDH P-256 keys (private keys non-extractable, stored in IndexedDB). `peerId` is a hash of the public keys.
- **Rooms:** the owner creates a random AES-256 room key and wraps it for each approved member with ECDH + HKDF. Removing someone rotates the key.
- **Files:** encrypted per chunk (AES-GCM, chunk index bound as AAD), hashed, Merkle root signed in a manifest. Receivers verify every chunk before storing it.
- **Scheduling:** rarest-first with a random first piece and endgame duplicate/cancel; epsilon-greedy bandit chooses the peer (EWMA throughput × (1 − error rate)); optional tit-for-tat unchoking; the Campus Node is used only for chunks no peer has.
- **Messages:** signed, encrypted, gossiped with fanout 3 and TTL, with anti-entropy (`SYNC_SUMMARY` / `SYNC_PULL`) so late joiners catch up, and the node stores them as an always-on peer.
- **Embargo + receipts:** an embargoed file is encrypted with a per-file key kept only on the author's device; the key is released as a signed, room-encrypted `unlock` message. Receipts are signed `receipt` messages bound to the file's Merkle root; the owner's dashboard counts only valid ones.
- **Q&A:** random per-question labels, one vote per device bound to the signer, clustering by cosine similarity (offline lexical vectors by default; MiniLM via transformers.js behind a toggle).

Folders: `client/src/core` (pure logic, unit-tested), `client/src/net` (storage, WebRTC, swarm engine, room session), `client/src/ui`, `server/src`, `bench`, `docs`.
Read `docs/LITERATURE_REVIEW.md`, `docs/THREAT_MODEL.md` and `docs/PROTOCOL.md` (includes the list of deliberate deviations from the spec).

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "This page is not a secure context" | Use `http://localhost`, or HTTPS (`npm run start:lan`). |
| Phones cannot open the address | Same Wi-Fi? Firewall allows port 8787? Use the LAN IP printed at startup. |
| Peers stay on "…" or never connect | Client isolation on the Wi-Fi, or different networks without TURN. Enable *Use the Campus Node as fallback* and share to the node. |
| Model download fails (Questions) | Needs internet once; grouping falls back to the offline method automatically. For offline use see below. |
| `better-sqlite3` install error | Use Node 22 LTS; on Windows install VS Build Tools. |
| White page after redeploy | Hard refresh once; the service worker updates itself. |

Offline MiniLM: download the `Xenova/all-MiniLM-L6-v2` files into `client/public/models/Xenova/all-MiniLM-L6-v2/` and copy `node_modules/onnxruntime-web/dist/*.wasm` into `client/public/ort/`, then build with `VITE_OFFLINE_MODEL=1`.

## 9. Honest limitations

- **Embargo is author-controlled:** the author's device must be online at the unlock time (or press *Release now* later). The author can release early. A cryptographic clock such as drand/tlock avoids this trust but needs internet, so it does not fit the offline goal.
- **Receipts are self-attested** (signed claims by each device), not an independent audit.
- Everything in `client/test` passes, but the full app (browser UI, WebRTC across real devices, the server) has to be exercised on your machines; expect to fix small things while you test, especially across iOS Safari.
- Chunks are stored in IndexedDB; very large files (multi-GB) are slower than the spec's OPFS design. Saving uses the File System Access API on desktop Chrome/Edge; elsewhere the file is assembled in memory.
- Mesh size is capped at 24 direct connections per device; the Campus Node covers the rest.
- Q&A is pseudonymous, not anonymous. Members who join after a key rotation cannot read files from older epochs.
- Not a BitTorrent replacement and no background transfers on phones (browser limits).


