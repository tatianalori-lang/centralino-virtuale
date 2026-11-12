import { config } from './config.js';
import { getStep, handleAnswer, isOperatorRequest, DEFAULT_TICKET_PRIORITY } from './flow.js';

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const voice = config.twilio.voice;
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

function say(text) {
  return `<Say language="${escapeXml(language)}" voice="${escapeXml(voice)}">${escapeXml(
    text
  )}</Say>`;
}

function twiml(content) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}

function speechAttributes(timeout = 8) {
  return `input="speech" language="${escapeXml(
    language
  )}" speechTimeout="auto" timeout="${timeout}"`;
}

function gatherAttributes(step) {
  if (step.type === 'menu' && config.ivr.inputMode === 'both') {
    return `input="dtmf speech" language="${escapeXml(
      language
    )}" speechTimeout="auto" numDigits="1" timeout="8"`;
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
  const prompt = error ? `Non ho capito. ${step.prompt}` : step.prompt;

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

  const outcome = handleAnswer(
    session.step,
    session.answers,
    session.from,
    input,
    session.retries
  );

  session.updatedAt = Date.now();

  if (outcome.outcome === 'invalid') {
    session.retries = outcome.retries;
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

export function renderFinal(session, baseUrl, prefix = '/twilio') {
  const ticketId = session.ticketId || 'in elaborazione';
  const action = `${baseUrl}${prefix}/voice/transfer`;
  const finalPrompt =
    config.ivr.inputMode === 'both'
      ? 'Se desidera parlare con un operatore, prema 1 o dica operatore. Per ricevere il riepilogo su WhatsApp, prema 2 o dica WhatsApp. Altrimenti può riagganciare. Grazie e arrivederci.'
      : 'Se desidera parlare con un operatore, dica operatore. Per ricevere il riepilogo della richiesta su WhatsApp, dica WhatsApp. Altrimenti può riagganciare. Grazie e arrivederci.';

  const finalGather =
    config.ivr.inputMode === 'both'
      ? `input="dtmf speech" language="${escapeXml(language)}" speechTimeout="auto" numDigits="1" timeout="6"`
      : speechAttributes(6);

  // Nessun dato del chiamante viene riletto: solo il numero di ticket e la
  // promessa di ricontatto, senza riferimenti agli orari di apertura.
  return twiml(
    `${say(
      `Grazie. La sua richiesta è stata registrata con il numero ${ticketId}. Sarà contattato al più presto.`
    )}` +
      `<Gather ${finalGather} action="${escapeXml(
        action
      )}" method="POST">${say(finalPrompt)}</Gather><Hangup/>`
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

// Con DIAL_TIMEOUT_SECONDS=0 non si squilla affatto verso il centralino:
// la richiesta è già stata registrata e si comunica solo il ricontatto.
const NO_RING_MESSAGE =
  'La sua richiesta è stata registrata. Sarà contattato al più presto. Arrivederci.';

export function renderTransfer(wantsOperator, callerId = config.twilio.phoneNumber) {
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
export function renderTransferNow(session, baseUrl, callerId = config.twilio.phoneNumber) {
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
export function renderDirectForward(number, callerId = config.twilio.phoneNumber) {
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

// Pulizia periodica delle sessioni abbandonate.
const cleanup = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [callSid, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(callSid);
  }
}, 30 * 60 * 1000);
if (typeof cleanup.unref === 'function') cleanup.unref();
