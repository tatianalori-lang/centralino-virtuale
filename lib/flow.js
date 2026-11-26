import { catalog, config } from './config.js';

export const MAX_RETRIES = 2;

/**
 * Ordine dei passi del dialogo. La chiave è il campo salvato nel ticket.
 */
export const ORDER = [
  'reason',
  'product',
  'issue',
  'name',
  'company',
  'address'
];

// La richiesta generica sul prodotto/servizio riguarda solo l'assistenza
// tecnica: per gli altri motivi il passo viene saltato. Il valore è letto dal
// catalogo, così la regola resta valida anche se l'etichetta viene rinominata.
export const TECHNICAL_REASON =
  catalog.reasons.find((r) => /assistenza\s+tecnica/i.test(r.value))?.value ||
  'Assistenza tecnica';

export function requiresProduct(answers = {}) {
  return normalize(String(answers.reason || '')) === normalize(TECHNICAL_REASON);
}

const NUMBER_WORDS = {
  zero: '0',
  uno: '1',
  due: '2',
  tre: '3',
  quattro: '4',
  cinque: '5',
  sei: '6',
  sette: '7',
  otto: '8',
  nove: '9'
};

function menuText(options) {
  return options.map((o) => `${o.key} per ${o.value.toLowerCase()}`).join(', ');
}

/** Elenco parlato delle opzioni, senza numeri di tasto. */
function spokenMenuText(options) {
  const values = options.map((o) => o.value.toLowerCase());
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')}, oppure ${values[values.length - 1]}`;
}

function menuPrompt(options) {
  if (config.ivr.inputMode === 'both') {
    return `${menuText(options)}. Può comporre il numero con la tastiera oppure dica la sua scelta.`;
  }
  return `Dica ${spokenMenuText(options)}.`;
}

