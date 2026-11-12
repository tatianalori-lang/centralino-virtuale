import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../lib/config.js';
import { demoPrompts } from '../lib/demoPrompts.js';

// Genera un MP3 di prova con la STESSA voce usata dall'IVR.
// Nota: l'API TTS standalone usa il formato AWS.Polly.<VoiceId>, mentre
// TeXML/TwiML usa Polly.<VoiceId>. È la medesima voce Polly Bianca-Neural.

const voice = process.env.TTS_VOICE || 'AWS.Polly.Bianca-Neural';

// DEMO_REASON permette di generare il campione anche per gli altri motivi:
// in quel caso la richiesta generica sul prodotto/servizio non compare,
// come nell'IVR reale.
const reason = process.env.DEMO_REASON || 'Assistenza tecnica';
const text =
  process.argv[2] || process.env.TTS_TEXT || demoPrompts(reason).join('\n');
const outRel = process.env.TTS_OUTPUT || 'public/audio/demo-voce-femminile.mp3';
const outPath = path.resolve(ROOT_DIR, outRel);

if (!config.telnyx.apiKey) {
  console.error('TELNYX_API_KEY mancante: controlla il file .env');
  process.exit(1);
}

const res = await fetch('https://api.telnyx.com/v2/text-to-speech/speech', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${config.telnyx.apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    text,
    voice,
    output_type: 'base64_output',
    language: 'it-IT'
  })
});

const raw = await res.text();
let body;
try { body = JSON.parse(raw); } catch { body = {}; }

if (!res.ok || !body.base64_audio) {
  console.error('Errore TTS:', res.status, body.errors?.[0]?.detail || body.message || raw.slice(0, 300));
  process.exit(1);
}

const buffer = Buffer.from(body.base64_audio, 'base64');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buffer);

console.log('Voce:', voice);
console.log('File:', outPath, `(${buffer.length} byte)`);
if (config.publicBaseUrl) {
  console.log('URL: ', `${config.publicBaseUrl}/${outRel.replace(/^public\//, '')}`);
}
