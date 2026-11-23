import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import { sendTicketEmail } from './mailer.js';
import {
  sendTicketWhatsApp,
  shouldNotifyEmail,
  shouldNotifyWhatsApp
} from './whatsapp.js';

const DATA_DIR = path.join(ROOT_DIR, 'data');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let tickets = [];
let loaded = false;
let writeQueue = Promise.resolve();

let settings = { forwardEnabled: false, forwardNumber: '', voipStrategy: 'ivr_first' };
let settingsLoaded = false;
let settingsQueue = Promise.resolve();

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
