import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

export function QrCode({ text, size = 220 }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) QRCode.toCanvas(ref.current, text, { width: size, margin: 1, errorCorrectionLevel: 'M' }).catch(() => {}); }, [text, size]);
  return <canvas ref={ref} className="qr" aria-label="QR code" />;
}
/** Camera scanner: BarcodeDetector when present, jsQR otherwise. */
export function QrScanner({ onResult, onClose }) {
  const video = useRef(); const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false, stream, raf;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream; await video.current.play();
        const det = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
          if (stop) return;
          const v = video.current;
          if (v && v.videoWidth) {
            let text = null;
            if (det) { try { text = (await det.detect(v))[0]?.rawValue; } catch { /* ignore */ } }
            else { cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0); text = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height)?.data; }
            if (text) { stop = true; onResult(text); return; }
          }
          raf = setTimeout(tick, 150);
        };
        tick();
      } catch (e) { setErr('Camera unavailable: ' + e.message + '. Paste the invite link instead.'); }
    })();
    return () => { stop = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return <div className="col">{err ? <div className="err">{err}</div> : <video ref={video} className="scan" playsInline muted />}<button className="btn ghost" onClick={onClose}>Close camera</button></div>;
}
