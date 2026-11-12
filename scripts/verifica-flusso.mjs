import { ORDER, getStep, handleAnswer, DEFAULT_TICKET_PRIORITY } from '../lib/flow.js';
import { buildTicketData, buildInterruptedTicketData, buildTransferTicketData } from '../lib/ivr.js';
import { resolveCallerNumber } from '../lib/callerId.js';

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
  ['From normale', { From: '+393331234567' }, '+393331234567'],
  ['nessun dato', { CallSid: 'CA1' }, '']
];
for (const [label, body, expected] of cases) {
  const got = resolveCallerNumber(body);
  check(`callerId: ${label}`, got === expected, `"${got}" (atteso "${expected}")`);
}

console.log(fail === 0 ? '\nTUTTO OK' : `\n${fail} ERRORI`);
process.exit(fail === 0 ? 0 : 1);
