import { config } from './config.js';

/**
 * Risoluzione del numero del chiamante.
 *
 * Sul ponte MessageNet -> Asterisk -> SIP Domain Twilio il parametro `From`
 * del webhook contiene spesso il numero del centralino (es. +39067821202)
 * al posto del chiamante. Asterisk inoltra l'identità che conosce negli
 * header SIP `X-MTI-*` (vedi scripts/genera-config-asterisk.mjs); Twilio li
 * espone come parametri `SipHeader_X-MTI-*`.
 *
 * priorità: header espliciti -> identità SIP -> From del webhook.
 * Un numero che coincide con uno dei numeri del centralino NON viene mai
 * salvato come "telefono del chiamante": meglio vuoto che fuorviante.
 */

const HEADER_PATTERNS = [
  /^SipHeader_X-MTI-Caller$/i,
  /^SipHeader_X-MTI-Did$/i,
  /^SipHeader_X-MTI-(?:Pai|Rpid|Diversion|History)$/i,
  /^SipHeader_/i,
  /^(?:From|from)$/,
  /^(?:Caller|CallerNumber|caller_number|caller_id)$/i
];

function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Estrae tutti i numeri presenti in un valore (URI SIP/tel multipli, display
 * name, header History-Info con più URI, ...).
 */
function parsePhones(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(?:anonymous|unknown|none|null|undefined|-)$/i.test(raw)) return [];

  const uris = [...raw.matchAll(/(?:sips?|tel):(\+?[0-9][0-9.\-]*)/gi)].map(
    (m) => m[1]
  );
  const values = uris.length ? uris : [raw];
  const out = [];
  for (const uri of values) {
    const number = String(uri)
      .split(/[>;,\s]/)[0]
      .replace(/[^\d+]/g, '');
    const digits = digitsOf(number);
    if (digits.length >= 3 && digits.length <= 15 && !out.includes(number)) {
      out.push(number);
    }
  }
  return out;
}

const OWN_NUMBERS = [
  config.centralinoNumber,
  config.italianNumber,
  config.fallbackNumber,
  config.forwardNumber,
  config.messagenetNumber,
  config.twilio.phoneNumber,
  config.telnyx.phoneNumber
]
  .filter(Boolean)
  .map(digitsOf)
  .filter((d) => d.length >= 6);

/** Confronta per suffisso: +39067821202 e 067821202 sono lo stesso numero. */
function isOwnNumber(phone) {
  const digits = digitsOf(phone);
  if (digits.length < 6) return false;
  return OWN_NUMBERS.some((own) => {
    const n = Math.min(own.length, digits.length);
    return own.slice(-n) === digits.slice(-n);
  });
}

/**
 * Restituisce il numero del chiamante ('' se non determinabile).
 * `log` abilita una riga di diagnostica con i parametri ricevuti.
 */
export function resolveCallerNumber(body = {}, { log = false } = {}) {
  const keys = Object.keys(body || {});
  const candidates = [];

  for (const pattern of HEADER_PATTERNS) {
    for (const key of keys.filter((k) => pattern.test(k))) {
      for (const phone of parsePhones(body[key])) {
        if (!candidates.some((c) => c.phone === phone)) {
          candidates.push({ key, phone });
        }
      }
    }
  }

  if (log) {
    const seen = candidates.map((c) => `${c.key}=${c.phone}`);
    console.log(
      `[CallerID] ${reqKeys(keys, body)}${seen.length ? ` | candidati: ${seen.join(', ')}` : ''}`
    );
  }

  const valid = candidates.find((c) => !isOwnNumber(c.phone));
  if (valid) return valid.phone;

  if (log && candidates.length) {
    console.log(
      `[CallerID] scartati ${candidates.map((c) => c.phone).join(', ')}: sono numeri del centralino`
    );
  }
  return '';
}

/** Mostra solo i parametri utili alla diagnosi, mai token o segreti. */
function reqKeys(keys, body) {
  const interesting = keys.filter((k) =>
    /^(?:From|To|from|to|Caller|SipHeader_)/i.test(k)
  );
  if (!interesting.length) return 'nessun parametro telefono';
  return interesting
    .slice(0, 12)
    .map((k) => `${k}=${String(body[k]).slice(0, 80)}`)
    .join(' ');
}
