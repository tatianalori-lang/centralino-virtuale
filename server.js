import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog, config, twilioStatus } from './lib/config.js';
import { resolveCallerNumber } from './lib/callerId.js';
import * as store from './lib/store.js';
import {
  buildInterruptedTicketData,
  buildTicketData,
  buildTransferTicketData,
  createSession,
  getOrCreateSession,
  getSession,
  handleTwilioStep,
  renderCurrentStep,
  renderDirectForward,
  renderFinal,
  renderTransfer,
  renderTransferNow,
  renderWhatsAppReply,
  parseFinalChoice,
  startAbandonedCallWatcher
} from './lib/ivr.js';
import { answerSimulation, startSimulation } from './lib/simulator.js';
import { requestBaseUrl, validateTwilioRequest } from './lib/signature.js';
import { validateTelnyxRequest } from './lib/telnyxSignature.js';
import { mailStatus } from './lib/mailer.js';
import { sendTicketWhatsApp, whatsappStatus } from './lib/whatsapp.js';
import { apriIntervento, status as interventiStatus } from './lib/interventi.js';

const TELNYX_PREFIX = '/telnyx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATUSES = [
  { value: 'nuovo', label: 'Nuovo' },
  { value: 'in_lavorazione', label: 'In lavorazione' },
  { value: 'chiuso', label: 'Chiuso' }
];

const PRIORITIES = ['bassa', 'media', 'alta'];

// Stati terminali di una chiamata: quando arriva il callback di stato con uno
// di questi valori, se il chiamante non ha completato il dialogo apriamo
// comunque il ticket con i dati raccolti fino a quel momento.
const TERMINAL_CALL_STATUSES = new Set([
  'completed',
  'busy',
  'failed',
  'no-answer',
  'canceled',
  'cancelled',
  'hangup',
  'call.hangup'
]);

/**
 * Apre il ticket di una chiamata che non è arrivata alla conferma finale.
 * Usato sia dal callback di stato (quando arriva) sia dalla rete di sicurezza
 * per le sessioni ferme. I dati raccolti fino a quel momento vengono comunque
 * salvati; un ticket già presente per la stessa chiamata non viene duplicato.
 */
async function openInterruptedTicket(session, label) {
  if (!session || session.ticketId || session.ticketInProgress) return null;
  if (store.getTicketByCallSid(session.callSid)) return null;

  session.ticketInProgress = true;
  try {
    const ticket = await store.createTicket(buildInterruptedTicketData(session));
    session.ticketId = ticket.id;
    console.log(`[${label}] ${session.callSid} -> ticket ${ticket.id}`);
    return ticket;
  } finally {
    session.ticketInProgress = false;
  }
}

async function createTicketForInterruptedCall(callSid, rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (!callSid || !TERMINAL_CALL_STATUSES.has(status)) return null;
  return openInterruptedTicket(getSession(callSid), 'Chiamata interrotta');
}

/**
 * Se la sessione ha già un ticket (aperto perché la chiamata sembrava finita),
 * lo aggiorna con i dati completi invece di crearne un secondo.
 */
async function ensureTicket(session, buildData) {
  if (session.ticketId) {
    return store.completeTicket(session.ticketId, buildData(session));
  }
  const ticket = await store.createTicket(buildData(session));
  session.ticketId = ticket.id;
  return ticket;
}

const app = express();
app.disable('x-powered-by');
const captureRawBody = (req, res, buf) => {
  req.rawBody = buf.toString('utf8');
};
app.use(express.urlencoded({ extended: false, verify: captureRawBody }));
app.use(express.json({ limit: '200kb', verify: captureRawBody }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function baseUrl(req) {
  return requestBaseUrl(req);
}

function xml(res, content) {
  return res.type('text/xml').send(content);
}

/**
 * Normalizza i parametri dei webhook TeXML (compatibili con TwiML, ma con
 * possibili alias in snake_case / call_control_id).
 */
function telnyxParams(req) {
  const b = req.body || {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (b[key] !== undefined && b[key] !== null && b[key] !== '') {
        return String(b[key]).trim();
      }
    }
    return '';
  };
  return {
    CallSid: pick('CallSid', 'call_sid', 'CallControlId', 'call_control_id'),
    From: pick('From', 'from'),
    To: pick('To', 'to'),
    digits: pick('Digits', 'digits'),
    speech: pick('SpeechResult', 'speech_result', 'Speech', 'speech', 'transcription')
  };
}

// ---------------------------------------------------------------------------
// API per la dashboard
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), now: new Date().toISOString() });
});

