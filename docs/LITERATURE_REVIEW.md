# Literature and landscape review

**Question.** What already exists for getting the same data to many nearby devices when connectivity is weak, what do those systems leave unsolved, and what does Crowdwave add?

**Method and honest scope.** Web searches run on 31 Oct 2026 across four areas: browser file sharing, browser BitTorrent, offline mesh messaging, and the research behind swarm scheduling, gossip and timed release. I read project documentation and paper abstracts or the parts of papers that were retrievable. This is a structured landscape review, **not an exhaustive systematic review**: for a thesis, extend it with the search strings at the end and add papers from IEEE Xplore, ACM DL and Google Scholar. Statements of the form "I did not find" mean exactly that.

## 1. What exists

### 1.1 Browser file sharing on a local network
**Snapdrop, PairDrop** (AirDrop-style, WebRTC + a small signaling server). Snapdrop's own FAQ says the signaling server only sets up the connection and is not part of the transfer, and that it falls back to WebSockets where WebRTC is not available (Safari at the time). PairDrop, a fork, adds pairing by 6-digit code or QR, temporary public rooms, an optional TURN server, self-hosting on a Raspberry Pi, and keeping the device awake during transfers.
*Gap:* these are one-to-one transfers. Sending to 40 people means 40 transfers from the sender. They have no group integrity manifest, no room-wide encryption model, no messaging, and no way to know who actually received a file.

### 1.2 BitTorrent in the browser
**WebTorrent** brings the BitTorrent model to browsers over WebRTC data channels, with streaming. A browser "web peer" can only connect to peers that speak WebTorrent/WebRTC, and the usual discovery relies on trackers or DHT.
*Gap:* it is a transport library, not a classroom product. No rooms or membership, no end-to-end room encryption, no signed announcements, no fallback cache that stays ciphertext-only, and no delivery evidence.

### 1.3 Offline mesh and peer-to-peer messaging
**Briar** syncs messages directly over Bluetooth or Wi-Fi when offline and over Tor otherwise; content is stored encrypted on the devices. One review notes it has no iOS app. **Bridgefy** promoted Bluetooth mesh messaging for protests; academic analyses (Albrecht et al., CT-RSA 2021; Albrecht, Eikenberg and Paterson, USENIX Security 2022) found that its confidentiality, authentication and resilience claims did not hold, including after the Signal protocol was adopted. A 2025 paper on group mesh messaging (Amigo; I only saw a secondary summary, verify before citing) reports that earlier secure mesh designs scale poorly for large groups under realistic mobility and radio contention.
*Gap:* these solve small-message delivery. None of what I found does **bulk file swarming** (hundreds of MB to dozens of devices), and the Bridgefy results are a warning that a mesh product needs signed, authenticated messages and a written threat model from the start.

### 1.4 Foundations Crowdwave builds on
- **Piece and peer selection.** Legout, Urvoy-Keller and Michiardi (IMC 2006) measured real torrents and concluded that BitTorrent's rarest-first piece selection gives close to ideal piece diversity and that the choke algorithm is fair and robust to free riders, so replacing them is not justified. Crowdwave keeps both and adds an epsilon-greedy bandit for *which peer to ask*, which I evaluate in simulation rather than claim as novel.
- **Gossip.** Demers et al. (PODC 1987) compare direct mail, anti-entropy and rumor mongering. Rumor mongering is cheap but can leave a few sites uninformed; anti-entropy is slower but reaches everyone, so the paper recommends combining them. Crowdwave's gossip uses fanout and TTL (rumor style) plus `SYNC_SUMMARY/SYNC_PULL` on every new connection (anti-entropy). My simulator reproduces the effect: with fanout 3 and TTL 8 on 100 peers, epidemic spread alone reaches about 97% and the sync rounds bring it to 100%.
- **Timed release.** Rivest, Shamir and Wagner introduced time-lock puzzles (1996). The most practical modern scheme is **tlock** (Gailly, Melissaris, Romailler, 2023), which locks data to a future round of the drand public randomness beacon, so no one, including the sender, can open it early. That guarantee is stronger than anything Crowdwave offers, but it requires reaching the drand network, so it **cannot run on an offline hotspot**.

## 2. Gap analysis

| Need in a crowded, weakly connected room | Snapdrop / PairDrop | WebTorrent | Briar / Bridgefy | tlock |
|---|---|---|---|---|
| One file to many devices without hammering the sender | no (1:1) | yes | no (messages) | n/a |
| Works with no internet at all | LAN only, no groups | needs trackers/DHT | yes | **no** |
| Room-level encryption, signed manifests, per-chunk integrity | partial | integrity only | messages only | n/a |
| Members, roles, key rotation on removal | no | no | partial | n/a |
| Messaging, announcements, Q&A in the same tool | no | no | yes | n/a |
| **Pre-distribute now, open for everyone at a chosen moment** | no | no | no | yes, but needs internet |
| **Signed evidence that each device holds the full verified file** | no | no | no | no |

