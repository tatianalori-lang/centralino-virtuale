import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Verifica la firma Ed25519 dei webhook Telnyx.
 * Ritorna true/false, oppure null se la chiave pubblica non è configurata.
 */
export function verifyTelnyxSignature(rawBody, timestamp, signature, publicKeyBase64 = config.telnyx.publicKey) {
  if (!publicKeyBase64) return null;
  try {
    const keyBytes = Buffer.from(String(publicKeyBase64).trim(), 'base64');
    if (keyBytes.length !== 32) return false;

    // Prefisso SPKI per una chiave Ed25519 (32 byte).
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      keyBytes
    ]);
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`, 'utf8'),
      key,
      Buffer.from(String(signature), 'base64')
    );
  } catch {
    return false;
  }
}

export function validateTelnyxRequest(req, res, next) {
  if (!config.telnyx.publicKey) return next();

  const timestamp = req.get('telnyx-timestamp');
  const signature = req.get('telnyx-signature-ed25519');
  const rawBody = req.rawBody || '';

  if (!timestamp || !signature) {
    return res.status(403).type('text/plain').send('Firma Telnyx mancante');
  }
  if (!verifyTelnyxSignature(rawBody, timestamp, signature)) {
    return res.status(403).type('text/plain').send('Firma Telnyx non valida');
  }
  return next();
}