app.get('/api/meta', (req, res) => {
  res.json({
    companyName: config.companyName,
    reasons: catalog.reasons,
    products: catalog.products,
    statuses: STATUSES,
    priorities: PRIORITIES
  });
});

app.get('/api/twilio/status', (req, res) => {
  const status = twilioStatus();
  res.json({
    ...status,
    publicBaseUrl: config.publicBaseUrl || null,
    phoneNumber: config.twilio.phoneNumber || null,
    operatorConfigured: Boolean(config.twilio.operatorNumber),
    italianNumber: config.italianNumber,
    voice: config.twilio.voice,
    language: config.twilio.language
  });
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json(whatsappStatus());
});

app.get('/api/telnyx/status', (req, res) => {
  const t = config.telnyx;
  res.json({
    configured: Boolean(t.apiKey),
    phoneNumber: t.phoneNumber || null,
    voice: t.voice,
    language: t.language,
    ivrInputMode: config.ivr.inputMode,
    signatureEnabled: Boolean(t.publicKey),
    publicBaseUrl: config.publicBaseUrl || null,
    webhook: config.publicBaseUrl ? `${config.publicBaseUrl}/telnyx/voice` : null
  });
});

app.get('/api/mail/status', (req, res) => {
  res.json(mailStatus());
});

app.get('/api/inoltro', (req, res) => {
  res.json(store.getForwardSettings());
});

app.post(
  '/api/inoltro',
  asyncRoute(async (req, res) => {
    const { enabled, number } = req.body || {};

    if (number !== undefined) {
      const cleaned = String(number).trim();
      if (cleaned && cleaned.replace(/\D/g, '').length < 6) {
        return res.status(400).json({ error: 'Numero di inoltro non valido' });
      }
    }

    const settings = await store.updateForwardSettings({ enabled, number });
    return res.json(settings);
  })
);

// Modalità del centralino: "virtuale" (IVR) oppure "inoltro" (chiamate deviate).
app.get('/api/modalita', (req, res) => {
  const settings = store.getForwardSettings();
  res.json({
    mode: settings.enabled ? 'inoltro' : 'virtuale',
    ...settings
  });
});

app.post(
  '/api/modalita',
  asyncRoute(async (req, res) => {
    const { mode, number } = req.body || {};

    if (mode !== undefined && !['virtuale', 'inoltro'].includes(mode)) {
      return res.status(400).json({ error: 'Modalità non valida' });
    }

    if (number !== undefined) {
      const cleaned = String(number).trim();
      if (cleaned && cleaned.replace(/\D/g, '').length < 6) {
        return res.status(400).json({ error: 'Numero di inoltro non valido' });
      }
    }

    const settings = await store.updateForwardSettings({
      enabled: mode === undefined ? undefined : mode === 'inoltro',
      number
    });

    return res.json({
      mode: settings.enabled ? 'inoltro' : 'virtuale',
      ...settings
    });
  })
);

// ---------------------------------------------------------------------------
// Collegamento ticket -> intervento tecnico (Gestione Interventi / OSM)
// ---------------------------------------------------------------------------

app.get('/api/interventi/status', (req, res) => {
  res.json(interventiStatus());
});

app.post(
  '/api/tickets/:id/intervento',
  asyncRoute(async (req, res) => {
    const ticket = store.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
    if (ticket.intervento?.id) {
      return res.status(409).json({
        error: 'Intervento già aperto per questo ticket',
        intervento: ticket.intervento
      });
    }

    const { idAnagrafica, dryRun } = req.body || {};
    try {
      const result = await apriIntervento(ticket, {
        idAnagrafica,
        dryRun: dryRun === true || dryRun === 'true'
      });

      if (result.needCliente) {
        return res.status(422).json(result);
      }
      if (!result.ok) {
        return res.status(502).json(result);
      }
      if (result.dryRun) {
        return res.json(result);
      }

      const updated = await store.setTicketIntervento(ticket.id, result.intervento);
      return res.status(201).json({ ok: true, intervento: result.intervento, ticket: updated });
    } catch (err) {
      console.error(`[Interventi] ${ticket.id}: ${err.message}`);
      return res.status(502).json({ error: `Errore integrazione interventi: ${err.message}` });
    }
  })
);

app.get('/api/stats', (req, res) => {
  res.json(store.getStats());
});

app.get('/api/tickets', (req, res) => {
  const tickets = store.listTickets({
    status: req.query.status,
    reason: req.query.reason,
    product: req.query.product,
    q: req.query.q
  });
  res.json({ tickets, count: tickets.length });
});

