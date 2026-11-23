import { config } from './config.js';
import * as store from './store.js';
import { findOriginalCallerFromInsights } from './twilioInsights.js';
import { findOriginalCaller as findOriginalCallerFromWebex } from './webex.js';
import { isOwnNumber } from './callerId.js';

const pending = new Map();

function cleanupTimers(state) {
  for (const t of state.timers) clearTimeout(t);
  state.timers = [];
}

async function attempt(state) {
  if (state.done) return;
  const ticket = store.getTicket(state.ticketId);
  if (!ticket) {
    state.done = true;
    cleanupTimers(state);
    pending.delete(state.callSid);
    return;
  }

  // Se il numero è già presente e valido, non fare nulla.
  if (ticket.caller?.phone && !isOwnNumber(ticket.caller.phone)) {
    state.done = true;
    cleanupTimers(state);
    pending.delete(state.callSid);
    return;
  }

  state.attempts += 1;
  try {
    let phone = '';

    // 1. Prova Twilio Insights (se configurato)
    if (config.twilio.accountSid && config.twilio.authToken) {
      phone = await findOriginalCallerFromInsights(state.callSid);
    }

    // 2. Se non trovato, prova Webex CDR (se configurato)
    if (!phone && config.webex.enabled) {
      phone = await findOriginalCallerFromWebex({
        around: new Date(state.startedAt),
        calledNumber: config.webex.calledNumber
      });
    }

    if (phone) {
      await store.updateCallerPhone(state.ticketId, phone);
      console.log(`[CallerRecovery] ${state.callSid} -> numero recuperato: ${phone}`);
      state.done = true;
      cleanupTimers(state);
      pending.delete(state.callSid);
    } else if (state.attempts >= 4) {
      console.log(`[CallerRecovery] ${state.callSid} -> numero non recuperato dopo ${state.attempts} tentativi`);
      state.done = true;
      cleanupTimers(state);
      pending.delete(state.callSid);
    }
  } catch (err) {
    console.error(`[CallerRecovery] ${state.callSid}: ${err.message}`);
  }
}

/**
 * Schedula tentativi in background per recuperare il numero del chiamante
 * originale da Twilio Insights o Webex CDR, aggiornando il ticket quando disponibile.
 */
export function scheduleCallerRecovery({ callSid, ticketId, startedAt }) {
  if (!ticketId) return;
  if (pending.has(callSid)) return;

  // Attivo solo se almeno una fonte è configurata
  const hasTwilio = Boolean(config.twilio.accountSid && config.twilio.authToken);
  const hasWebex = config.webex.enabled;
  if (!hasTwilio && !hasWebex) return;

  const state = {
    callSid,
    ticketId,
    startedAt: startedAt || Date.now(),
    attempts: 0,
    done: false,
    timers: []
  };
  pending.set(callSid, state);

  const delays = [30000, 60000, 120000, 300000];
  for (const delay of delays) {
    const t = setTimeout(() => attempt(state), delay);
    if (typeof t.unref === 'function') t.unref();
    state.timers.push(t);
  }
}

export function callerRecoveryPendingCount() {
  return pending.size;
}