/** Sinonimi parlati per le scelte più comuni. */
const OPTION_SYNONYMS = {
  Altro: ['altro', 'non so', 'boh', 'non lo so']
};

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s@.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSpeech(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Restituisce la definizione del passo richiesto, con prompt e opzioni.
 */
export function getStep(id, answers = {}, from = '') {
  switch (id) {
    case 'reason':
      return {
        id,
        type: 'menu',
        field: 'reason',
        options: catalog.reasons,
        prompt: `${config.welcomeMessage}. Per quale motivo ci contatta? ${menuPrompt(
          catalog.reasons
        )}`,
        defaultValue: catalog.reasons[catalog.reasons.length - 1]?.value || 'Altro',
        required: true
      };

    case 'product':
      return {
        id,
        type: 'speech',
        field: 'product',
        // Dopo "Assistenza tecnica" non c'è più una selezione da un elenco di
        // prodotti: il chiamante descrive liberamente su cosa richiede
        // assistenza (richiesta generica, testo libero).
        prompt:
          'Mi dica su quale prodotto o servizio richiede assistenza, oppure dica salta.',
        required: false,
        optional: true
      };

    case 'issue':
      return {
        id,
        type: 'speech',
        field: 'issue',
        prompt: 'Descriva brevemente il problema o la richiesta, oppure dica salta.',
        required: true,
        minLength: 3,
        fallback: 'Non specificata'
      };

    case 'name':
      return {
        id,
        type: 'speech',
        field: 'callerName',
        prompt: 'Mi dica il suo nome.',
        required: true,
        fallback: 'Non fornito'
      };

    case 'company':
      return {
        id,
        type: 'speech',
        field: 'company',
        prompt: 'Mi dica il nome della sua azienda o società, oppure dica salta.',
        required: false,
        optional: true
      };

    case 'address':
      return {
        id,
        type: 'speech',
        field: 'address',
        // Il CAP non viene più richiesto.
        prompt:
          'Mi dica il suo indirizzo, oppure dica salta.',
        required: false,
        optional: true
      };

    default:
      throw new Error(`Passo sconosciuto: ${id}`);
  }
}

/**
 * Prossimo passo, tenendo conto delle risposte già date.
 * Le richieste su prodotto (`product`) e problematica (`issue`) vengono
 * poste solo quando il motivo è "Assistenza tecnica".
 */
export function nextStepId(id, answers = {}) {
  const start = ORDER.indexOf(id);
  if (start < 0) return null;
  for (let i = start + 1; i < ORDER.length; i += 1) {
    const nextId = ORDER[i];
    if ((nextId === 'product' || nextId === 'issue') && !requiresProduct(answers)) {
      continue;
    }
    return nextId;
  }
  return null;
}

/** Mantiene coerenti prodotto e problematica quando il motivo non è tecnico. */
function applyProductRule(answers) {
  return requiresProduct(answers) ? answers : { ...answers, product: '', issue: '' };
}

function matchOption(options, speech) {
  const normalized = normalize(speech);
  if (!normalized) return null;

  // Tasto numerico (anche se arrivato come testo dal simulatore).
  for (const option of options) {
    if (normalized === option.key) return option;
  }

  // Sinonimi parlati ("conferma", "urgente", "non lo so", ...).
  for (const option of options) {
    const synonyms = OPTION_SYNONYMS[option.value] || [];
    if (
      synonyms.some(
        (word) => normalized === word || normalized.startsWith(`${word} `)
      )
    ) {
      return option;
    }
  }

  // Corrispondenza esatta o frase che contiene il nome dell'opzione.
  for (const option of options) {
    const value = normalize(option.value);
    if (value && normalized === value) return option;
  }
  for (const option of options) {
    const value = normalize(option.value);
    if (value && normalized.includes(value)) return option;
  }

  // Parola chiave all'inizio di una parola dell'opzione ("assistenza" -> "assistenza tecnica").
  if (normalized.length >= 4) {
    for (const option of options) {
      const tokens = normalize(option.value).split(' ');
      if (tokens.some((token) => token.startsWith(normalized))) return option;
    }
  }

  // Numeri pronunciati ("uno", "due", ...).
  const words = normalized.split(' ');
  for (const [word, key] of Object.entries(NUMBER_WORDS)) {
    if (words.includes(word)) {
      const option = options.find((o) => o.key === key);
      if (option) return option;
    }
  }

  return null;
}

function isSkip(speech) {
  const value = normalize(speech);
  return (
    value === 'salta' ||
    value === 'skip' ||
    value === 'nessuna' ||
    value === 'nessuno' ||
    value === 'no' ||
    value.includes('salta') ||
    value.includes('non lo so')
  );
}

/**
 * Solo le parole che indicano senza ambiguità "non voglio inserire il dato".
 * Va controllato PRIMA del matching delle opzioni, così "salta" non può
 * essere interpretato come una scelta del menu.
 */
function isExplicitSkip(speech) {
  const value = normalize(speech);
  return (
    value === 'salta' ||
    value === 'skip' ||
    value.includes('salta') ||
    value.includes('skip')
  );
}

/**
 * Riconosce una richiesta esplicita di inoltro a un operatore.
 */
export function isOperatorRequest(speech) {
  const value = normalize(speech);
  if (!value) return false;
  if (value === 'operatore' || value === 'centralino') return true;

  return [
    'parlare con un operatore',
    'parlare con operatore',
    'passami un operatore',
    'passa un operatore',
    'voglio un operatore',
    'voglio parlare con',
    'richiesta operatore',
    'inoltro',
    'inoltrami',
    'trasferisci',
    'trasferimento',
    'persona reale',
    'persona vera'
  ].some((phrase) => value.includes(phrase));
}

/**
 * Interpreta la risposta grezza (tastiera o voce) per un passo.
 * Restituisce { ok, value } oppure { ok:false, error | action }.
 */
export function interpret(step, input = {}) {
  const digits = String(input.digits || '').trim();
  const speech = String(input.speech || '').trim();

  // "salta" va riconosciuto prima del matching delle opzioni del menu.
  const rawSpoken =
    speech || (digits && !/^[0-9*#]+$/.test(digits) ? digits : '');
  if (isExplicitSkip(rawSpoken)) {
    return { ok: true, value: fallbackFor(step) };
  }

  if (step.type === 'menu') {
    // Solo sequenze numeriche sono veri tasti DTMF; il testo è parlato.
    if (/^[0-9*#]+$/.test(digits)) {
      const option = step.options.find((o) => o.key === digits);
      if (option) return { ok: true, value: option.value };
      return { ok: false, error: 'Scelta non valida.' };
    }
    const spoken = speech || digits;
    if (spoken) {
      // Prima si tenta la scelta: così "no" resta "ricomincia" e
      // "non lo so" resta "altro". Solo se non c'è una scelta valida
      // "salta" fa usare il valore predefinito del passo.
      const option = matchOption(step.options, spoken);
      if (option) return { ok: true, value: option.value };
      if (isSkip(spoken)) return { ok: true, value: fallbackFor(step) };
      return { ok: false, error: 'Scelta non riconosciuta.' };
    }
    return { ok: false, error: 'Nessuna risposta.' };
  }

  if (step.type === 'speech') {
    const spoken = speech || (digits && !/^[0-9*#]+$/.test(digits) ? digits : '');
    if (!spoken) return { ok: false, error: 'Nessuna risposta.' };
    // Chi non vuole inserire un dato può dire "salta" su qualsiasi passo:
    // viene usato il valore predefinito (vuoto per i campi facoltativi).
    if (isSkip(spoken)) return { ok: true, value: fallbackFor(step) };
    if (step.minLength && spoken.length < step.minLength) {
      return { ok: false, error: 'Risposta troppo breve.' };
    }
    return { ok: true, value: cleanSpeech(spoken) };
  }

  return { ok: false, error: 'Tipo di passo sconosciuto.' };
}

function fallbackFor(step) {
  if (step.defaultValue !== undefined) return step.defaultValue;
  if (step.optional) return '';
  return step.fallback || 'Non fornito';
}

/**
 * Applica una risposta a una sessione di dialogo.
 * outcome: next | goto | invalid | restart | done
 */
export function handleAnswer(stepId, answers, from, input, retries = 0) {
  const step = getStep(stepId, answers, from);
  const result = interpret(step, { ...input, from });

  if (!result.ok) {
    if (retries + 1 >= MAX_RETRIES) {
      const nextAnswers = applyProductRule({ ...answers, [step.field]: fallbackFor(step) });
      const next = nextStepId(stepId, nextAnswers);
      if (!next) {
        return { outcome: 'done', answers: nextAnswers, retries: 0, forced: true };
      }
      return { outcome: 'next', answers: nextAnswers, nextStep: next, retries: 0, forced: true };
    }
    return { outcome: 'invalid', retries: retries + 1, error: result.error };
  }

  const nextAnswers = applyProductRule({ ...answers, [step.field]: result.value });
  const next = nextStepId(stepId, nextAnswers);
  if (!next) return { outcome: 'done', answers: nextAnswers, retries: 0 };
  return { outcome: 'next', answers: nextAnswers, nextStep: next, retries: 0 };
}

/**
 * Priorità dei nuovi ticket. Il chiamante non viene più interrogato
 * sull'urgenza; l'operatore può modificarla dalla dashboard.
 */
export const DEFAULT_TICKET_PRIORITY = 'media';