app.get('/api/tickets/:id', (req, res) => {
  const ticket = store.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
  return res.json(ticket);
});

app.patch(
  '/api/tickets/:id',
  asyncRoute(async (req, res) => {
    const { status, priority, assignee, note, author } = req.body || {};

    if (status !== undefined && !STATUSES.some((s) => s.value === status)) {
      return res.status(400).json({ error: 'Stato non valido' });
    }
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'Priorità non valida' });
    }

    const ticket = await store.updateTicket(req.params.id, {
      status,
      priority,
      assignee,
      note,
      author
    });

    if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
    return res.json(ticket);
  })
);

app.delete(
  '/api/tickets/:id',
  asyncRoute(async (req, res) => {
    const deleted = await store.deleteTicket(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Ticket non trovato' });
    return res.json({ ok: true });
  })
);

app.get('/api/export.csv', (req, res) => {
  const tickets = store.listTickets({
    status: req.query.status,
    reason: req.query.reason,
    product: req.query.product,
    q: req.query.q
  });
  const csv = store.ticketsToCsv(tickets);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ticket-${stamp}.csv"`);
  res.send(`\uFEFF${csv}`);
});

// ---------------------------------------------------------------------------
// Simulatore (utile per provare il flusso senza Twilio)
// ---------------------------------------------------------------------------

app.post('/api/simulate/start', (req, res) => {
  const from = req.body?.from || '+39 000 000 0000';
  res.json(startSimulation({ from }));
});

app.post(
  '/api/simulate/answer',
  asyncRoute(async (req, res) => {
    const { sessionId, answer, digits, speech } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId mancante' });

    const value = answer ?? '';
    const state = await answerSimulation(sessionId, {
      digits: digits ?? value,
      speech: speech ?? value
    });

    return res.json(state);
  })
);

// ---------------------------------------------------------------------------
// Webhook Twilio
// ---------------------------------------------------------------------------

app.post(
  '/twilio/voice',
  validateTwilioRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, To } = req.body;
    // Dal caller ID, non dal numero del centralino (vedi lib/callerId.js).
    const From = resolveCallerNumber(req.body, { log: true });
    const forward = store.getForwardSettings();

    // Modalità inoltro diretto: tutte le chiamate vanno al centralino.
    if (forward.enabled && forward.number) {
      if (!store.getTicketByCallSid(CallSid)) {
        await store.createTicket({
          callerName: 'Non fornito',
          phone: From,
          from: From,
          reason: 'Inoltro diretto',
          product: '',
          issue: 'Chiamata inoltrata direttamente al centralino.',
          priority: 'media',
          source: 'inoltro',
          call: { sid: CallSid, from: From, to: To }
        });
      }
      return xml(res, renderDirectForward(forward.number));
    }

    const session = createSession({ callSid: CallSid, from: From, to: To });
    return xml(res, renderCurrentStep(session, baseUrl(req)));
  })
);

app.post(
  '/twilio/voice/step',
  validateTwilioRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, To, Digits, SpeechResult } = req.body;
    const From = resolveCallerNumber(req.body);
    const session = getOrCreateSession({ callSid: CallSid, from: From, to: To });

    const result = handleTwilioStep(session, {
      digits: Digits,
      speech: SpeechResult
    });

    // Tasto 0 o richiesta vocale di un operatore: inoltro immediato.
    if (result.transfer) {
      await ensureTicket(session, buildTransferTicketData);
      return xml(res, renderTransferNow(session, baseUrl(req)));
    }

    if (!result.done) {
      return xml(res, renderCurrentStep(session, baseUrl(req), result.error));
    }

    await ensureTicket(session, buildTicketData);

    return xml(res, renderFinal(session, baseUrl(req)));
  })
);

app.post(
  '/twilio/voice/transfer',
  validateTwilioRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, Digits, SpeechResult } = req.body;
    const session = getSession(CallSid);

    if (session) session.updatedAt = Date.now();

    const choice = parseFinalChoice({ digits: Digits, speech: SpeechResult });
    if (choice === 'whatsapp') {
      const ticket = session?.ticketId ? store.getTicket(session.ticketId) : null;
      const result = ticket
        ? await sendTicketWhatsApp(ticket, { to: ticket.caller?.phone })
        : { sent: false };
      return xml(res, renderWhatsAppReply(result.sent));
    }

    return xml(res, renderTransfer(choice === 'operator'));
  })
);

// Callback di stato delle chiamate (facoltativo, utile per diagnosi).
app.post(
  '/twilio/status',
  validateTwilioRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, CallStatus, From, To } = req.body;
    console.log(`[Twilio] ${CallSid || '?'} ${CallStatus || '?'} ${From || '?'} -> ${To || '?'}`);
    await createTicketForInterruptedCall(CallSid, CallStatus);
    res.sendStatus(204);
  })
);

