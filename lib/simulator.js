import crypto from 'node:crypto';
import { getStep, handleAnswer, DEFAULT_TICKET_PRIORITY } from './flow.js';
import { createTicket } from './store.js';

const sessions = new Map();

function publicState(session) {
  if (session.step === 'done') {
    return {
      sessionId: session.id,
      step: 'done',
      type: 'done',
      prompt: '',
      options: null,
      answers: session.answers,
      done: true,
      ticketId: session.ticketId
    };
  }

  const step = getStep(session.step, session.answers, session.from);
  return {
    sessionId: session.id,
    step: session.step,
    type: step.type,
    prompt: step.prompt,
    options: step.options || null,
    answers: session.answers,
    done: false,
    ticketId: session.ticketId
  };
}

export function startSimulation({ from = '+39 000 000 0000' } = {}) {
  const session = {
    id: crypto.randomUUID(),
    from,
    step: 'reason',
    answers: { phone: from },
    retries: 0,
    ticketId: null,
    createdAt: Date.now()
  };
  sessions.set(session.id, session);
  return publicState(session);
}

export function getSimulation(id) {
  return sessions.get(id) || null;
}

export async function answerSimulation(id, input = {}) {
  const session = sessions.get(id);
  if (!session) {
    const error = new Error('Sessione di simulazione non trovata o scaduta.');
    error.status = 404;
    throw error;
  }

  if (session.step === 'done') return publicState(session);

  const outcome = handleAnswer(
    session.step,
    session.answers,
    session.from,
    input,
    session.retries
  );

  if (outcome.outcome === 'invalid') {
    session.retries = outcome.retries;
    return {
      ...publicState(session),
      error: outcome.error,
      retry: true
    };
  }

  session.retries = 0;

  if (outcome.outcome === 'goto') {
    session.step = outcome.nextStep;
  } else if (outcome.outcome === 'restart') {
    session.answers = { phone: session.from || '' };
    session.step = 'reason';
  } else if (outcome.outcome === 'next') {
    session.answers = outcome.answers;
    session.step = outcome.nextStep;
  } else if (outcome.outcome === 'done') {
    session.answers = outcome.answers;
    session.step = 'done';

    const ticket = await createTicket({
      ...session.answers,
      from: session.from,
      phone: session.answers.phone || session.from,
      priority: DEFAULT_TICKET_PRIORITY,
      source: 'simulazione',
      call: { sid: `SIM-${session.id}`, from: session.from, to: 'simulazione' }
    });

    session.ticketId = ticket.id;
  }

  return publicState(session);
}

const cleanup = setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);
if (typeof cleanup.unref === 'function') cleanup.unref();
