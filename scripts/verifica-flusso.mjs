import {
  ORDER,
  getStep,
  handleAnswer,
  DEFAULT_TICKET_PRIORITY
} from '../lib/flow.js';
import {
  buildTicketData,
  buildInterruptedTicketData,
  buildTransferTicketData,
  createSession,
  isDialAnswered,
  renderDialResult,
  renderDialVoip,
  renderDialVoipFirst,
  renderDirectForward,
  renderFinal,
  startAbandonedCallWatcher
} from '../lib/ivr.js';
import { resolveCallerNumber } from '../lib/callerId.js';
import { config, twilioStatus } from '../lib/config.js';
import {
  scegliTipoTecnico,
  scegliStatoTecnico,
  buildRichiesta
} from '../lib/interventi.js';
import { computeDesiredMode } from '../lib/schedule.js';
import * as store from '../lib/store.js';

let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' -> ' + extra : ''}`);
  if (!ok) fail += 1;
};

check('ORDER senza urgency', !ORDER.includes('urgency'), ORDER.join(','));
check('priorità predefinita', DEFAULT_TICKET_PRIORITY === 'media');
check('zero squilli forzato', config.dialTimeoutSeconds === 0, String(config.dialTimeoutSeconds));
const addressPrompt = getStep('address').prompt;
check('prompt indirizzo senza "postale"', !/postale/.test(addressPrompt), addressPrompt);
check(
  'prompt indirizzo senza specifiche',
  !/con via|numero civico|città/i.test(addressPrompt),
  addressPrompt
);

// Percorso completo del dialogo.
const reply = {
  reason: 'assistenza tecnica',
  product: 'la bilancia del banco',
  issue: 'il display non si accende',
  name: 'Maria Rossi',
  company: 'Bar Centrale',
  address: 'Via Roma 1, Roma'
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
check('nessun passo conferma', !visited.includes('confirm'), visited.join(' -> '));
check('dialogo completato senza conferma', step === 'done');
check('nessun campo urgency nelle risposte', !('urgency' in answers), JSON.stringify(answers));

// Percorso non tecnico: salta product, ma chiede "richiesta" (issue) senza parlare di problema.
{
  let sId = 'reason';
  let ans = { phone: '+393331234567' };
  const visitedNonTech = [];
  const nonTechReply = {
    reason: 'informazioni commerciali',
    issue: 'Vorrei un preventivo per una bilancia',
    name: 'Mario Bianchi',
    company: 'Negozio Test',
    address: 'Via Milano 2'
  };
  for (let i = 0; i < 10 && sId !== 'done'; i += 1) {
    visitedNonTech.push(sId);
    const out = handleAnswer(sId, ans, '', { speech: nonTechReply[sId] || 'salta' }, 0);
    ans = out.answers;
    sId = out.outcome === 'done' ? 'done' : out.nextStep;
  }
  const nonTechIssuePrompt = getStep('issue', { reason: 'Informazioni commerciali' }).prompt;
  const techIssuePrompt = getStep('issue', { reason: 'Assistenza tecnica' }).prompt;
  check(
    'non tecnico salta solo product e chiede richiesta',
    visitedNonTech.join(',') === 'reason,issue,name,company,address' &&
      /richiesta/i.test(nonTechIssuePrompt) &&
      !/problema/i.test(nonTechIssuePrompt) &&
      /problematica/i.test(techIssuePrompt),
    `${visitedNonTech.join(' -> ')} | ${nonTechIssuePrompt}`
  );
}

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
  [
    'DID MessageNet non usato come chiamante',
    {
      From: own,
      'SipHeader_X-MTI-Caller': '+39067821202',
      'SipHeader_X-MTI-Did': '5406639544'
    },
    ''
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
// Il numero NON viene chiesto: si usa solo il caller ID passato dalla rete.
check('nessun passo phone nel flusso', !ORDER.includes('phone'), ORDER.join(' -> '));

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

// VoIP SIP transfer & dial result
check('isDialAnswered completed', isDialAnswered('completed') === true);
check('isDialAnswered no-answer', isDialAnswered('no-answer') === false);
check('renderDialResult completed -> Hangup', /<Hangup\/>/.test(renderDialResult('completed')) && !/<Say/.test(renderDialResult('completed')));
check('renderDialResult no-answer -> Say + Hangup', /<Say/.test(renderDialResult('no-answer')));
{
  const finalXml = renderFinal({ ticketId: 'TK-20261126-0001' });
  check(
    'renderFinal chiude subito senza operatore/WhatsApp',
    !/operatore|whatsapp/i.test(finalXml) && /<Hangup\/>/.test(finalXml),
    finalXml
  );
}
{
  const prev = { ...config.voip };
  config.voip.transferEnabled = true;
  config.voip.sipUri = 'sip:100@91.99.150.162:5060';
  config.voip.sipUser = 'twilio-bridge';
  config.voip.sipPassword = 'secret';
  config.voip.bridgeToken = 'tok123';
  const sipXml = renderDialVoip({
    callerPhone: '+393480025630',
    baseUrl: 'https://centralino.mtitaliaretail.com',
    extension: '101'
  });
  check('renderDialVoip contiene <Sip>', /<Sip /.test(sipXml) && /sip:101@91\.99\.150\.162:5060/.test(sipXml), sipXml);
  check('renderDialVoip passa X-MTI-Bridge e X-MTI-Caller', /X-MTI-Bridge=tok123/.test(sipXml) && /X-MTI-Caller=%2B393480025630/.test(sipXml));
  const firstXml = renderDialVoipFirst({
    callerPhone: '+393480025630',
    baseUrl: 'https://centralino.mtitaliaretail.com'
  });
  check('renderDialVoipFirst usa /voice/voip-fallback senza Say', /\/twilio\/voice\/voip-fallback/.test(firstXml) && !/<Say/.test(firstXml));
  config.voip.externalForwardEnabled = true;
  const timXml = renderDirectForward(
    '067821202',
    '+17089052752',
    'https://centralino.mtitaliaretail.com',
    '/twilio',
    '+393480025630'
  );
  check(
    'renderDirectForward verso 067821202 usa Dial PSTN senza Say',
    />\+39067821202<\/Dial>/.test(timXml) && !/<Sip/.test(timXml) && !/<Say/.test(timXml),
    timXml
  );
  const voipDirectXml = renderDirectForward(
    '100',
    '+17089052752',
    'https://centralino.mtitaliaretail.com',
    '/twilio',
    '+393480025630'
  );
  check(
    'renderDirectForward verso 100 usa Sip Asterisk senza Say',
    /<Sip /.test(voipDirectXml) && /sip:100@91\.99\.150\.162:5060/.test(voipDirectXml) && !/<Say/.test(voipDirectXml)
  );
  const voip103Xml = renderDirectForward(
    '103',
    '+17089052752',
    'https://centralino.mtitaliaretail.com',
    '/twilio',
    '+393480025630'
  );
  check(
    'renderDirectForward verso 103 usa Sip Asterisk senza Say',
    /<Sip /.test(voip103Xml) && /sip:103@91\.99\.150\.162:5060/.test(voip103Xml) && !/<Say/.test(voip103Xml)
  );
  {
    const prevTw = { ...config.twilio };
    const prevUrl = config.publicBaseUrl;
    config.twilio.accountSid = 'ACtest';
    config.twilio.authToken = 'toktest';
    config.twilio.phoneNumber = '';
    config.publicBaseUrl = 'https://centralino.mtitaliaretail.com';
    const st = twilioStatus();
    check('twilioStatus ready anche senza numero USA se SIP VoIP attivo', st.ready === true && st.sipDomainMode === true, JSON.stringify(st));
    Object.assign(config.twilio, prevTw);
    config.publicBaseUrl = prevUrl;
  }
  Object.assign(config.voip, prev);
}

// Programmazione oraria: fasce giornaliere, notturne (nextDay) e weekend (endDayOffset)
{
  const sched = {
    enabled: true,
    timezone: 'Europe/Rome',
    defaultMode: 'virtuale',
    slots: [
      { days: [1, 2, 3, 4, 5], start: '13:00', end: '14:30', mode: 'inoltro' },
      { days: [1, 2, 3, 4, 5], start: '17:00', end: '08:30', mode: 'inoltro', nextDay: true },
      { days: [6], start: '13:00', end: '08:30', mode: 'inoltro', endDayOffset: 2 }
    ]
  };
  check('schedule lun 14:05 -> inoltro', computeDesiredMode(sched, new Date('2026-11-23T13:05:00Z')) === 'inoltro');
  check('schedule lun 15:00 -> virtuale (fuori fascia)', computeDesiredMode(sched, new Date('2026-11-23T14:00:00Z')) === 'virtuale');
  check('schedule mar 07:00 -> inoltro (notte lun->mar)', computeDesiredMode(sched, new Date('2026-11-24T06:00:00Z')) === 'inoltro');
  check('schedule dom 12:00 -> inoltro (weekend sab->lun)', computeDesiredMode(sched, new Date('2026-11-29T11:00:00Z')) === 'inoltro');

  const officeSched = {
    enabled: true,
    timezone: 'Europe/Rome',
    defaultMode: 'inoltro',
    slots: [
      { days: [1, 2, 3, 4, 5], start: '13:00', end: '14:30', mode: 'virtuale' },
      { days: [1, 2, 3, 4, 5], start: '17:00', end: '08:30', mode: 'virtuale', nextDay: true },
      { days: [6], start: '13:00', end: '08:30', mode: 'virtuale', endDayOffset: 2 }
    ]
  };
  check('schedule ufficio mer 08:29 -> virtuale', computeDesiredMode(officeSched, new Date('2026-11-25T07:29:00Z')) === 'virtuale');
  check('schedule ufficio mer 08:30 -> inoltro', computeDesiredMode(officeSched, new Date('2026-11-25T07:30:00Z')) === 'inoltro');
  check('schedule ufficio mer 13:00 -> virtuale', computeDesiredMode(officeSched, new Date('2026-11-25T12:00:00Z')) === 'virtuale');
  check('schedule ufficio mer 14:30 -> inoltro', computeDesiredMode(officeSched, new Date('2026-11-25T13:30:00Z')) === 'inoltro');
  check('schedule ufficio mer 17:00 -> virtuale', computeDesiredMode(officeSched, new Date('2026-11-25T16:00:00Z')) === 'virtuale');
}

// Blacklist: blocco numeri in ingresso
{
  const testNum = '+390699988777';
  const added = await store.addBlockedNumber({ number: testNum, note: 'Test spam' });
  check('blacklist: aggiunto numero', Boolean(added.id));
  check('blacklist: match E.164', store.isNumberBlocked('+390699988777') === true);
  check('blacklist: match nazionale', store.isNumberBlocked('0699988777') === true);
  check('blacklist: match 0039', store.isNumberBlocked('00390699988777') === true);
  check('blacklist: altro numero non bloccato', store.isNumberBlocked('+390611122333') === false);
  let ownRejected = false;
  try {
    await store.addBlockedNumber({ number: '067821202' });
  } catch {
    ownRejected = true;
  }
  check('blacklist: rifiuta numero del centralino', ownRejected === true);
  await store.removeBlockedNumber(added.id);
  check('blacklist: rimosso numero test', store.isNumberBlocked(testNum) === false);
}

// Rubrica: creazione manuale, importazione CSV MessageNet, vCard, lookup & XML Yealink
{
  const created = await store.createContact({
    name: 'Test Rubrica',
    company: 'SRL Test',
    phone: '+39 06 5554433',
    email: 'test@example.com'
  });
  check('rubrica: contatto creato', Boolean(created.id));
  check('rubrica: lookup per numero nazionale', store.findContactByPhone('065554433')?.id === created.id);
  check('rubrica: lookup per numero 0039', store.findContactByPhone('0039065554433')?.id === created.id);

  const csvRes = await store.importContacts({
    text: 'Nome;Telefono;Azienda\nMario Verdi;+393339988776;Pizzeria Roma\nTest Rubrica;065554433;SRL Aggiornata',
    source: 'messagenet'
  });
  check('rubrica: import CSV MessageNet (1 nuovo, 1 aggiornato)', csvRes.imported === 1 && csvRes.updated === 1, JSON.stringify(csvRes));

  const vcfRes = await store.importContacts({
    text: 'BEGIN:VCARD\nFN:Laura Neri\nORG:Bar Neri\nTEL;TYPE=CELL:+393471122334\nEND:VCARD',
    format: 'vcf'
  });
  check('rubrica: import vCard (.vcf)', vcfRes.imported === 1);

  const mnWebRes = await store.importContacts({
    text: '  Test MN Web\n  +39 3390001112 (CEL)\n Invia SMS\n Modifica contatto\n Cancella contatto\nMESSAGENET\n© 2026 MessageNet S.p.A.',
    source: 'messagenet'
  });
  check('rubrica: import copia-incolla web MessageNet', mnWebRes.imported === 1 && store.findContactByPhone('3390001112')?.name === 'Test MN Web');

  const osmRes = await store.importOsmContacts([
    { id: 1, ragione_sociale: 'Bar OSM Test', telefono: '0611223344', email: 'osm@example.com' },
    { id: 2, ragione_sociale: 'Senza Numero', telefono: '' }
  ]);
  check('rubrica: import clienti OSM', osmRes.imported === 1 && store.findContactByPhone('0611223344')?.source === 'osm');

  const xmlDir = store.contactsToYealinkXml(store.listContacts({ q: 'Mario Verdi' }));
  check('rubrica: export XML Yealink valido', /<YealinkIPPhoneDirectory>/.test(xmlDir) && /Mario Verdi \(Pizzeria Roma\)/.test(xmlDir));

  for (const q of ['Test Rubrica', 'Mario Verdi', 'Laura Neri', 'Test MN Web', 'Bar OSM Test']) {
    for (const c of store.listContacts({ q })) {
      await store.deleteContact(c.id);
    }
  }
  check('rubrica: pulizia contatti test', store.findContactByPhone('065554433') === null);
}

console.log(fail === 0 ? '\nTUTTO OK' : `\n${fail} ERRORI`);
process.exit(fail === 0 ? 0 : 1);
