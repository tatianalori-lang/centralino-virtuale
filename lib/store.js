import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import { isOwnNumber } from './callerId.js';
import { sendTicketEmail } from './mailer.js';
import {
  sendTicketWhatsApp,
  shouldNotifyEmail,
  shouldNotifyWhatsApp
} from './whatsapp.js';

const DATA_DIR = path.join(ROOT_DIR, 'data');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

let tickets = [];
let loaded = false;
let writeQueue = Promise.resolve();

let settings = { forwardEnabled: false, forwardNumber: '', voipStrategy: 'ivr_first' };
let settingsLoaded = false;
let settingsQueue = Promise.resolve();

let blacklist = [];
let blacklistLoaded = false;
let blacklistQueue = Promise.resolve();

let contacts = [];
let contactsLoaded = false;
let contactsQueue = Promise.resolve();

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(TICKETS_FILE)) {
      const raw = fs.readFileSync(TICKETS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      tickets = Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.error(`Impossibile leggere ${TICKETS_FILE}: ${err.message}`);
    tickets = [];
  }
}

function persist() {
  writeQueue = writeQueue
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${TICKETS_FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(tickets, null, 2), 'utf8');
      await fs.promises.rename(tmp, TICKETS_FILE);
    })
    .catch((err) => {
      console.error('Errore durante il salvataggio dei ticket:', err);
    });
  return writeQueue;
}

function ensureSettingsLoaded() {
  if (settingsLoaded) return;
  settingsLoaded = true;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      settings = {
        forwardEnabled: Boolean(parsed.forwardEnabled),
        forwardNumber: typeof parsed.forwardNumber === 'string' ? parsed.forwardNumber : '',
        voipStrategy: parsed.voipStrategy === 'voip_first' ? 'voip_first' : 'ivr_first'
      };
    }
  } catch (err) {
    console.error(`Impossibile leggere ${SETTINGS_FILE}: ${err.message}`);
  }
}

function persistSettings() {
  settingsQueue = settingsQueue
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${SETTINGS_FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
      await fs.promises.rename(tmp, SETTINGS_FILE);
    })
    .catch((err) => {
      console.error('Errore durante il salvataggio delle impostazioni:', err);
    });
  return settingsQueue;
}

export function getForwardSettings() {
  ensureSettingsLoaded();
  return {
    enabled: Boolean(settings.forwardEnabled),
    number: settings.forwardNumber || config.forwardNumber || '',
    centralinoNumber: config.centralinoNumber,
    voipStrategy: settings.voipStrategy === 'voip_first' ? 'voip_first' : 'ivr_first'
  };
}

export async function updateForwardSettings(patch = {}) {
  ensureSettingsLoaded();

  if (typeof patch.enabled === 'boolean') settings.forwardEnabled = patch.enabled;

  if (typeof patch.number === 'string') {
    settings.forwardNumber = patch.number.trim();
  }

  if (patch.voipStrategy === 'ivr_first' || patch.voipStrategy === 'voip_first') {
    settings.voipStrategy = patch.voipStrategy;
  }

  const current = getForwardSettings();
  if (current.enabled && !current.number) {
    const error = new Error(
      'Configura un numero di inoltro prima di attivare l’inoltro diretto.'
    );
    error.status = 400;
    throw error;
  }

  await persistSettings();
  return getForwardSettings();
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(date)
    .replaceAll('-', '');
}

