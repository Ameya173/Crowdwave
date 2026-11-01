import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import selfsigned from 'selfsigned';

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}
/** Uses data/certs/{key,cert}.pem when present (e.g. from mkcert); otherwise creates a self-signed cert covering localhost + LAN IPs. */
export async function loadOrCreateCert(dataDir) {
  const dir = path.join(dataDir, 'certs'), kf = path.join(dir, 'key.pem'), cf = path.join(dir, 'cert.pem');
  if (fs.existsSync(kf) && fs.existsSync(cf)) return { key: fs.readFileSync(kf), cert: fs.readFileSync(cf), generated: false };
  fs.mkdirSync(dir, { recursive: true });
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanAddresses().map((ip) => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Crowdwave Campus Node' }], {
    days: 825, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.writeFileSync(kf, pems.private); fs.writeFileSync(cf, pems.cert);
  return { key: pems.private, cert: pems.cert, generated: true };
}
