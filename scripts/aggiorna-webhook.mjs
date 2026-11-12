#!/usr/bin/env node

/**
 * Aggiorna i webhook voce di Telnyx (app TeXML) e Twilio (numero)
 * in base a PUBLIC_BASE_URL configurato in .env.
 *
 * Uso: npm run webhook
 */

import { config } from '../lib/config.js';

const base = config.publicBaseUrl;
if (!base) {
  console.error('Errore: PUBLIC_BASE_URL mancante in .env');
  process.exit(1);
}

const results = [];

// --- Telnyx (percorso principale, numero italiano) ---
if (config.telnyx.apiKey && config.telnyx.texmlAppId) {
  const voiceUrl = `${base}/telnyx/voice`;
  const res = await fetch(
    `https://api.telnyx.com/v2/texml_applications/${config.telnyx.texmlAppId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${config.telnyx.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        voice_url: voiceUrl,
        voice_fallback_url: voiceUrl,
        voice_method: 'POST',
        voice_fallback_method: 'POST'
      })
    }
  );
  const data = await res.json().catch(() => ({}));
  results.push({
    provider: 'Telnyx',
    ok: res.ok,
    detail: res.ok ? voiceUrl : (data?.errors?.[0]?.detail || `${res.status}`)
  });
} else {
  results.push({ provider: 'Telnyx', ok: false, detail: 'API key o app ID mancanti' });
}

// --- Twilio (fallback legacy) ---
if (config.twilio.accountSid && config.twilio.authToken && config.twilio.numberSid) {
  const voiceUrl = `${base}/twilio/voice`;
  const auth = Buffer.from(
    `${config.twilio.accountSid}:${config.twilio.authToken}`
  ).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/IncomingPhoneNumbers/${config.twilio.numberSid}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        VoiceUrl: voiceUrl,
        VoiceMethod: 'POST',
        StatusCallback: `${base}/twilio/status`,
        StatusCallbackMethod: 'POST'
      }).toString()
    }
  );
  const data = await res.json().catch(() => ({}));
  results.push({
    provider: 'Twilio',
    ok: res.ok,
    detail: res.ok ? voiceUrl : (data?.message || `${res.status}`)
  });
} else {
  results.push({ provider: 'Twilio', ok: false, detail: 'credenziali o SID numero mancanti' });
}

console.log(`PUBLIC_BASE_URL = ${base}`);
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'ERR '} ${r.provider}: ${r.detail}`);
}
if (results.some((r) => !r.ok)) process.exitCode = 1;
