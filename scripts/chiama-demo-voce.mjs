import { config } from '../lib/config.js';
import { demoPrompts } from '../lib/demoPrompts.js';

// Chiamata dimostrativa: riproduce i PROMPT REALI dell'IVR con la voce
// configurata. Nessuna frase introduttiva, nessuna descrizione della voce:
// il chiamante deve sentire esattamente ciò che sente un cliente.
// Con DEMO_REASON si può simulare un motivo diverso (la richiesta generica
// sul prodotto/servizio non compare).

const reason = process.env.DEMO_REASON || 'Assistenza tecnica';
const PROMPTS = demoPrompts(reason);

const to = process.argv[2] || process.env.DEMO_CALL_TO || '+393480025630';
const from = config.twilio.phoneNumber;
const voice = config.twilio.voice;
const language = config.twilio.language;

if (!config.twilio.accountSid || !config.twilio.authToken || !from) {
  console.error('Credenziali Twilio / numero mittente mancanti: controlla il file .env');
  process.exit(1);
}

const esc = (s) => s.replace(/[<>&'"]/g, (c) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
}[c]));

const parts = [];
for (const p of PROMPTS) {
  parts.push(`<Say language="${esc(language)}" voice="${esc(voice)}">${esc(p)}</Say>`);
  parts.push('<Pause length="1"/>');
}
parts.push('<Hangup/>');
const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>' + parts.join('') + '</Response>';

const auth = btoa(`${config.twilio.accountSid}:${config.twilio.authToken}`);
const res = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`,
  {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    // 15 s: poche chiamate demo non devono far squillare a lungo il telefono.
    body: new URLSearchParams({ From: from, To: to, Twiml: twiml, Timeout: '15' }).toString()
  }
);
const body = await res.json();

if (!res.ok || !body.sid) {
  console.error('Chiamata non avviata:', res.status, body.message || body.code || '');
  process.exit(1);
}

console.log(`Chiamata avviata verso ${to} (da ${from})`);
console.log(`CallSid: ${body.sid} | stato: ${body.status}`);
console.log('Prompt:', PROMPTS.length, '| voice:', voice);
