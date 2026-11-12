import { ORDER, getStep, handleAnswer, DEFAULT_TICKET_PRIORITY } from '../lib/flow.js';
import {
  buildTicketData,
  buildInterruptedTicketData,
  buildTransferTicketData,
  createSession,
  startAbandonedCallWatcher
} from '../lib/ivr.js';
import { resolveCallerNumber } from '../lib/callerId.js';
import {
  scegliTipoTecnico,
  scegliStatoTecnico,
  buildRichiesta
} from '../lib/interventi.js';
import * as store from '../lib/store.js';

let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' -> ' + extra : ''}`);
  if (!ok) fail += 1;
};

check('ORDER senza urgency', !ORDER.includes('urgency'), ORDER.join(','));
check('priorità predefinita', DEFAULT_TICKET_PRIORITY === 'media');

// Percorso completo del dialogo.
const reply = {
  reason: 'assistenza tecnica',
  product: 'la bilancia del banco',
  issue: 'il display non si accende',
  name: 'Maria Rossi',
  company: 'Bar Centrale',
  address: 'Via Roma 1, Roma',
  confirm: 'conferma'
};
let step = 'reason';
let answers = { phone: '+393331234567' };
const visited = [];
for (let i = 0; i < 20 && step !== 'done'; i += 1) {
  const s = getStep(step, answers);
  visited.push(s.id);
  const out = handleAnswer(step, answers, '', { speech: reply[step] || 'salta' }, 0);
  answers = out.answers;
  step = out.outcome === 'done' ? 'done' : out.nextStep;
}
check('nessun passo urgenza', !visited.includes('urgency'), visited.join(' -> '));
check('dialogo completato', step === 'done');
check('nessun campo urgency nelle risposte', !('urgency' in answers), JSON.stringify(answers));

const session = {
  callSid: 'CAtest',
  from: '+393331234567',
  to: 'sip:centralino@x',
  answers
};
for (const [label, data] of [
  ['buildTicketData', buildTicketData(session)],
  ['buildInterruptedTicketData', buildInterruptedTicketData(session)],
  ['buildTransferTicketData', buildTransferTicketData(session)]
]) {
  check(`${label}: priorità media`, data.priority === 'media', String(data.priority));
  check(`${label}: niente urgency`, !('urgency' in data));
  check(`${label}: telefono chiamante`, data.phone === '+393331234567', String(data.phone));
}

// Caller ID: il numero del centralino non deve mai finire nel ticket.
const own = 'sip:+39067821202@mtitalia-centralino.sip.twilio.com';
const cases = [
  ['solo numero centralino', { From: own, To: 'sip:centralino@x' }, ''],
  ['header X-MTI-Caller', { From: own, 'SipHeader_X-MTI-Caller': '+393480025630' }, '+393480025630'],
  ['header SIP con URI', { From: own, 'SipHeader_X-MTI-Caller': 'sip:+393480025630@x' }, '+393480025630'],
  [
    'History-Info con più URI (il primo è il centralino)',
    {
      From: own,
      'SipHeader_X-MTI-Caller': '+39067821202',
      'SipHeader_X-MTI-History':
        '<sip:+39067821202@x>;index=1, <sip:+393480025630@x>;index=2'
    },
    '+393480025630'
  ],
  ['From normale', { From: '+393331234567' }, '+393331234567'],
  ['nessun dato', { CallSid: 'CA1' }, '']
];
for (const [label, body, expected] of cases) {
  const got = resolveCallerNumber(body);
  check(`callerId: ${label}`, got === expected, `"${got}" (atteso "${expected}")`);
}

// Rete di sicurezza: ticket aperto anche senza callback di stato.
const idle = createSession({ callSid: 'CA-abbandonata', from: '+393331234567', to: 'x' });
let opened = 0;
const watcher = startAbandonedCallWatcher(
  (s) => {
    opened += 1;
    s.ticketId = 'TK-test';
  },
  { idleMs: 0, intervalMs: 10 }
);
await new Promise((r) => setTimeout(r, 60));
clearInterval(watcher);
check('watcher: sessione ferma apre il ticket', opened === 1, String(opened));

const withTicket = createSession({ callSid: 'CA-gia-fatto', from: '+393331234567', to: 'x' });
withTicket.ticketId = 'TK-esistente';
let duplicated = 0;
const watcher2 = startAbandonedCallWatcher(
  () => { duplicated += 1; },
  { idleMs: 0, intervalMs: 10 }
);
await new Promise((r) => setTimeout(r, 60));
clearInterval(watcher2);
check('watcher: nessun duplicato se il ticket esiste', duplicated === 0, String(duplicated));
check('store.completeTicket disponibile', typeof store.completeTicket === 'function');

// Scheda di intervento tecnico: tipo tecnico, stato aperto, mai PROMEMORIA.
const tipi = [
  { id: 1, descrizione: 'Settore tecnico' },
  { id: 2, descrizione: 'Settore commerciale' },
  { id: 3, descrizione: 'VERIFICAZIONE PERIODICA NAWI' },
  { id: 4, descrizione: 'Registro richieste attività di verificazione periodica' }
];
const stati = [
  { id: 2, descrizione: '1 DA PROGRAMMARE', completato: false },
  { id: 3, descrizione: 'FATTURATO', completato: true },
  { id: 9, descrizione: '8 PROMEMORIA', completato: false },
  { id: 10, descrizione: '4 IN MT', completato: false },
  { id: 13, descrizione: '3 CHIUSO', completato: true }
];
check('tipo tecnico scelto', scegliTipoTecnico(tipi, 2) === 1, String(scegliTipoTecnico(tipi, 2)));
check('stato DA PROGRAMMARE scelto', scegliStatoTecnico(stati, 9) === 2, String(scegliStatoTecnico(stati, 9)));
check(
  'PROMEMORIA mai scelto (anche se primo)',
  scegliStatoTecnico([{ id: 9, descrizione: '8 PROMEMORIA', completato: false }], 9) === null
);
check(
  'fallback PROMEMORIA rifiutato',
  scegliStatoTecnico([{ id: 9, descrizione: '8 PROMEMORIA', completato: false }], 9) !== 9
);
const scheda = buildRichiesta({
  id: 'TK-1', createdAt: '2026-11-12', priority: 'media',
  caller: { name: 'Maria Rossi', company: 'Bar Centrale', phone: '+393331234567', address: 'Via Roma 1' },
  reason: 'Assistenza tecnica', product: 'Bilancia', issue: 'Display rotto'
});
check('richiesta è una scheda di intervento tecnico', scheda.startsWith('SCHEDA DI INTERVENTO TECNICO'), scheda.split('\n')[0]);
check('scheda senza riga Urgenza', !/Urgenza:/.test(scheda));

console.log(fail === 0 ? '\nTUTTO OK' : `\n${fail} ERRORI`);
process.exit(fail === 0 ? 0 : 1);
