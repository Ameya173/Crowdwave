# Crowdwave threat model

**Assets:** file contents, message contents, room membership, the room key, the integrity of what recipients accept.
**Trust:** the owner's device and each member's device are trusted. The Campus Node, TURN server and the network are *not* trusted with content.

| Threat | Mitigation in this code |
|---|---|
| Peer sends corrupted chunks | Every ciphertext chunk is hashed and compared to the signed manifest leaf (`swarm.js _onChunk`). Failures lower the peer's bandit score; 5 failures bans the peer. |
| Forged or swapped manifest (chunk poisoning) | Manifest is signed by the author (ECDSA P-256) over every field, `transferId` is derived from the Merkle root + name + size + author, and the author must be an active member. Verified in `manifest.js verifyManifest` before any chunk is accepted. |
| Impersonation on signaling | Challenge-response at connect: client signs a server nonce with its key; `peerId` is the hash of the public key and is set by the server, never trusted from the client. |
| Impersonation of a person | 4×4-digit security code and device ID shown in People → Verify; invite links carry the owner's fingerprint (pinned on join). |
| Message tampering by relays | Messages are signed by the author; `msgId` = SHA-256 of the signed content; the body is AES-GCM encrypted with the room key, bound to room+channel as AAD. |
| Replay of old announcements | `expiresAt`, per-author per-channel `seq`, `msgId` dedup set, hop/TTL limit. |
| Non-moderator posts an announcement | Receivers check the author's role locally (`gossip.js verifyMessage`); the server relays but is not the authority. |
| Flooding / DoS on signaling | Token buckets per connection (messages/s and bytes/s), 256 KB frame cap, per-room member cap, rooms-per-owner cap, chunk size cap, 8 s auth timeout. |
| Curious Campus Node or TURN operator | Sees only ciphertext chunks and message ciphertext. Metadata is visible: who is in which room, when, file sizes and names in manifests, IP addresses. |
| Removed member reads new content | Removal rotates the room key (epoch+1), re-wrapped for each remaining member via ECDH+HKDF. |
| Ballot stuffing in Q&A | A vote carries `SHA-256(peerId:questionId)` and is only counted if it matches the signer's own peerId. One vote per device per question. |
| Unauthorised chunk download from the node | Every HTTP request carries a signature from an active member of the room that owns the transfer. Uploaded chunks are rejected unless their hash matches the manifest. |
| Member reads an embargoed file early | The file is encrypted with its own random key that exists only on the author's device until release; the room key cannot decrypt it, and the Campus Node never sees the key. |
| Forged or wrong "unlock" message | Honoured only if signed by the file's own author, naming that transfer, and (when chunk 0 is present) the key actually decrypts it. |
| Forged or inflated delivery receipt | Receipts are signed and counted only for active members whose Merkle root matches the manifest; one per device. |
| Receipt CSV used for spreadsheet formula injection | Cells starting with `= + - @` are neutralised on export. |

## Known limits (stated honestly)
- **Pseudonymous, not anonymous Q&A:** signatures identify a device key to the room owner.
- **Compromised device:** out of scope. The owner can remove the member and rotate the key, but a compromised device already holds past keys and files.
- **No forward secrecy for files:** a leaked room key decrypts every file of that epoch. People who join after a rotation cannot read older epochs.
- **Room keys are stored in IndexedDB** on each device (needed to re-wrap for new members); browser storage is as safe as the device.
- **Self-signed LAN certificates** require a one-time trust prompt; verify the owner fingerprint in person if the network is hostile.
- **Metadata** (membership, timing, sizes) is visible to the node operator.
- **Embargo is author-controlled, not a cryptographic clock.** The author can release early, and if the author's device is offline at the unlock time the file stays locked until they return or someone with the key is reachable. (A drand/tlock scheme would remove this trust but needs internet access.) The countdown shown on devices uses local clocks; enforcement is by key release, so clock skew cannot open a file early.
- **Receipts are self-attested.** They show that a device claims, with its signature, to hold the verified file; they are not proof of possession and device clocks are not trusted.
- **No global-observer anonymity**, no background mesh on phones (browser restriction).