function nextId() {
  const prefix = `TK-${dateKey(new Date())}-`;
  const max = tickets.reduce((current, ticket) => {
    if (!String(ticket.id || '').startsWith(prefix)) return current;
    const value = Number(ticket.id.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(current, value) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export function listTickets(filters = {}) {
  ensureLoaded();
  let result = [...tickets];

  const status = String(filters.status || '').trim();
  const reason = String(filters.reason || '').trim();
  const product = String(filters.product || '').trim();
  const query = String(filters.q || '').trim().toLowerCase();

  if (status) result = result.filter((t) => t.status === status);
  if (reason) result = result.filter((t) => t.reason === reason);
  if (product) result = result.filter((t) => t.product === product);

  if (query) {
    result = result.filter((t) => {
      const haystack = [
        t.id,
        t.caller?.name,
        t.caller?.company,
        t.caller?.address,
        t.caller?.email,
        t.caller?.phone,
        t.reason,
        t.product,
        t.issue,
        // `urgency` resta solo per i ticket storici: non viene più chiesta.
        t.urgency,
        t.call?.from,
        t.call?.sid
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getTicket(id) {
  ensureLoaded();
  return tickets.find((t) => t.id === id) || null;
}

export function getTicketByCallSid(callSid) {
  ensureLoaded();
  if (!callSid) return null;
  return tickets.find((t) => t.call?.sid === callSid) || null;
}

/**
 * Apertura automatica della chiamata su OSM.
 * Eseguita in background (NON attesa dal webhook): login e creazione su OSM
 * possono richiedere secondi e il chiamante non deve restare in silenzio.
 * Il cliente è risolto da apriIntervento (match esatto o fallback CENTRALINO).
 */
function shouldAutoOpenIntervento(ticket) {
  return (
    config.interventi.enabled &&
    config.interventi.autoOpen &&
    // Tutte le chiamate reali (IVR, richiesta operatore, inoltro diretto),
    // di qualunque motivo. Solo il simulatore resta escluso: non è una
    // chiamata e scriverebbe interventi fitti su OSM durante i test.
    ticket.source !== 'simulazione' &&
    !ticket.intervento?.id
  );
}

async function recordAutoIntervento(id, message) {
  ensureLoaded();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return;
  ticket.history.push({ at: new Date().toISOString(), event: message });
  await persist();
}

async function autoOpenIntervento(ticket) {
  try {
    const { apriIntervento } = await import('./interventi.js');
    const result = await apriIntervento(ticket);
    if (result.ok && result.intervento) {
      await setTicketIntervento(ticket.id, result.intervento);
      console.log(
        `[Interventi] ${ticket.id} -> aperto automaticamente ${result.intervento.codice || result.intervento.id}`
      );
    } else {
      await recordAutoIntervento(
        ticket.id,
        `Intervento non aperto: ${result.error || 'cliente non determinato'}`
      );
    }
  } catch (err) {
    console.error(`[Interventi] ${ticket.id}: ${err.message}`);
    await recordAutoIntervento(ticket.id, `Errore apertura intervento: ${err.message}`);
  }
}

export async function createTicket(data = {}) {
  ensureLoaded();
  const now = new Date().toISOString();
  const ticket = {
    id: nextId(),
    createdAt: now,
    updatedAt: now,
    status: 'nuovo',
    priority: data.priority || 'media',
    source: data.source || 'telefono',
    caller: {
      name: data.callerName || data.name || 'Non fornito',
      company: data.company || '',
      address: data.address || '',
      email: data.email || '',
      phone: data.phone || data.from || ''
    },
    reason: data.reason || '',
    product: data.product || '',
    issue: data.issue || '',
    call: data.call || {},
    assignee: '',
    notes: [],
    history: [
      { at: now, event: 'Ticket creato' },
      ...(data.interrupted
        ? [{ at: now, event: 'Chiamata interrotta: ticket aperto con i dati disponibili' }]
        : [])
    ]
  };

  tickets.unshift(ticket);
  await persist();

  if (shouldNotifyEmail()) {
    const mailResult = await sendTicketEmail(ticket);
    ticket.history.push({
      at: new Date().toISOString(),
      event: mailResult.sent
        ? `Email del ticket inviata a ${mailResult.to}`
        : `Email del ticket non inviata: ${mailResult.reason}`
    });
  }

  if (shouldNotifyWhatsApp()) {
    const waResult = await sendTicketWhatsApp(ticket);
    ticket.history.push({
      at: new Date().toISOString(),
      event: waResult.sent
        ? `WhatsApp del ticket inviato a ${waResult.to}`
        : `WhatsApp del ticket non inviato: ${waResult.reason}`
    });
  }

  await persist();

  // La chiamata si apre da sola su OSM, senza click e senza far attendere il
  // chiamante (il risultato viene salvato sul ticket in background).
  if (shouldAutoOpenIntervento(ticket)) {
    autoOpenIntervento(ticket).catch((err) =>
      console.error(`[Interventi] background ${ticket.id}: ${err.message}`)
    );
  }

  return ticket;
}

export async function updateTicket(id, patch = {}) {
  ensureLoaded();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;

  const now = new Date().toISOString();
  const events = [];

  if (patch.status && patch.status !== ticket.status) {
    ticket.status = patch.status;
    events.push(`Stato cambiato in "${patch.status}"`);
  }

  if (typeof patch.priority === 'string' && patch.priority !== ticket.priority) {
    ticket.priority = patch.priority;
    events.push(`Priorità cambiata in "${patch.priority}"`);
  }

  if (typeof patch.assignee === 'string' && patch.assignee !== ticket.assignee) {
    ticket.assignee = patch.assignee;
    events.push(patch.assignee ? `Assegnato a ${patch.assignee}` : 'Assegnazione rimossa');
  }

  if (patch.note && String(patch.note).trim()) {
    ticket.notes.push({
      at: now,
      author: patch.author || 'Operatore',
      text: String(patch.note).trim()
    });
    events.push('Nota aggiunta');
  }

  if (events.length) {
    ticket.updatedAt = now;
    for (const event of events) ticket.history.push({ at: now, event });
    await persist();
  }

  return ticket;
}

/**
 * Completa un ticket aperto per una chiamata non terminata con i dati raccolti
 * in seguito (es. il chiamante ha ripreso il dialogo dopo il timeout).
 * Non invia notifiche: sono già state inviate alla creazione del ticket.
 */
export async function completeTicket(id, data = {}) {
  ensureLoaded();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;

  const now = new Date().toISOString();
  ticket.caller = {
    name: data.callerName || data.name || ticket.caller?.name || 'Non fornito',
    company: data.company || ticket.caller?.company || '',
    address: data.address || ticket.caller?.address || '',
    email: data.email || ticket.caller?.email || '',
    phone: data.phone || data.from || ticket.caller?.phone || ''
  };
  if (data.reason) ticket.reason = data.reason;
  if (data.product !== undefined) ticket.product = data.product;
  if (data.issue) ticket.issue = data.issue;
  if (data.priority) ticket.priority = data.priority;
  ticket.updatedAt = now;
  ticket.history.push({
    at: now,
    event: 'Dati del chiamante completati dopo la ripresa della chiamata'
  });
  await persist();
  return ticket;
}

/** Collega un ticket all'intervento tecnico aperto su OSM. */
/** Aggiorna il telefono del chiamante su un ticket già creato (es. recuperato
 *  in seguito dal CDR Webex). Aggiunge una nota in cronologia. */
export async function updateCallerPhone(id, phone) {
  ensureLoaded();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;
  const cleaned = String(phone || '').trim();
  if (!cleaned) return ticket;
  if (ticket.caller?.phone === cleaned) return ticket;

  const now = new Date().toISOString();
  ticket.caller = { ...(ticket.caller || {}), phone: cleaned };
  if (ticket.call?.from === '' || !ticket.call?.from) {
    ticket.call = { ...(ticket.call || {}), from: cleaned };
  }
  ticket.updatedAt = now;
  ticket.history.push({
    at: now,
    event: `Numero del chiamante recuperato da Webex CDR: ${cleaned}`
  });
  await persist();
  return ticket;
}

export async function setTicketIntervento(id, intervento) {
  ensureLoaded();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;

  const now = new Date().toISOString();
  ticket.intervento = intervento;
  ticket.updatedAt = now;
  ticket.history.push({
    at: now,
    event: `Intervento tecnico aperto: ${intervento.codice || intervento.id}`
  });
  await persist();
  return ticket;
}

export async function deleteTicket(id) {
  ensureLoaded();
  const index = tickets.findIndex((t) => t.id === id);
  if (index < 0) return false;
  tickets.splice(index, 1);
  await persist();
  return true;
}

export function getStats() {
  ensureLoaded();
  const today = dateKey(new Date());
  const open = (t) => t.status !== 'chiuso';

  return {
    total: tickets.length,
    nuovo: tickets.filter((t) => t.status === 'nuovo').length,
    in_lavorazione: tickets.filter((t) => t.status === 'in_lavorazione').length,
    chiuso: tickets.filter((t) => t.status === 'chiuso').length,
    alta: tickets.filter((t) => t.priority === 'alta' && open(t)).length,
    oggi: tickets.filter((t) => dateKey(t.createdAt) === today).length
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  // Evita l'esecuzione di formule nei fogli di calcolo (CSV injection).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function ticketsToCsv(items) {
  const headers = [
    'ID',
    'Data',
    'Stato',
    'Priorità',
    'Nome',
    'Azienda',
    'Indirizzo',
    'Email',
    'Telefono',
    'Motivo',
    'Prodotto',
    'Urgenza', // colonna storica: i nuovi ticket non hanno più questo campo
    'Problematica',
    'Canale',
    'Operatore'
  ];

  const rows = items.map((t) => [
    t.id,
    t.createdAt,
    t.status,
    t.priority,
    t.caller?.name,
    t.caller?.company,
    t.caller?.address,
    t.caller?.email,
    t.caller?.phone,
    t.reason,
    t.product,
    t.urgency,
    t.issue,
    t.source,
    t.assignee
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------------------
// Blacklist (numeri bloccati)
// ---------------------------------------------------------------------------

function ensureBlacklistLoaded() {
  if (blacklistLoaded) return;
  blacklistLoaded = true;
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      const raw = fs.readFileSync(BLACKLIST_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      blacklist = Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.error(`Impossibile leggere ${BLACKLIST_FILE}: ${err.message}`);
    blacklist = [];
  }
}

function persistBlacklist() {
  blacklistQueue = blacklistQueue
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${BLACKLIST_FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(blacklist, null, 2), 'utf8');
      await fs.promises.rename(tmp, BLACKLIST_FILE);
    })
    .catch((err) => {
      console.error('Errore durante il salvataggio della blacklist:', err);
    });
  return blacklistQueue;
}

export function canonicalPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('39') && digits.length >= 10) digits = digits.slice(2);
  return digits;
}

export function listBlockedNumbers() {
  ensureBlacklistLoaded();
  return [...blacklist];
}

export function isNumberBlocked(phone) {
  const canon = canonicalPhone(phone);
  if (canon.length < 6) return false;
  ensureBlacklistLoaded();
  return blacklist.some((entry) => entry.canonical === canon);
}

export async function addBlockedNumber({ number, note = '' } = {}) {
  ensureBlacklistLoaded();
  const display = String(number || '').trim();
  const canon = canonicalPhone(display);
  if (canon.length < 6) {
    const error = new Error('Inserisci un numero di telefono valido (almeno 6 cifre).');
    error.status = 400;
    throw error;
  }
  if (isOwnNumber(display) || /^(100|101|102)$/.test(canon)) {
    const error = new Error('Non puoi bloccare un numero del centralino stesso.');
    error.status = 400;
    throw error;
  }

  const existing = blacklist.find((entry) => entry.canonical === canon);
  if (existing) {
    if (note && note.trim() && !existing.note) {
      existing.note = note.trim();
      await persistBlacklist();
    }
    return existing;
  }

  const item = {
    id: `BL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    number: display,
    canonical: canon,
    note: String(note || '').trim(),
    createdAt: new Date().toISOString()
  };
  blacklist.unshift(item);
  await persistBlacklist();
  return item;
}

export async function removeBlockedNumber(idOrNumber) {
  ensureBlacklistLoaded();
  const key = String(idOrNumber || '').trim();
  const canon = canonicalPhone(key);
  const index = blacklist.findIndex(
    (entry) => entry.id === key || (canon.length >= 6 && entry.canonical === canon)
  );
  if (index < 0) return false;
  blacklist.splice(index, 1);
  await persistBlacklist();
  return true;
}

// ---------------------------------------------------------------------------
// Rubrica contatti (manuale + importazione MessageNet / CSV / vCard)
// ---------------------------------------------------------------------------

function ensureContactsLoaded() {
  if (contactsLoaded) return;
  contactsLoaded = true;
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      const raw = fs.readFileSync(CONTACTS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      contacts = Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.error(`Impossibile leggere ${CONTACTS_FILE}: ${err.message}`);
    contacts = [];
  }
}

function persistContacts() {
  contactsQueue = contactsQueue
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${CONTACTS_FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(contacts, null, 2), 'utf8');
      await fs.promises.rename(tmp, CONTACTS_FILE);
    })
    .catch((err) => {
      console.error('Errore durante il salvataggio della rubrica:', err);
    });
  return contactsQueue;
}

function normalizeContactInput(raw = {}) {
  const name = String(raw.name || '').trim();
  const company = String(raw.company || '').trim();
  const phone = String(raw.phone || '').trim();
  const phone2 = String(raw.phone2 || '').trim();
  const email = String(raw.email || '').trim();
  const note = String(raw.note || '').trim();
  const source = String(raw.source || 'manuale').trim() || 'manuale';
  const phoneCanonical = canonicalPhone(phone);
  const phone2Canonical = canonicalPhone(phone2);
  return {
    name,
    company,
    phone,
    phoneCanonical,
    phone2,
    phone2Canonical,
    email,
    note,
    source
  };
}

export function listContacts(filters = {}) {
  ensureContactsLoaded();
  const q = String(filters.q || '').trim().toLowerCase();
  const qDigits = canonicalPhone(q);
  let result = [...contacts];

  if (q) {
    result = result.filter((c) => {
      const hay = [c.name, c.company, c.phone, c.phone2, c.email, c.note]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) return true;
      if (qDigits.length >= 3) {
        return (
          c.phoneCanonical?.includes(qDigits) || c.phone2Canonical?.includes(qDigits)
        );
      }
      return false;
    });
  }

  result.sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'it', { sensitivity: 'base' })
  );
  return result;
}

export function getContact(id) {
  ensureContactsLoaded();
  return contacts.find((c) => c.id === id) || null;
}

export function findContactByPhone(phone) {
  const canon = canonicalPhone(phone);
  if (canon.length < 3) return null;
  ensureContactsLoaded();
  return (
    contacts.find((c) => c.phoneCanonical === canon || c.phone2Canonical === canon) ||
    null
  );
}

export async function createContact(data = {}) {
  ensureContactsLoaded();
  const item = normalizeContactInput(data);
  if (!item.name) {
    const err = new Error('Inserisci il nome del contatto.');
    err.status = 400;
    throw err;
  }
  if (item.phoneCanonical.length < 3) {
    const err = new Error('Inserisci un numero di telefono valido.');
    err.status = 400;
    throw err;
  }

  const existing = contacts.find(
    (c) =>
      c.phoneCanonical === item.phoneCanonical ||
      (item.phone2Canonical.length >= 3 && c.phone2Canonical === item.phone2Canonical)
  );
  if (existing) {
    const err = new Error(`Esiste già un contatto con questo numero (${existing.name}).`);
    err.status = 409;
    throw err;
  }

  const now = new Date().toISOString();
  const record = {
    id: `CT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ...item,
    createdAt: now,
    updatedAt: now
  };
  contacts.push(record);
  await persistContacts();
  return record;
}

export async function updateContact(id, patch = {}) {
  ensureContactsLoaded();
  const contact = contacts.find((c) => c.id === id);
  if (!contact) return null;

  const merged = normalizeContactInput({
    name: patch.name !== undefined ? patch.name : contact.name,
    company: patch.company !== undefined ? patch.company : contact.company,
    phone: patch.phone !== undefined ? patch.phone : contact.phone,
    phone2: patch.phone2 !== undefined ? patch.phone2 : contact.phone2,
    email: patch.email !== undefined ? patch.email : contact.email,
    note: patch.note !== undefined ? patch.note : contact.note,
    source: contact.source
  });

  if (!merged.name) {
    const err = new Error('Il nome del contatto non può essere vuoto.');
    err.status = 400;
    throw err;
  }
  if (merged.phoneCanonical.length < 3) {
    const err = new Error('Inserisci un numero di telefono valido.');
    err.status = 400;
    throw err;
  }

  Object.assign(contact, merged, { updatedAt: new Date().toISOString() });
  await persistContacts();
  return contact;
}

export async function deleteContact(id) {
  ensureContactsLoaded();
  const index = contacts.findIndex((c) => c.id === id);
  if (index < 0) return false;
  contacts.splice(index, 1);
  await persistContacts();
  return true;
}

function splitCsvLines(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  // Rileva delimitatore dalla prima riga non vuota (;, tab, o ,)
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delim =
    semiCount >= commaCount && semiCount >= tabCount && semiCount > 0
      ? ';'
      : tabCount > commaCount && tabCount > 0
        ? '\t'
        : ',';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r') {
      // ignore
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseVcfContacts(text) {
  const blocks = String(text || '').split(/BEGIN:VCARD/i).slice(1);
  const out = [];
  for (const block of blocks) {
    const lines = block
      .replace(/\r?\n[ \t]/g, '') // unfold folded lines
      .split(/\r?\n/);
    let fn = '';
    let nField = '';
    let org = '';
    let email = '';
    let note = '';
    const tels = [];

    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon).toUpperCase();
      const val = line.slice(colon + 1).trim();
      if (!val) continue;
      if (key === 'FN' || key.startsWith('FN;')) fn = val;
      else if (key === 'N' || key.startsWith('N;')) {
        const parts = val.split(';').map((s) => s.trim()).filter(Boolean);
        if (parts.length) nField = parts.slice(0, 2).reverse().join(' ');
      } else if (key === 'ORG' || key.startsWith('ORG;')) {
        org = val.replace(/;+/g, ' ').trim();
      } else if (key === 'TEL' || key.startsWith('TEL;')) {
        tels.push(val);
      } else if (key === 'EMAIL' || key.startsWith('EMAIL;')) {
        if (!email) email = val;
      } else if (key === 'NOTE' || key.startsWith('NOTE;')) {
        note = val.replace(/\\n/g, ' ').trim();
      }
    }

    const name = fn || nField || org;
    if (name && tels.length) {
      out.push({
        name,
        company: org && org !== name ? org : '',
        phone: tels[0],
        phone2: tels[1] || '',
        email,
        note
      });
    }
  }
  return out;
}

function parseCsvOrTextContacts(text) {
  const rows = splitCsvLines(text);
  if (!rows.length) return [];

  const firstNorm = rows[0].map(normalizeHeader);
  const headerKeywords = new Set([
    'nome', 'name', 'cognome', 'lastname', 'surname', 'firstname',
    'nominativo', 'contatto', 'displayname', 'fullname', 'ragionesociale',
    'telefono', 'phone', 'phonenumber', 'numero', 'number', 'tel', 'telef',
    'cellulare', 'mobile', 'cell', 'fax', 'azienda', 'company', 'societa',
    'ditta', 'organizzazione', 'organization', 'org', 'email', 'mail', 'note', 'notes'
  ]);
  const hasHeader = firstNorm.some((h) => headerKeywords.has(h));

  const out = [];
  if (hasHeader) {
    const idxOf = (candidates) => firstNorm.findIndex((h) => candidates.includes(h));
    const idxName = idxOf(['nominativo', 'fullname', 'displayname', 'contatto', 'nomecompleto', 'name', 'nome']);
    const idxFirst = idxOf(['firstname', 'nome']);
    const idxLast = idxOf(['lastname', 'surname', 'cognome']);
    const idxCompany = idxOf(['azienda', 'company', 'societa', 'ditta', 'organizzazione', 'organization', 'org', 'ragionesociale']);
    const idxEmail = idxOf(['email', 'mail', 'posta']);
    const idxNote = idxOf(['note', 'notes', 'descrizione', 'commento']);

    const phoneCols = [];
    firstNorm.forEach((h, idx) => {
      if (
        ['telefono', 'telefono1', 'phone', 'phone1', 'phonenumber', 'numero', 'number', 'tel', 'telef', 'ufficio', 'fisso', 'cellulare', 'mobile', 'cell', 'telefono2', 'phone2', 'altro'].includes(h) ||
        /^(?:tel|phone|num|cell|mob)/.test(h)
      ) {
        phoneCols.push(idx);
      }
    });

    for (let r = 1; r < rows.length; r += 1) {
      const cols = rows[r];
      let name = '';
      if (idxFirst >= 0 && idxLast >= 0 && idxFirst !== idxLast) {
        name = [cols[idxFirst], cols[idxLast]].filter(Boolean).join(' ').trim();
      } else if (idxName >= 0) {
        name = String(cols[idxName] || '').trim();
      }
      const company = idxCompany >= 0 ? String(cols[idxCompany] || '').trim() : '';
      if (!name && company) name = company;

      const phones = phoneCols
        .map((i) => String(cols[i] || '').trim())
        .filter((p) => canonicalPhone(p).length >= 3);

      if (!name || !phones.length) continue;
      out.push({
        name,
        company: company && company !== name ? company : '',
        phone: phones[0],
        phone2: phones[1] || '',
        email: idxEmail >= 0 ? String(cols[idxEmail] || '').trim() : '',
        note: idxNote >= 0 ? String(cols[idxNote] || '').trim() : ''
      });
    }
    return out;
  }

  // Senza intestazione: es. "Mario Rossi; 3331234567; Bar Centrale"
  for (const cols of rows) {
    const phones = [];
    const texts = [];
    for (const col of cols) {
      const clean = col.trim();
      if (!clean) continue;
      if (/^[+\d\s\-().]{5,}$/.test(clean) && canonicalPhone(clean).length >= 5) {
        phones.push(clean);
      } else {
        texts.push(clean);
      }
    }
    if (texts.length && phones.length) {
      out.push({
        name: texts[0],
        company: texts[1] || '',
        phone: phones[0],
        phone2: phones[1] || '',
        email: texts.find((t) => /@/.test(t)) || '',
        note: ''
      });
    }
  }
  return out;
}

const MESSAGENET_NOISE_RE =
  /^(?:invia\s+(?:sms|fax)|modifica\s+contatto|cancella\s+contatto|messagenet|©|p\.iva|messagenet@|average\s+rating|recensioni|feedaty|informazioni|ottimo|\d+[.,]\d+\/\d+)$/i;

function parseMessageNetWebContacts(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !MESSAGENET_NOISE_RE.test(l));

  const out = [];
  let pendingName = '';

  for (const line of lines) {
    const m = line.match(/^(\+?\d[\d\s\-]{5,})(?:\s*\((?:CEL|TEL|FAX|MOB|FISSO)\))?$/i);
    if (m) {
      const phone = m[1].replace(/\s+/g, '');
      if (pendingName && canonicalPhone(phone).length >= 5) {
        out.push({
          name: pendingName,
          company: '',
          phone,
          phone2: '',
          email: '',
          note: ''
        });
        pendingName = '';
      }
      continue;
    }
    if (!/^messagenet/i.test(line) && !/^\d{1,5}$/.test(line)) {
      pendingName = line;
    }
  }
  return out;
}

async function upsertImportedRecords(parsed, source) {
  ensureContactsLoaded();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const entry of parsed) {
    const item = normalizeContactInput({
      ...entry,
      source: entry.source || source
    });
    if (!item.name || item.phoneCanonical.length < 3) {
      skipped += 1;
      continue;
    }

    const existing = contacts.find((c) => c.phoneCanonical === item.phoneCanonical);
    if (existing) {
      existing.name = item.name;
      if (item.company) existing.company = item.company;
      if (item.phone2) {
        existing.phone2 = item.phone2;
        existing.phone2Canonical = item.phone2Canonical;
      }
      if (item.email) existing.email = item.email;
      if (item.note) existing.note = item.note;
      existing.updatedAt = now;
      updated += 1;
    } else {
      contacts.push({
        id: `CT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        ...item,
        createdAt: now,
        updatedAt: now
      });
      imported += 1;
    }
  }

  if (imported > 0 || updated > 0) {
    await persistContacts();
  }

  return {
    imported,
    updated,
    skipped,
    parsed: parsed.length,
    total: contacts.length
  };
}

export async function importContacts({ text = '', format = 'auto', source = 'messagenet' } = {}) {
  const raw = String(text || '').trim();
  if (!raw) {
    const err = new Error('Incolla i contatti o seleziona un file CSV/vCard da importare.');
    err.status = 400;
    throw err;
  }

  const isVcf = format === 'vcf' || (format === 'auto' && /BEGIN:VCARD/i.test(raw));
  const isMnWeb =
    !isVcf && /\((?:CEL|TEL|FAX)\)|Modifica contatto|Invia SMS/i.test(raw);
  const parsed = isVcf
    ? parseVcfContacts(raw)
    : isMnWeb
      ? parseMessageNetWebContacts(raw)
      : parseCsvOrTextContacts(raw);

  return upsertImportedRecords(parsed, isVcf ? 'vcard' : source);
}

export async function importOsmContacts(clienti = []) {
  const parsed = (Array.isArray(clienti) ? clienti : [])
    .map((c) => {
      const name = String(c.ragione_sociale || c.nome || c.name || '').trim();
      const tel = String(c.telefono || c.phone || '').trim();
      const cel = String(c.cellulare || c.mobile || '').trim();
      const phones = [tel, cel].filter((p) => canonicalPhone(p).length >= 5);
      if (!name || !phones.length) return null;
      return {
        name,
        company: name,
        phone: phones[0],
        phone2: phones[1] && canonicalPhone(phones[1]) !== canonicalPhone(phones[0]) ? phones[1] : '',
        email: String(c.email || '').trim(),
        note: [c.indirizzo, c.citta].filter(Boolean).join(', '),
        source: 'osm'
      };
    })
    .filter(Boolean);

  return upsertImportedRecords(parsed, 'osm');
}

export function contactsToCsv(items) {
  const headers = ['Nome', 'Azienda', 'Telefono', 'Telefono 2', 'Email', 'Note', 'Origine'];
  const rows = items.map((c) => [
    c.name,
    c.company,
    c.phone,
    c.phone2,
    c.email,
    c.note,
    c.source
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function escapeXmlValue(val) {
  return String(val ?? '').replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

export function contactsToYealinkXml(items) {
  const entries = items
    .map((c) => {
      const displayName =
        c.company && c.company.trim().toLowerCase() !== c.name.trim().toLowerCase()
          ? `${c.name} (${c.company})`
          : c.name;
      const cleanTel = (p) => String(p || '').replace(/[^\d+]/g, '');
      const t1 = cleanTel(c.phone);
      const t2 = cleanTel(c.phone2);
      if (!t1) return '';
      const tel2 = t2 && t2 !== t1 ? `\n    <Telephone>${escapeXmlValue(t2)}</Telephone>` : '';
      return `  <DirectoryEntry>\n    <Name>${escapeXmlValue(displayName)}</Name>\n    <Telephone>${escapeXmlValue(t1)}</Telephone>${tel2}\n  </DirectoryEntry>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<YealinkIPPhoneDirectory>\n${entries}\n</YealinkIPPhoneDirectory>\n`;
}
