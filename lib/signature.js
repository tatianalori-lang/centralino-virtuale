import crypto from 'node:crypto';
import { config } from './config.js';

export function requestBaseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;

  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim();

  return `${proto}://${host}`;
}

export function absoluteUrl(req) {
  return `${requestBaseUrl(req)}${req.originalUrl}`;
}

/**
 * Verifica la firma X-Twilio-Signature.
 * Se VALIDATE_TWILIO_SIGNATURE=false o manca l'Auth Token, lascia passare.
 */
export function validateTwilioRequest(req, res, next) {
  if (!config.twilio.validateSignature || !config.twilio.authToken) return next();

  const signature = req.get('X-Twilio-Signature');
  if (!signature) {
    return res.status(403).type('text/plain').send('Firma Twilio mancante');
  }

  const url = absoluteUrl(req);
  const params = req.body || {};

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const raw = params[key];
      const value = Array.isArray(raw) ? raw.join('') : raw;
      return acc + key + value;
    }, url);

  const expected = crypto
    .createHmac('sha1', config.twilio.authToken)
    .update(Buffer.from(payload, 'utf8'))
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(signature));

  const valid =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

  if (!valid) {
    console.warn('Firma Twilio non valida per', url);
    return res.status(403).type('text/plain').send('Firma Twilio non valida');
  }

  return next();
}
