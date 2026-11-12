import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../lib/config.js';

// Monitor approvazione numero italiano Telnyx.
// Gira 24/7 sul VPS: controlla l'ordine ogni 10 minuti e invia una email
// non appena lo stato cambia (approvazione, rifiuto o commento dello staff).

const ORDER_ID = '1bb70f5d-c9a2-45d9-a99a-5eb771c2046a';
const SUB_ORDER_ID = '1980ed7b-4b55-4a2d-ab95-d05b49644017';
const NUMBER_ID = config.telnyx.numberId || '3089365998344602948';
const GROUP_ID = config.telnyx.requirementGroupId || 'a3e80b38-127e-40e6-b0bd-6519fde3d102';
const NUMBER = '+390698237118';

const STATE_FILE = process.env.TELNYX_MONITOR_STATE_FILE
  || path.join(ROOT_DIR, 'data', 'telnyx-monitor-state.json');
const INTERVAL_MS = Math.max(60000, Number(process.env.TELNYX_MONITOR_INTERVAL_MS || 10 * 60 * 1000));
const RECIPIENTS = process.env.TELNYX_MONITOR_MAIL_TO
  || [config.mail.to, 'tatianalori@mtitaliaretail.com'].filter(Boolean).join(', ');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TEST_EMAIL = args.includes('--test-email');
const ONCE = args.includes('--once');

const mail = config.mail;
const transporter = nodemailer.createTransport({
  host: mail.host,
  port: mail.port,
  secure: mail.secure,
  auth: { user: mail.user, pass: mail.pass },
  tls: { minVersion: 'TLSv1.2' },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

async function telnyx(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.telnyx.com/v2' + endpoint, {
      headers: { Authorization: `Bearer ${config.telnyx.apiKey}`, Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} su ${endpoint}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function snapshot() {
  if (!config.telnyx.apiKey) throw new Error('TELNYX_API_KEY mancante nella configurazione');
  const [order, phone, group, comments] = await Promise.all([
    telnyx(`/number_orders/${ORDER_ID}`),
    telnyx(`/phone_numbers/${NUMBER_ID}`),
    telnyx(`/requirement_groups/${GROUP_ID}`),
    telnyx(`/comments?filter[comment_record_id]=${SUB_ORDER_ID}&filter[comment_record_type]=sub_number_order&page[size]=50`)
  ]);
  const d = order.data || {};
  const pn = (d.phone_numbers || [])[0] || {};
  const reqs = pn.regulatory_requirements || [];
  const admin = (comments.data || []).filter(c => c.commenter_type === 'admin');
  const lastAdmin = admin.length ? admin[admin.length - 1] : null;
  return {
    orderStatus: d.status || '?',
    requirementsMet: d.requirements_met === true,
    phoneStatus: phone.data?.status || '?',
    reqStatus: pn.requirements_status || '?',
    groupStatus: group.data?.status || '?',
    filled: reqs.filter(q => q.field_value).length,
    total: reqs.length,
    pending: reqs.filter(q => q.status === 'pending-approval').length,
    approvedReqs: reqs.filter(q => /approved/i.test(q.status || '')).length,
    rejectedReqs: reqs.filter(q => /reject|denied|declin/i.test(q.status || '')).length,
    adminComments: admin.length,
    lastAdminAt: lastAdmin?.created_at || null,
    lastAdminText: lastAdmin ? String(lastAdmin.body || '').slice(0, 500) : null,
    updatedAt: d.updated_at || null
  };
}

function signature(s) {
  return [
    s.orderStatus, s.requirementsMet, s.phoneStatus, s.reqStatus, s.groupStatus,
    s.filled, s.total, s.pending, s.approvedReqs, s.rejectedReqs,
    s.adminComments, s.updatedAt
  ].join('|');
}

function isActive(s) {
  return /^(success|complete|completed|active)$/i.test(s.orderStatus)
    || /^active$/i.test(s.phoneStatus);
}

function describe(s) {
  return [
    `Ordine:            ${s.orderStatus} (requirements_met: ${s.requirementsMet})`,
    `Numero:            ${s.phoneStatus} / ${s.reqStatus}`,
    `Requisiti:         ${s.filled}/${s.total} compilati, ${s.pending} pending-approval, ${s.approvedReqs} approvati, ${s.rejectedReqs} respinti`,
    `Requirement group: ${s.groupStatus}`,
    `Commenti staff:    ${s.adminComments}${s.lastAdminAt ? ' (ultimo: ' + s.lastAdminAt + ')' : ''}`,
    `Aggiornato il:     ${s.updatedAt || 'n/d'}`
  ].join('\n');
}

function verdict(s) {
  if (isActive(s)) {
    return `NUMERO ATTIVO: chiama ${NUMBER} (o 0698237118). Il centralino deve rispondere con "Buongiorno MT Italia".`;
  }
  return 'Stato ancora in attesa della review manuale di Telnyx Number Ops. Nessuna azione richiesta da parte nostra.';
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return null; }
}

function saveState(s, sig) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ signature: sig, snapshot: s, savedAt: new Date().toISOString() }, null, 2));
}

