#!/usr/bin/env node

/**
 * Fallback per quando il PC viene spento.
 *
 * Il server e il tunnel girano sul PC: se lo spegni, il webhook Telnyx non è
 * raggiungibile e le chiamate si perdono. Questo comando devia il numero
 * italiano direttamente a un telefono reale, a livello di rete Telnyx
 * (funziona anche con il server spento).
 *
 * Uso:
 *   npm run pc-spento -- spento   # prima di spegnere il PC
 *   npm run pc-spento -- acceso   # quando riaccendi il PC
 *   npm run pc-spento -- stato    # situazione attuale
 */

import { config } from '../lib/config.js';

const apiKey = config.telnyx.apiKey;
const numberId = config.telnyx.numberId;
const command = process.argv[2] || 'stato';

if (!apiKey || !numberId) {
  console.error('Errore: TELNYX_API_KEY o TELNYX_NUMBER_ID mancanti in .env');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};
const url = `https://api.telnyx.com/v2/phone_numbers/${numberId}/voice`;

async function read() {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `${res.status}`);
  return data.data || data;
}

async function write(callForwarding) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ call_forwarding: callForwarding })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `${res.status}`);
  return data.data || data;
}

if (command === 'stato') {
  const v = await read();
  console.log('Numero:', v.phone_number);
  console.log('App TeXML:', v.connection_name || '(nessuna)');
  console.log('Inoltro attivo:', v.call_forwarding?.call_forwarding_enabled ? 'SÌ' : 'no');
  console.log('Destinazione inoltro:', v.call_forwarding?.forwards_to || '-');
} else if (command === 'spento') {
  const target = config.fallbackNumber;
  if (!target) {
    console.error('Errore: FALLBACK_PHONE_NUMBER mancante in .env');
    process.exit(1);
  }
  const v = await write({
    call_forwarding_enabled: true,
    forwards_to: target,
    forwarding_type: 'always'
  });
  console.log(`Inoltro attivato verso ${target}.`);
  console.log('Le chiamate al numero italiano squillano lì, senza IVR/ticket.');
  console.log('Al riavvio del PC esegui: npm run pc-spento -- acceso');
} else if (command === 'acceso') {
  await write({
    call_forwarding_enabled: false,
    forwards_to: '',
    forwarding_type: ''
  });
  const v = await read();
  console.log('Inoltro disattivato.');
  console.log('App TeXML attiva:', v.connection_name || '(nessuna)');
  console.log('Il centralino virtuale risponde di nuovo con l\'IVR.');
} else {
  console.error(`Comando sconosciuto: ${command}`);
  console.error('Usa: spento | acceso | stato');
  process.exit(1);
}
