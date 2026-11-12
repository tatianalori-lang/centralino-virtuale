import { config } from './config.js';

// Integrazione con "Gestione Interventi" (Worker Cloudflare + OSM).
// L'app espone POST /api/interventi protetto da cookie di sessione: qui
// effettuiamo il login, costruiamo la richiesta a partire dal ticket e
// restituiamo id/codice dell'intervento creato, che verrà salvato sul ticket.

const SESSION_TTL_MS = 10 * 60 * 60 * 1000;
let cachedCookie = null;
let cookieAt = 0;

function timeoutSignal(ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const t = timeoutSignal();
  try {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(config.interventi.url + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: t.signal
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    return { status: res.status, data, setCookie: res.headers.get('set-cookie') || '' };
  } finally {
    t.clear();
  }
}

export function status() {
  return {
    configured: Boolean(config.interventi.username && config.interventi.password),
    enabled: config.interventi.enabled,
    url: config.interventi.url,
    defaultCliente: config.interventi.defaultCliente,
    autoOpen: config.interventi.autoOpen
  };
}

async function login() {
  if (cachedCookie && Date.now() - cookieAt < SESSION_TTL_MS) return cachedCookie;

  const res = await request('/api/login', {
    method: 'POST',
    body: {
      username: config.interventi.username,
      password: config.interventi.password
    }
  });
  if (res.status !== 200) {
    throw new Error(`Login Gestione Interventi fallito (HTTP ${res.status})`);
  }
  const cookie = res.setCookie.split(';')[0];
  if (!cookie.startsWith('gi_session=')) {
    throw new Error('Cookie di sessione non ricevuto');
  }
  cachedCookie = cookie;
  cookieAt = Date.now();
  return cookie;
}

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Clienti OSM plausibili per il chiamante, ordinati per pertinenza. */
export function matchClienti(ticket, clienti = []) {
  const caller = ticket.caller || {};
  const keys = [caller.company, caller.name, caller.email, caller.phone]
    .filter(Boolean)
    .map(norm)
    .filter((k) => k.length >= 3);

  const scored = [];
  for (const c of clienti) {
    const nome = norm(c.nome || c.ragione_sociale || c.name);
    const tel = norm(c.telefono || c.cellulare);
    const email = norm(c.email);
    let score = 0;
    for (const k of keys) {
      if (nome && nome === k) score += 10;
      else if (nome && (nome.includes(k) || k.includes(nome))) score += 5;
      if (tel && tel === k) score += 8;
      if (email && email === k) score += 8;
    }
    if (score > 0) {
      scored.push({ id: c.id, nome: c.nome || c.ragione_sociale || c.name, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function buildRichiesta(ticket) {
  const c = ticket.caller || {};
  return [
    `Ticket centralino ${ticket.id} del ${ticket.createdAt || ''}`.trim(),
    `Chiamante: ${c.name || 'non indicato'}`,
    `Azienda: ${c.company || 'non indicata'}`,
    `Telefono: ${c.phone || 'non indicato'}`,
    `Email: ${c.email || 'non indicata'}`,
    `Indirizzo: ${c.address || 'non indicato'}`,
    `Motivo: ${ticket.reason || 'non indicato'}`,
    `Prodotto: ${ticket.product || 'non indicato'}`,
    `Urgenza: ${ticket.urgency || 'non indicata'}`,
    `Problematica: ${ticket.issue || 'non specificata'}`
  ].join('\n');
}

/**
 * Apre un intervento tecnico per il ticket.
 * Se il cliente non è riconducibile a un'anagrafica univoca (e non viene
 * passato `idAnagrafica`), usa l'anagrafica di fallback configurata
 * (`INTERVENTI_DEFAULT_CLIENTE`, es. "CENTRALINO"). Solo in mancanza anche di
 * questa restituisce needCliente con la rosa di candidati (nessuna scrittura OSM).
 */
export async function apriIntervento(ticket, { idAnagrafica, dryRun = false } = {}) {
  if (!config.interventi.enabled) {
    return { ok: false, error: 'Integrazione con Gestione Interventi non configurata' };
  }

  const cookie = await login();
  const metaRes = await request('/api/meta', { cookie });
  if (metaRes.status !== 200) {
    // Sessione scaduta: riprova una volta con un login fresco.
    cachedCookie = null;
    const fresh = await login();
    const retry = await request('/api/meta', { cookie: fresh });
    if (retry.status !== 200) throw new Error(`Meta non disponibile (HTTP ${retry.status})`);
    Object.assign(metaRes, retry);
  }

  const defaults = metaRes.data.defaults || {};
  const candidati = matchClienti(ticket, metaRes.data.clienti || []);
  const matchUnico =
    candidati.length && candidati[0].score >= 10 ? candidati[0].id : null;
  // Priorità: cliente scelto esplicitamente > match univoco > fallback CENTRALINO.
  const scelto =
    Number(idAnagrafica) || matchUnico || config.interventi.defaultCliente || null;
  const viaFallback = !Number(idAnagrafica) && !matchUnico && Boolean(scelto);

  if (!scelto) {
    return { ok: false, needCliente: true, clienti: candidati };
  }

  const infoAgg =
    `Origine: centralino virtuale (ticket ${ticket.id}) | ` +
    `Priorità: ${ticket.priority || 'media'} | Motivo: ${ticket.reason || ''}` +
    (viaFallback
      ? ` | Cliente non identificato: aperto sull'anagrafica di fallback (id ${scelto})`
      : '');

  const payload = {
    id_anagrafica: Number(scelto),
    richiesta: buildRichiesta(ticket),
    descrizione: '',
    informazioni_aggiuntive: infoAgg
  };
  if (defaults.id_tipo_intervento) payload.id_tipo_intervento = Number(defaults.id_tipo_intervento);
  if (defaults.id_stato_intervento) payload.id_stato_intervento = Number(defaults.id_stato_intervento);

  if (dryRun) return { ok: true, dryRun: true, payload, clienti: candidati };

  const res = await request('/api/interventi', { method: 'POST', body: payload, cookie });
  if (res.status !== 200 && res.status !== 201) {
    return {
      ok: false,
      error: res.data.error || `Creazione intervento fallita (HTTP ${res.status})`,
      status: res.status
    };
  }

  const created = res.data.created || res.data;
  return {
    ok: true,
    intervento: {
      id: created.id ?? res.data.interventoId ?? null,
      codice: created.codice ?? null,
      url: config.interventi.url,
      at: new Date().toISOString()
    },
    payload
  };
}