async function notify(subject, text) {
  const info = await transporter.sendMail({
    from: mail.from || mail.user,
    to: RECIPIENTS,
    subject,
    text
  });
  console.log(`[${new Date().toISOString()}] email inviata: ${subject} -> ${info.messageId}`);
}

function footer() {
  return [
    '',
    '---',
    `Numero:      ${NUMBER}`,
    `Order ID:    ${ORDER_ID}`,
    `Sub order:   ${SUB_ORDER_ID}`,
    `Dashboard:   ${config.publicBaseUrl || 'https://centralino.mtitaliaretail.com'}`,
    'Verifica:    npm run numero-telnyx -- stato',
    '',
    'Messaggio automatico del monitor Centralino Virtuale MT Italia (VPS Hetzner).'
  ].join('\n');
}

async function check() {
  let s;
  try {
    s = await snapshot();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] controllo fallito, riprovo al prossimo giro: ${err.message}`);
    return;
  }
  const sig = signature(s);
  const prev = loadState();

  if (!prev) {
    const text = [
      'Monitor automatico attivato correttamente sul VPS.',
      `Controllo ogni ${Math.round(INTERVAL_MS / 60000)} minuti. Riceverai una email non appena lo stato cambia.`,
      '',
      'STATO ATTUALE',
      describe(s),
      '',
      verdict(s),
      footer()
    ].join('\n');
    try { await notify(`[Centralino] Monitor Telnyx attivo - ${NUMBER}`, text); }
    catch (err) { console.error('invio email fallito, riprovo al prossimo giro:', err.message); return; }
    saveState(s, sig);
    return;
  }

  if (prev.signature === sig) {
    console.log(`[${new Date().toISOString()}] nessun cambiamento (${s.orderStatus} / ${s.reqStatus})`);
    return;
  }

  const text = [
    'CAMBIO DI STATO rilevato sull\'ordine Telnyx.',
    '',
    'PRIMA',
    describe(prev.snapshot || {}),
    '',
    'ADESSO',
    describe(s),
    '',
    verdict(s),
    s.adminComments > (prev.snapshot?.adminComments || 0) && s.lastAdminText
      ? `\nULTIMO COMMENTO DELLO STAFF TELNYX:\n${s.lastAdminText}\n`
      : '',
    footer()
  ].join('\n');
  try { await notify(`[Centralino] Telnyx: CAMBIO DI STATO ${NUMBER}`, text); }
  catch (err) { console.error('invio email fallito, riprovo al prossimo giro:', err.message); return; }
  saveState(s, sig);
}

if (DRY_RUN) {
  const s = await snapshot();
  console.log(JSON.stringify(s, null, 2));
} else if (TEST_EMAIL) {
  await notify(`[Centralino] Test notifiche monitor Telnyx - ${NUMBER}`,
    'Test di notifica del monitor automatico. Se ricevi questo messaggio, SMTP e destinatari sono configurati correttamente.\n' + footer());
  console.log('Email di test inviata.');
} else {
  console.log(`Monitor Telnyx avviato | ogni ${Math.round(INTERVAL_MS / 60000)} min | destinatari: ${RECIPIENTS} | stato: ${STATE_FILE}`);
  await check();
  if (!ONCE) {
    setInterval(() => { check().catch(err => console.error('errore nel ciclo:', err.message)); }, INTERVAL_MS);
  }
}
