#!/usr/bin/env node

/**
 * Collega al centralino virtuale tutti i numeri italiani (+39) presenti
 * sull'account Twilio (tipicamente dopo una portabilità da TIM).
 *
 * Uso: npm run numero-italiano
 */

import { config } from '../lib/config.js';

const { accountSid, authToken } = config.twilio;
const base = config.publicBaseUrl;

if (!accountSid || !authToken) {
  console.error('Errore: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN mancanti in .env');
  process.exit(1);
}
if (!base) {
  console.error('Errore: PUBLIC_BASE_URL mancante in .env');
  process.exit(1);
}

const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
const api = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;

async function twilioRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `${res.status} ${res.statusText}`);
  }
  return data;
}

const list = await twilioRequest(`${api}/IncomingPhoneNumbers.json?PageSize=100`);
const italian = (list.incoming_phone_numbers || []).filter((n) =>
  String(n.phone_number || '').startsWith('+39')
);

if (!italian.length) {
  console.log('Nessun numero italiano (+39) presente su Twilio.');
  console.log('');
  console.log('Per avere un numero italiano senza portabilità:');
  console.log('  • compra un numero +39 da Telnyx / Vonage / Messagenet');
  console.log('  • imposta l\'inoltro verso', config.twilio.phoneNumber || 'il numero Twilio');
  console.log('  • vedi docs/numero-italiano-nuovo.md');
  console.log('');
  console.log('In alternativa, porta la linea TIM su Twilio:');
  console.log('  • LOA in italiano datata entro 30 giorni');
  console.log('  • Codice Segreto rilasciato da TIM');
  console.log('  • Visura/P.IVA, indirizzo nella zona del prefisso, documento del legale rappresentante');
  console.log('  • Copia dell\'ultima fattura telefonica');
  console.log('  • Richiesta: https://twlo.my.salesforce-sites.com/InternationalPorting');
  console.log('  • Tempi: fino a 6 settimane');
  console.log('');
  console.log('Il centralino è comunque raggiungibile su', config.twilio.phoneNumber || 'numero Twilio');
  process.exit(0);
}

for (const number of italian) {
  const updated = await twilioRequest(
    `${api}/IncomingPhoneNumbers/${number.sid}.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        VoiceUrl: `${base}/twilio/voice`,
        VoiceMethod: 'POST',
        StatusCallback: `${base}/twilio/status`,
        StatusCallbackMethod: 'POST'
      }).toString()
    }
  );
  console.log(`${updated.phone_number} → webhook ${updated.voice_url}`);
}

console.log('');
console.log('Numero italiano collegato al centralino virtuale.');
console.log(`Aggiorna CENTRALINO_NUMBER in .env con ${italian[0].phone_number} se vuoi mostrarlo nella dashboard.`);
