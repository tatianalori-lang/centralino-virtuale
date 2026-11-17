import { config } from './config.js';
import { isOwnNumber } from './callerId.js';

/**
 * Stato dell'integrazione Webex CDR.
 */
export function webexStatus() {
  return {
    configured: Boolean(config.webex.token),
    cdrUrl: config.webex.cdrUrl,
    calledNumber: config.webex.calledNumber,
    windowMinutes: config.webex.windowMinutes,
    enabled: config.webex.enabled
  };
}

/**
 * Normalizza un numero per il confronto (solo cifre).
 */
function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Cerca nel CDR Webex il numero del chiamante originale per una chiamata
 * ricevuta sulla linea TIM attorno all'orario indicato.
 *
 * @param {Object} params
 * @param {Date|string|number} params.around - orario della chiamata (inizio)
 * @param {string} [params.calledNumber] - numero chiamato (default config)
 * @param {number} [params.windowMinutes] - finestra di ricerca
 * @returns {Promise<string>} numero del chiamante ('' se non trovato)
 */
export async function findOriginalCaller({ around, calledNumber, windowMinutes } = {}) {
  const token = config.webex.token;
  if (!token) return '';

  const targetCalled = digitsOf(calledNumber || config.webex.calledNumber);
  const windowMin = Number(windowMinutes || config.webex.windowMinutes || 10);
  const center = around ? new Date(around) : new Date();
  if (Number.isNaN(center.getTime())) return '';

  const start = new Date(center.getTime() - windowMin * 60 * 1000);
  const end = new Date(center.getTime() + windowMin * 60 * 1000);

  const url = new URL(config.webex.cdrUrl);
  url.searchParams.set('startTime', start.toISOString());
  url.searchParams.set('endTime', end.toISOString());

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
  } catch (err) {
    console.error(`[Webex] errore di rete: ${err.message}`);
    return '';
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[Webex] HTTP ${res.status}: ${text.slice(0, 200)}`);
    return '';
  }

  const body = await res.json().catch(() => ({}));
  const items = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body)
      ? body
      : [];

  const pick = (row, ...names) => {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        return row[name];
      }
    }
    const lower = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ''), v])
    );
    for (const name of names) {
      const key = name.toLowerCase().replace(/[\s_-]/g, '');
      if (lower[key] !== undefined && lower[key] !== null && lower[key] !== '') {
        return lower[key];
      }
    }
    return '';
  };

  // Trova il record più vicino nel tempo tra quelli con called ≈ targetCalled.
  let best = null;
  let bestDelta = Infinity;
  for (const row of items) {
    const called = digitsOf(pick(row, 'Called line ID', 'calledNumber', 'called', 'destinationNumber'));
    if (!called) continue;
    // confronto per suffisso: 067821202 vs 39067821202
    const n = Math.min(called.length, targetCalled.length);
    if (n < 6 || called.slice(-n) !== targetCalled.slice(-n)) continue;

    const whenRaw = pick(row, 'Start time', 'startTime', 'start');
    const when = new Date(whenRaw);
    const delta = Number.isNaN(when.getTime())
      ? Infinity
      : Math.abs(when.getTime() - center.getTime());

    if (delta < bestDelta) {
      bestDelta = delta;
      best = row;
    }
  }

  if (!best) return '';

  const caller = String(
    pick(best, 'Calling line ID', 'callingNumber', 'calling', 'originNumber')
  ).trim();

  // Scarta i numeri del centralino: meglio vuoto che fuorviante.
  if (!caller || isOwnNumber(caller)) return '';

  // Normalizza: rimuovi spazi, mantieni +
  const normalized = caller.replace(/\s+/g, '');
  return normalized;
}