In the sources I reviewed I did not find a browser-based, installable system that combines swarm distribution, room encryption and offline operation **with time-gated release and per-device signed delivery receipts**. That combination is Crowdwave's contribution.

## 3. What Crowdwave adds

1. **Embargoed drops (pre-warm, then unlock).** A file is encrypted with its own random key, spread through the swarm ahead of time, and the author later releases the key as a signed, room-encrypted message. Until then nobody else, including the Campus Node, can read it. At release there is no download rush: opening costs one tiny gossip message (about 0.2 s p95 in simulation). Use cases: exam papers, lab material at a start signal, announcements of results, fest schedules, relief-camp instructions.
   *Design choice:* release is by the author's key message (works offline) rather than a cryptographic clock like tlock (needs internet). The trade-off is stated in the threat model: the author must be reachable at release time or press release later, and a dishonest author can release early.
2. **Signed delivery receipts and a live coverage dashboard.** Each device that finishes and verifies a file posts a signed receipt bound to the file's Merkle root. The owner, moderators and author see "38 of 41 devices ready", who is missing, and can export CSV. Before an embargo ends this answers "is the room ready?"; after a distribution it is evidence of delivery (attendance of material, aid instructions received).
   *Limit:* a receipt is the device's own signed claim, not proof of possession. A challenge-response proof of retrievability is the natural next step.
3. **Uplink-saved meter and modern touches.** Each file shows what share of bytes came from nearby devices, the swarm map animates actual data flow, screen wake-lock keeps transfers alive on phones, plus dark mode and an install prompt.

## 4. Threats to validity of the novelty claim
- A search-engine review can miss papers and small projects; the claim is "not found", not "does not exist".
- Several sources are project READMEs or summaries, not peer-reviewed evidence.
- The performance numbers are from a fluid-model simulation that reuses the real scheduler; real radios, contention and mobile browsers will differ. Confirm with a 20-device trial.

## 5. Suggested searches to extend the review
`"BitTorrent" "rarest first" piece selection evaluation` · `multi-armed bandit peer selection peer-to-peer streaming` · `WebRTC peer-to-peer content delivery network` · `delay-tolerant networking classroom` · `timed-release encryption` · `epidemic broadcast trees Plumtree` · `secure scuttlebutt gossip` · `offline-first file distribution disaster response` · `verifiable delivery receipts`.

## 6. References
1. Snapdrop FAQ (mirror of README), https://git.nixc.us/MirrorMirror/PairDrop/src/commit/1bce467a7ce48d32aff53350c6482ab411efea66
2. PairDrop, https://github.com/schlagmichdoch/Pairdrop
3. WebTorrent (README via mirror), https://github.com/Mu-L/webtorrent ; official repository: github.com/webtorrent/webtorrent
4. Albrecht, Blasco, Jensen, Mareková. *Mesh Messaging in Large-scale Protests: Breaking Bridgefy*. CT-RSA 2021. https://eprint.iacr.org/2021/214
5. Albrecht, Eikenberg, Paterson. *Breaking Bridgefy, again: Adopting libsignal is not enough*. USENIX Security 2022. https://www.usenix.org/conference/usenixsecurity22/presentation/albrecht
6. Amigo: secure group mesh messaging in realistic protest settings (CCS 2025), seen only via a secondary summary: https://corpus.lantern.io/findings/2025-inyangson-amigo__prior-mesh-apps-fail-realistic-conditions/ (verify against the paper)
7. Briar Project, https://briarproject.org
8. Legout, Urvoy-Keller, Michiardi. *Rarest First and Choke Algorithms Are Enough*. IMC 2006. https://arxiv.org/abs/cs/0609026
9. Demers et al. *Epidemic Algorithms for Replicated Database Maintenance*. PODC 1987 (Xerox PARC CSL-89-1). https://ftp.mirrorservice.org/sites/www.bitsavers.org/pdf/xerox/parc/techReports/CSL-89-1_Epidemic_Algorithms_for_Replicated_Database_Maintenance.pdf
10. Gailly, Melissaris, Romailler. *tlock: Practical Timelock Encryption from Threshold BLS*. 2023. https://ia.cr/2023/189 ; drand blog: https://drand.love/blog/2023/03/28/timelock-on-fastnet
11. Rivest, Shamir, Wagner. *Time-lock puzzles and timed-release crypto*. 1996 (cited within [10]).
