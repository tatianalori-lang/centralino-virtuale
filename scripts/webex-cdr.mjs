// Legge lo "Storico chiamate dettagliato" di Webex Calling (CDR) per
// recuperare il numero del CHIAMANTE ORIGINALE, che la deviazione TIM perde
// prima di arrivare al nostro centralino.
//
// Uso (token di prova, valido 12 h):
//   WEBEX_TOKEN=... node scripts/webex-cdr.mjs
// Oppure: imposta WEBEX_TOKEN nel .env del VPS.
//
// Serve un token con scope spark-admin:calling_cdr_read e il ruolo
// "Webex Calling Detailed Call History API access" abilitato in Control Hub.

import 'dotenv/config';

const token = String(process.env.WEBEX_TOKEN || '').trim();
if (!token) {
  console.error('WEBEX_TOKEN mancante: impostalo nel .env o come variabile d\'ambiente.');
  process.exit(1);
}

const ore = Number(process.argv[2] || 24);
const end = new Date();
const start = new Date(end.getTime() - ore * 60 * 60 * 1000);

const url = new URL('https://analytics.webexapis.com/v1/cdr_feed');
url.searchParams.set('startTime', start.toISOString());
url.searchParams.set('endTime', end.toISOString());

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
});
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = {}; }

console.log('HTTP', res.status);
if (!res.ok) {
  console.log('Risposta:', text.slice(0, 600));
  console.log('\nSe 401/403: il token è scaduto, non ha lo scope');
  console.log('spark-admin:calling_cdr_read, oppure l\'utente non è amministratore');
  console.log('con il ruolo "Webex Calling Detailed Call History API access".');
  process.exit(1);
}

const items = Array.isArray(body.items) ? body.items : (Array.isArray(body) ? body : []);
console.log('record trovati:', items.length);
if (items.length) {
  console.log('campi del primo record:', Object.keys(items[0]).join(', '));
}

// I nomi dei campi possono avere spazi o essere in snake_case.
const pick = (row, ...names) => {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  }
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ''), v])
  );
  for (const name of names) {
    const key = name.toLowerCase().replace(/[\s_-]/g, '');
    if (lower[key] !== undefined && lower[key] !== null && lower[key] !== '') return lower[key];
  }
  return '';
};

console.log('\n--- chiamate in ingresso sulla linea TIM ---');
for (const row of items) {
  const called = String(pick(row, 'Called line ID', 'calledNumber', 'called', 'destinationNumber'));
  const caller = String(pick(row, 'Calling line ID', 'callingNumber', 'calling', 'originNumber'));
  const when = String(pick(row, 'Start time', 'startTime', 'start'));
  // Ci interessano le chiamate ricevute dal numero storico 067821202.
  if (!/067821202|39067821202/.test(called)) continue;
  console.log(`${when} | chiamante=${caller} | chiamato=${called}`);
}

console.log('\n--- prime 3 righe grezze (per diagnosi) ---');
for (const row of items.slice(0, 3)) console.log(JSON.stringify(row).slice(0, 700));
