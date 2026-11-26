import { config } from './config.js';
import { isOwnNumber } from './callerId.js';
import { getStep, handleAnswer, isOperatorRequest, DEFAULT_TICKET_PRIORITY } from './flow.js';

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const voice = config.twilio.voice;
const voiceRate = config.twilio.voiceRate;
const language = config.twilio.language;
const dialTimeout = config.dialTimeoutSeconds;

function newSession({ callSid, from, to }) {
  return {
    callSid,
    from: from || '',
    to: to || '',
    step: 'reason',
    // Il numero del chiamante viene registrato automaticamente dal caller ID.
    answers: { phone: from || '' },
    retries: 0,
    ticketId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function createSession(payload) {
  const session = newSession(payload);
  sessions.set(session.callSid, session);
  return session;
}

export function getSession(callSid) {
  return sessions.get(callSid) || null;
}

export function getOrCreateSession(payload) {
  return getSession(payload.callSid) || createSession(payload);
}

export function escapeXml(value) {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => {
    switch (char) {
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

function supportsProsody(v) {
  return (
    /^Polly\./i.test(v) ||
    /^Google\.[^.]+-(?:Wavenet|Neural2|Standard)-/i.test(v)
  );
}

function say(text, rate = voiceRate) {
  const escaped = escapeXml(text);
  const useProsody =
    rate &&
    !/^(?:100%|medium|default)$/i.test(rate) &&
    supportsProsody(voice);
  const body = useProsody
    ? `<prosody rate="${escapeXml(rate)}">${escaped}</prosody>`
    : escaped;
  return `<Say language="${escapeXml(language)}" voice="${escapeXml(voice)}">${body}</Say>`;
}

function twiml(content) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}

const REASON_HINTS =
  'assistenza tecnica, informazioni commerciali, amministrazione, altro, operatore';

function speechAttributes(timeout = 8, speechTimeout = 'auto', hints = '') {
  const hintsAttr = hints ? ` hints="${escapeXml(hints)}"` : '';
  return `input="speech" language="${escapeXml(
    language
  )}" speechTimeout="${escapeXml(String(speechTimeout))}" timeout="${timeout}"${hintsAttr}`;
}

function gatherAttributes(step) {
  if (step.type === 'menu' && config.ivr.inputMode === 'both') {
    const hintsAttr = step.id === 'reason' ? ` hints="${escapeXml(REASON_HINTS)}"` : '';
    return `input="dtmf speech" language="${escapeXml(
      language
    )}" speechTimeout="auto" numDigits="1" timeout="8"${hintsAttr}`;
  }
  if (step.id === 'reason') {
    return speechAttributes(8, 'auto', REASON_HINTS);
  }
  if (step.id === 'issue') {
    // Più tempo sia per iniziare a parlare sia per brevi pause mentre si
    // descrive la problematica o la richiesta.
    return speechAttributes(12, 3);
  }
  return speechAttributes();
}

/** Scelta finale espressa a voce (o, in modalità `both`, anche con un tasto). */
export function parseFinalChoice(input = {}) {
  const digits = String(input.digits || '').trim();
  const speech = normalizeSpeech(String(input.speech || ''));
  if (digits === '1' || digits === '0' || speech.includes('operatore')) {
    return 'operator';
  }
  if (digits === '2' || speech.includes('whatsapp')) return 'whatsapp';
  return 'none';
}

function normalizeSpeech(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Genera il TwiML per il passo corrente della sessione.
 */
export function renderCurrentStep(session, baseUrl, error, prefix = '/twilio') {
  const step = getStep(session.step, session.answers, session.from);
  const action = `${baseUrl}${prefix}/voice/step`;
  const prompt = !error
    ? step.prompt
    : error === 'GREETING'
      ? step.prompt
      : `Non ho capito. ${step.prompt}`;

  // Sul menu iniziale il microfono si apre solo DOPO che la domanda è finita:
  // evita che un "Pronto", un "Ciao" o il rientro dal vivavoce interrompano
  // il benvenuto prima che il chiamante abbia sentito le opzioni.
  if (step.id === 'reason') {
    return twiml(
      `${say(prompt)}` +
        `<Gather ${gatherAttributes(step)} action="${escapeXml(
          action
        )}" method="POST"/>` +
        `${say('Non ho ricevuto alcuna risposta. La chiamata verrà chiusa.')}<Hangup/>`
    );
  }

  return twiml(
    `<Gather ${gatherAttributes(step)} action="${escapeXml(
      action
    )}" method="POST">${say(prompt)}</Gather>` +
      `${say('Non ho ricevuto alcuna risposta. La chiamata verrà chiusa.')}<Hangup/>`
  );
}

/**
 * Applica la risposta del chiamante alla sessione.
 */
export function handleTwilioStep(session, input) {
  const digits = String(input?.digits || '').trim();
  const speech = String(input?.speech || '').trim();

  // Comando di inoltro: tasto 0 oppure richiesta vocale di un operatore.
  if (digits === '0' || isOperatorRequest(speech)) {
    session.updatedAt = Date.now();
    return { done: false, transfer: true };
  }

  const stepBefore = session.step;
  const outcome = handleAnswer(
    session.step,
    session.answers,
    session.from,
    input,
    session.retries
  );

  // Diagnostica: mostra cosa ha risposto il chiamante e se il numero è stato
  // acquisito. Utile quando la rete non passa il caller ID.
  console.log(
    `[Step] ${session.callSid} ${stepBefore} ` +
      `speech="${speech.slice(0, 60)}" digits="${digits}" ` +
      `-> ${outcome.outcome}${outcome.nextStep ? ':' + outcome.nextStep : ''} ` +
      `phone="${outcome.answers?.phone ?? session.answers?.phone ?? ''}"`
  );

  session.updatedAt = Date.now();

  if (outcome.outcome === 'invalid') {
    if (outcome.greeting && !session.greetingIgnored) {
      session.greetingIgnored = true;
      session.retries = 0;
    } else {
      session.retries = outcome.retries;
    }
    return { done: false, error: outcome.error };
  }

  session.retries = 0;

  if (outcome.outcome === 'goto') {
    session.step = outcome.nextStep;
    return { done: false };
  }

  if (outcome.outcome === 'restart') {
    session.answers = { phone: session.from || '' };
    session.step = 'reason';
    return { done: false };
  }

  if (outcome.outcome === 'next') {
    session.answers = outcome.answers;
    session.step = outcome.nextStep;
    return { done: false };
  }

  session.answers = outcome.answers;
  session.step = 'done';
  return { done: true };
}

export function buildTicketData(session) {
  const answers = session.answers;
  return {
    callerName: answers.callerName || 'Non fornito',
    company: answers.company,
    address: answers.address,
    phone: answers.phone || session.from,
    from: session.from,
    reason: answers.reason || 'Non specificata',
    product: answers.product || '',
    issue: answers.issue || 'Non specificata',
    priority: DEFAULT_TICKET_PRIORITY,
    source: 'telefono',
    call: {
      sid: session.callSid,
      from: session.from,
      to: session.to
    }
  };
}

/**
 * Ticket per una chiamata interrotta prima della conferma finale.
 * Usa tutti i dati raccolti fino a quel momento e completa i campi mancanti
 * con valori espliciti, così il ticket viene aperto comunque.
 */
export function buildInterruptedTicketData(session) {
  const answers = session.answers || {};
  return {
    callerName: answers.callerName || 'Non fornito',
    company: answers.company || '',
    address: answers.address || '',
    phone: answers.phone || session.from,
    from: session.from,
    reason: answers.reason || 'Chiamata interrotta',
    product: answers.product || '',
    issue: answers.issue || 'Chiamata interrotta prima del completamento.',
    priority: DEFAULT_TICKET_PRIORITY,
    source: 'telefono',
    interrupted: true,
    call: {
      sid: session.callSid,
      from: session.from,
      to: session.to
    }
  };
}

export function renderFinal(session) {
  const ticketId = session.ticketId || 'in elaborazione';
  // Nessun dato del chiamante viene riletto: ticket, promessa di ricontatto,
  // riepilogo orari di apertura, avviso email urgente più veloce e chiusura.
  return twiml(
    `${say(
      `Grazie. La sua richiesta è stata registrata con il numero ${ticketId}. Sarà ricontattato. Le ricordiamo i nostri orari di apertura: dal lunedì al venerdì dalle 8:30 alle 13:00 e dalle 14:30 alle 17:00, e il sabato dalle 8:30 alle 13:00.`
    )}${say(
      "Per richieste di assistenza urgenti al di fuori dagli orari lavorativi, inviare un'email ad assistenza chiocciola m t italia retail punto com. Grazie e arrivederci.",
      '130%'
    )}<Hangup/>`
  );
}

/** Conferma dell'invio del riepilogo via WhatsApp richiesto a fine chiamata. */
export function renderWhatsAppReply(sent) {
  return twiml(
    `${say(
      sent
        ? 'Le abbiamo inviato il riepilogo della richiesta su WhatsApp. Grazie e arrivederci.'
        : 'Non siamo riusciti a inviare il messaggio WhatsApp. La ricontatteremo al più presto. Grazie e arrivederci.'
    )}<Hangup/>`
  );
}

function callerIdAttribute(number = config.twilio.phoneNumber) {
  return number ? ` callerId="${escapeXml(number)}"` : '';
}

function buildVoipSipUri({
  sipUri = config.voip.sipUri,
  extension = '',
  callerPhone = '',
  callerName = ''
} = {}) {
  let target = String(sipUri || '').trim();
  if (!target) return '';

  if (extension && /^sips?:[^@]+@/i.test(target)) {
    target = target.replace(/^(sips?:)[^@]+@/i, `$1${extension}@`);
  }

  const params = [];
  if (config.voip.bridgeToken && !/[?&]X-MTI-Bridge=/i.test(target)) {
    params.push(`X-MTI-Bridge=${encodeURIComponent(config.voip.bridgeToken)}`);
  }
  if (callerPhone && !/[?&]X-MTI-Caller=/i.test(target)) {
    params.push(`X-MTI-Caller=${encodeURIComponent(callerPhone)}`);
  }
  if (callerName && !/[?&]X-MTI-CallerName=/i.test(target)) {
    params.push(`X-MTI-CallerName=${encodeURIComponent(String(callerName).slice(0, 60))}`);
  }
  if (!params.length) return target;
  return `${target}${target.includes('?') ? '&' : '?'}${params.join('&')}`;
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function isLoopingTrunkNumber(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 6) return false;
  const trunks = [
    config.messagenetNumber,
    config.messagenetUri,
    config.messagenetAltNumber,
    config.messagenetAltUri,
    config.twilio.phoneNumber,
    config.telnyx.phoneNumber
  ]
    .filter(Boolean)
    .map(digitsOnly)
    .filter((d) => d.length >= 6);
  return trunks.some((own) => {
    const n = Math.min(own.length, digits.length);
    return own.slice(-n) === digits.slice(-n);
  });
}

export function normalizeExternalPhone(target) {
  const cleaned = String(target || '')
    .trim()
    .replace(/[\s\-().]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  if (/^(?:0|3)\d{5,}$/.test(cleaned)) return `+39${cleaned}`;
  return cleaned;
}

function shouldUseVoipTarget(target) {
  if (!config.voip.transferEnabled || !config.voip.sipUri) return false;
  const trimmed = String(target || '').trim();
  if (!trimmed) return true;
  if (/^(?:voip|interni|10\d|110)$/i.test(trimmed)) return true;
  if (isLoopingTrunkNumber(trimmed)) return true;
  if (config.voip.externalForwardEnabled) return false;
  return isOwnNumber(trimmed);
}

export function renderDialVoip({
  message = 'La metto in contatto con un operatore. Attendere prego.',
  callerId = config.twilio.phoneNumber,
  callerPhone = '',
  callerName = '',
  baseUrl = '',
  prefix = '/twilio',
  extension = '',
  actionSuffix = '/voice/dial-result'
} = {}) {
  const uri = buildVoipSipUri({ callerPhone, callerName, extension });
  const authAttrs =
    config.voip.sipUser && config.voip.sipPassword
      ? ` username="${escapeXml(config.voip.sipUser)}" password="${escapeXml(
          config.voip.sipPassword
        )}"`
      : '';
  const actionAttr = baseUrl
    ? ` action="${escapeXml(`${baseUrl}${prefix}${actionSuffix}`)}" method="POST"`
    : '';
  const dialCallerId =
    callerPhone || callerId || config.twilio.phoneNumber || config.centralinoNumber;
  const intro = message ? say(message) : '';

  return twiml(
    `${intro}` +
      `<Dial${callerIdAttribute(dialCallerId)} timeout="${
        config.voip.dialTimeout
      }"${actionAttr}><Sip${authAttrs}>${escapeXml(uri)}</Sip></Dial>`
  );
}

export function renderDialVoipFirst({
  callerId = config.twilio.phoneNumber,
  callerPhone = '',
  callerName = '',
  baseUrl = '',
  prefix = '/twilio'
} = {}) {
  return renderDialVoip({
    message: '',
    callerId,
    callerPhone,
    callerName,
    baseUrl,
    prefix,
    actionSuffix: '/voice/voip-fallback'
  });
}

export function isDialAnswered(dialStatus) {
  const status = String(dialStatus || '').trim().toLowerCase();
  return status === 'completed' || status === 'answered';
}

export function renderDialResult(dialStatus) {
  if (isDialAnswered(dialStatus)) {
    return twiml('<Hangup/>');
  }
  return twiml(
    `${say(
      'Nessun operatore disponibile in questo momento. La sua richiesta è stata registrata, la ricontatteremo. Arrivederci.'
    )}<Hangup/>`
  );
}

// Con DIAL_TIMEOUT_SECONDS=0 non si squilla affatto verso il centralino PSTN:
// la richiesta è già stata registrata e si comunica solo il ricontatto.
// Se invece VOIP_TRANSFER_ENABLED=true, il trasferimento passa via SIP su Asterisk.
const NO_RING_MESSAGE =
  'La sua richiesta è stata registrata. Sarà ricontattato. Arrivederci.';

export function renderTransfer(
  wantsOperator,
  callerId = config.twilio.phoneNumber,
  baseUrl = '',
  prefix = '/twilio',
  callerPhone = '',
  callerName = ''
) {
  if (wantsOperator && config.voip.transferEnabled && config.voip.sipUri) {
    return renderDialVoip({
      message: 'La metto in contatto con un operatore. Attendere prego.',
      callerId,
      callerPhone,
      callerName,
      baseUrl,
      prefix
    });
  }

  if (wantsOperator && config.twilio.operatorNumber && dialTimeout <= 0) {
    return twiml(`${say(NO_RING_MESSAGE)}<Hangup/>`);
  }

  if (wantsOperator && config.twilio.operatorNumber) {
    return twiml(
      `${say('La metto in contatto con un operatore. Attendere prego.')}` +
        `<Dial${callerIdAttribute(callerId)} timeout="${dialTimeout}">${escapeXml(
          config.twilio.operatorNumber
        )}</Dial>` +
        `${say(
          'Nessun operatore disponibile in questo momento. La ricontatteremo al più presto. Arrivederci.'
        )}<Hangup/>`
    );
  }

  if (wantsOperator) {
    return twiml(
      `${say(
        'In questo momento non ci sono operatori disponibili. La ricontatteremo al più presto. Arrivederci.'
      )}<Hangup/>`
    );
  }

  return twiml(`${say('Grazie e arrivederci.')}<Hangup/>`);
}

/**
 * Inoltro richiesto durante la chiamata (tasto 0 o parola "operatore").
 */
export function renderTransferNow(
  session,
  baseUrl,
  callerId = config.twilio.phoneNumber,
  prefix = '/twilio'
) {
  const callerPhone = session?.answers?.phone || session?.from || '';
  const callerName = session?.answers?.callerName || session?.contactName || '';

  if (config.voip.transferEnabled && config.voip.sipUri) {
    return renderDialVoip({
      message: 'La metto in contatto con un operatore. Attendere prego.',
      callerId,
      callerPhone,
      callerName,
      baseUrl,
      prefix
    });
  }

  const number = config.twilio.operatorNumber;

  if (!number) {
    return twiml(
      `${say(
        'In questo momento non posso trasferire la chiamata a un operatore. La sua richiesta è stata registrata e la ricontatteremo. Arrivederci.'
      )}<Hangup/>`
    );
  }

  if (dialTimeout <= 0) {
    return twiml(`${say(NO_RING_MESSAGE)}<Hangup/>`);
  }

  return twiml(
    `${say('La metto in contatto con il centralino. Attendere prego.')}` +
      `<Dial${callerIdAttribute(callerId)} timeout="${dialTimeout}">${escapeXml(number)}</Dial>` +
      `${say(
        'Il centralino non è raggiungibile in questo momento. La sua richiesta è stata registrata e la ricontatteremo. Arrivederci.'
      )}<Hangup/>`
  );
}

/**
 * Inoltro diretto di tutte le chiamate in entrata (modalità inoltro attiva).
 */
export function renderDirectForward(
  number,
  callerId = config.twilio.phoneNumber,
  baseUrl = '',
  prefix = '/twilio',
  callerPhone = '',
  callerName = ''
) {
  if (shouldUseVoipTarget(number)) {
    const trimmed = String(number || '').trim();
    const extension = /^(?:10\d|110)$/.test(trimmed) ? trimmed : '';
    return renderDialVoip({
      message: '',
      callerId,
      callerPhone,
      callerName,
      baseUrl,
      prefix,
      extension
    });
  }

  if (config.voip.externalForwardEnabled && number) {
    const target = normalizeExternalPhone(number);
    const actionAttr = baseUrl
      ? ` action="${escapeXml(`${baseUrl}${prefix}/voice/dial-result`)}" method="POST"`
      : '';
    return twiml(
      `<Dial${callerIdAttribute(callerId)} timeout="${
        config.voip.dialTimeout
      }"${actionAttr}>${escapeXml(target)}</Dial>`
    );
  }

  if (dialTimeout <= 0) {
    return twiml(
      `${say(
        `${config.welcomeMessage}. La sua richiesta è stata registrata. Sarà contattato al più presto. Arrivederci.`
      )}<Hangup/>`
    );
  }

  return twiml(
    `${say(
      `${config.welcomeMessage}. La stiamo inoltrando al centralino. Attendere prego.`
    )}` +
      `<Dial${callerIdAttribute(callerId)} timeout="${dialTimeout}">${escapeXml(number)}</Dial>` +
      `${say(
        'Il centralino non è raggiungibile in questo momento. La invitiamo a riprovare più tardi. Arrivederci.'
      )}<Hangup/>`
  );
}

export function buildTransferTicketData(session) {
  const answers = session.answers || {};
  return {
    callerName: answers.callerName,
    company: answers.company,
    address: answers.address,
    phone: answers.phone || session.from,
    from: session.from,
    reason: answers.reason || 'Richiesta operatore',
    product: answers.product || '',
    issue: answers.issue || 'Il chiamante ha chiesto di parlare con un operatore.',
    priority: DEFAULT_TICKET_PRIORITY,
    source: 'telefono',
    call: {
      sid: session.callSid,
      from: session.from,
      to: session.to
    }
  };
}

/**
 * Rete di sicurezza per le chiamate che non arrivano alla conferma finale.
 *
 * Il SIP Domain Twilio (ponte MessageNet) non invia i callback di stato, quindi
 * non possiamo contare solo su /twilio/status: se una sessione resta ferma per
 * `idleMs` senza aver ancora generato un ticket, `onAbandoned` viene chiamato
 * e il ticket viene aperto comunque con i dati raccolti fino a quel momento.
 */
const ABANDONED_IDLE_MS = config.ivr.abandonAfterSeconds * 1000;
const ABANDONED_CHECK_MS = 5 * 1000;

export function startAbandonedCallWatcher(
  onAbandoned,
  { idleMs = ABANDONED_IDLE_MS, intervalMs = ABANDONED_CHECK_MS } = {}
) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.ticketId || session.abandonedReported || session.ticketInProgress) {
        continue;
      }
      if (session.step === 'done') continue;
      if (now - session.updatedAt < idleMs) continue;

      session.abandonedReported = true;
      Promise.resolve(onAbandoned(session)).catch((err) => {
        session.abandonedReported = false;
        console.error(`[Chiamata non terminata] errore: ${err?.message || err}`);
      });
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

// Pulizia periodica delle sessioni abbandonate.
const cleanup = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [callSid, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(callSid);
  }
}, 30 * 60 * 1000);
if (typeof cleanup.unref === 'function') cleanup.unref();