// ---------------------------------------------------------------------------
// Webhook Telnyx (TeXML) - numero italiano gestito direttamente, senza Twilio
// ---------------------------------------------------------------------------

app.post(
  '/telnyx/voice',
  validateTelnyxRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, To } = telnyxParams(req);
    const From = resolveCallerNumber(req.body, { log: true });
    const forward = store.getForwardSettings();

    if (forward.enabled && forward.number) {
      if (!store.getTicketByCallSid(CallSid)) {
        await store.createTicket({
          callerName: 'Non fornito',
          phone: From,
          from: From,
          reason: 'Inoltro diretto',
          product: '',
          issue: 'Chiamata inoltrata direttamente al centralino.',
          priority: 'media',
          source: 'inoltro',
          call: { sid: CallSid, from: From, to: To }
        });
      }
      return xml(
        res,
        renderDirectForward(forward.number, config.telnyx.phoneNumber)
      );
    }

    const session = createSession({ callSid: CallSid, from: From, to: To });
    return xml(res, renderCurrentStep(session, baseUrl(req), undefined, TELNYX_PREFIX));
  })
);

app.post(
  '/telnyx/voice/step',
  validateTelnyxRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, To, digits, speech } = telnyxParams(req);
    const From = resolveCallerNumber(req.body);
    const session = getOrCreateSession({ callSid: CallSid, from: From, to: To });

    const result = handleTwilioStep(session, { digits, speech });

    if (result.transfer) {
      await ensureTicket(session, buildTransferTicketData);
      return xml(
        res,
        renderTransferNow(session, baseUrl(req), config.telnyx.phoneNumber)
      );
    }

    if (!result.done) {
      return xml(
        res,
        renderCurrentStep(session, baseUrl(req), result.error, TELNYX_PREFIX)
      );
    }

    await ensureTicket(session, buildTicketData);

    return xml(res, renderFinal(session, baseUrl(req), TELNYX_PREFIX));
  })
);

app.post(
  '/telnyx/voice/transfer',
  validateTelnyxRequest,
  asyncRoute(async (req, res) => {
    const { CallSid, digits, speech } = telnyxParams(req);
    const session = getSession(CallSid);

    if (session) session.updatedAt = Date.now();

    const choice = parseFinalChoice({ digits, speech });
    if (choice === 'whatsapp') {
      const ticket = session?.ticketId ? store.getTicket(session.ticketId) : null;
      const result = ticket
        ? await sendTicketWhatsApp(ticket, { to: ticket.caller?.phone })
        : { sent: false };
      return xml(res, renderWhatsAppReply(result.sent));
    }

    return xml(
      res,
      renderTransfer(choice === 'operator', config.telnyx.phoneNumber)
    );
  })
);

app.post(
  '/telnyx/status',
  validateTelnyxRequest,
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    const callSid = b.CallSid || b.call_control_id;
    const status = b.CallStatus || b.event_type;
    console.log(`[Telnyx] ${callSid || '?'} ${status || '?'}`);
    await createTicketForInterruptedCall(callSid, status);
    res.sendStatus(204);
  })
);

// ---------------------------------------------------------------------------
// File statici e gestione errori
// ---------------------------------------------------------------------------

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  return res.status(status).json({
    error: status === 500 ? 'Errore interno del server' : err.message
  });
});

// Rete di sicurezza: apre il ticket anche se la chiamata non termina e il
// provider non invia alcun callback di stato (es. SIP Domain Twilio).
startAbandonedCallWatcher((session) =>
  openInterruptedTicket(session, 'Chiamata non terminata')
);

app.listen(config.port, () => {
  const status = twilioStatus();
  console.log('');
  console.log(`  Centralino Virtuale · ${config.companyName}`);
  console.log(`  Dashboard:  http://localhost:${config.port}`);
  console.log(`  Simulatore: http://localhost:${config.port}/prova.html`);
  console.log(`  Webhook:    POST /twilio/voice`);
  console.log('');
  if (!status.ready) {
    console.log('  ATTENZIONE: configurazione Twilio incompleta.');
    console.log('    Copia .env.example in .env e compila i valori mancanti.');
    if (!config.publicBaseUrl) {
      console.log('    PUBLIC_BASE_URL è obbligatorio per le chiamate reali (es. URL ngrok).');
    }
    console.log('    Puoi comunque provare tutto con il simulatore.');
    console.log('');
  }
});
