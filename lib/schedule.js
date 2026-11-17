import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import * as store from './store.js';

const SCHEDULE_FILE = path.join(ROOT_DIR, 'data', 'schedule.json');

// Fasce orarie predefinite:
// - Lunedì-Venerdì 13:00-14:30 e 17:00-08:30 (giorno successivo): Inoltro
// - Sabato 13:00 - Lunedì 08:30: Inoltro
// - Tutto il resto: Virtuale
const DEFAULT_SCHEDULE = {
  enabled: true,
  timezone: config.timezone || 'Europe/Rome',
  slots: [
    // Lun-Ven pranzo
    { days: [1, 2, 3, 4, 5], start: '13:00', end: '14:30', mode: 'inoltro' },
    // Lun-Ven sera/notte fino al mattino dopo
    { days: [1, 2, 3, 4, 5], start: '17:00', end: '08:30', mode: 'inoltro', nextDay: true },
    // Sabato 13:00 -> Lunedì 08:30
    { days: [6], start: '13:00', end: '08:30', mode: 'inoltro', endDayOffset: 2 }
  ],
  defaultMode: 'virtuale'
};

function ensureFile() {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) {
      fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(DEFAULT_SCHEDULE, null, 2), 'utf8');
    }
  } catch (err) {
    console.error(`[Schedule] errore creazione file: ${err.message}`);
  }
}

export function loadSchedule() {
  ensureFile();
  try {
    const raw = fs.readFileSync(SCHEDULE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      timezone: parsed.timezone || config.timezone || 'Europe/Rome',
      slots: Array.isArray(parsed.slots) ? parsed.slots : DEFAULT_SCHEDULE.slots,
      defaultMode: parsed.defaultMode || 'virtuale'
    };
  } catch (err) {
    console.error(`[Schedule] errore lettura: ${err.message}`);
    return { ...DEFAULT_SCHEDULE };
  }
}

export async function saveSchedule(schedule) {
  ensureFile();
  const data = {
    enabled: schedule.enabled !== false,
    timezone: schedule.timezone || config.timezone || 'Europe/Rome',
    slots: Array.isArray(schedule.slots) ? schedule.slots : [],
    defaultMode: schedule.defaultMode || 'virtuale'
  };
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function toMinutes(timeStr) {
  const [h, m] = String(timeStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nowInTimezone(timezone) {
  const now = new Date();
  // Usa Intl per ottenere giorno/ora nella timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayName = get('weekday');
  const dayOfWeek = weekdayMap[dayName] ?? 0;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return { dayOfWeek, minutesOfDay: hour * 60 + minute };
}

/**
 * Calcola la modalità che dovrebbe essere attiva in questo momento.
 * @returns {'virtuale'|'inoltro'}
 */
export function computeDesiredMode(schedule = loadSchedule()) {
  if (!schedule.enabled) {
    // Se disabilitato, mantieni lo stato attuale (non forzare).
    return null;
  }

  const { dayOfWeek, minutesOfDay } = nowInTimezone(schedule.timezone);
  const weekMinutes = dayOfWeek * 1440 + minutesOfDay;

  for (const slot of schedule.slots) {
    const days = Array.isArray(slot.days) ? slot.days : [];
    if (!days.includes(dayOfWeek) && !slot.nextDay && !slot.endDayOffset) {
      // Per fasce che iniziano in un giorno diverso, gestiamo sotto.
    }

    const startMin = toMinutes(slot.start);
    const endMin = toMinutes(slot.end);
    const mode = slot.mode || 'inoltro';

    // Calcola l'intervallo in minuti dalla settimana.
    // Caso 1: fascia nello stesso giorno (start < end, no nextDay)
    if (!slot.nextDay && !slot.endDayOffset) {
      if (!days.includes(dayOfWeek)) continue;
      const start = dayOfWeek * 1440 + startMin;
      const end = dayOfWeek * 1440 + endMin;
      if (weekMinutes >= start && weekMinutes < end) return mode;
      continue;
    }

    // Caso 2: fascia che va al giorno successivo (nextDay: true)
    if (slot.nextDay) {
      if (!days.includes(dayOfWeek)) continue;
      const start = dayOfWeek * 1440 + startMin;
      const end = (dayOfWeek + 1) * 1440 + endMin;
      // Gestisci wrap settimanale
      const s = start;
      let e = end;
      if (e >= 10080) e -= 10080;
      if (s < e) {
        if (weekMinutes >= s && weekMinutes < e) return mode;
      } else {
        if (weekMinutes >= s || weekMinutes < e) return mode;
      }
      continue;
    }

    // Caso 3: fascia con offset di giorni (endDayOffset)
    if (slot.endDayOffset) {
      if (!days.includes(dayOfWeek)) continue;
      const start = dayOfWeek * 1440 + startMin;
      const end = (dayOfWeek + slot.endDayOffset) * 1440 + endMin;
      let e = end;
      if (e >= 10080) e -= 10080 * Math.floor(e / 10080);
      // Semplificazione: gestisci solo wrap singolo
      if (e < 0) e += 10080;
      if (start < e) {
        if (weekMinutes >= start && weekMinutes < e) return mode;
      } else {
        if (weekMinutes >= start || weekMinutes < e) return mode;
      }
      continue;
    }
  }

  return schedule.defaultMode || 'virtuale';
}

let timer = null;

export function startScheduler(onChange) {
  if (timer) return timer;
  const tick = async () => {
    try {
      const schedule = loadSchedule();
      if (!schedule.enabled) return;
      const desired = computeDesiredMode(schedule);
      if (!desired) return;
      const current = store.getForwardSettings();
      const currentMode = current.enabled ? 'inoltro' : 'virtuale';
      if (desired !== currentMode) {
        await store.updateForwardSettings({ enabled: desired === 'inoltro' });
        console.log(`[Schedule] modalità cambiata automaticamente: ${desired}`);
        if (typeof onChange === 'function') onChange(desired);
      }
    } catch (err) {
      console.error(`[Schedule] errore: ${err.message}`);
    }
  };
  timer = setInterval(tick, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  // Esegui subito al avvio
  tick();
  return timer;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}