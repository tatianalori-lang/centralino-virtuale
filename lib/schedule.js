import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import * as store from './store.js';

const SCHEDULE_FILE = path.join(ROOT_DIR, 'data', 'schedule.json');

// Fasce orarie predefinite:
// - Lunedì-Venerdì 13:00-14:30 e 17:00-08:30 (giorno successivo): Centralino Virtuale
// - Sabato 13:00 - Lunedì 08:30: Centralino Virtuale
// - Tutto il resto (orario ufficio 08:30-13:00 e 14:30-17:00): Inoltro diretto
const DEFAULT_SCHEDULE = {
  enabled: true,
  timezone: config.timezone || 'Europe/Rome',
  slots: [
    // Lun-Ven pranzo
    { days: [1, 2, 3, 4, 5], start: '13:00', end: '14:30', mode: 'virtuale' },
    // Lun-Ven sera/notte fino al mattino dopo
    { days: [1, 2, 3, 4, 5], start: '17:00', end: '08:30', mode: 'virtuale', nextDay: true },
    // Sabato 13:00 -> Lunedì 08:30
    { days: [6], start: '13:00', end: '08:30', mode: 'virtuale', endDayOffset: 2 }
  ],
  defaultMode: 'inoltro'
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

function nowInTimezone(timezone, now = new Date()) {
  // Usa Intl per ottenere giorno/ora nella timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayName = get('weekday');
  const dayOfWeek = weekdayMap[dayName] ?? 0;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { dayOfWeek, minutesOfDay: hour * 60 + minute };
}

/**
 * Calcola la modalità che dovrebbe essere attiva in questo momento.
 * @returns {'virtuale'|'inoltro'|null}
 */
export function computeDesiredMode(schedule = loadSchedule(), now = new Date()) {
  if (!schedule.enabled) {
    // Se disabilitato, mantieni lo stato attuale (non forzare).
    return null;
  }

  const { dayOfWeek, minutesOfDay } = nowInTimezone(schedule.timezone, now);
  const weekMinutes = dayOfWeek * 1440 + minutesOfDay;

  for (const slot of schedule.slots) {
    const days = Array.isArray(slot.days) ? slot.days : [];
    const startMin = toMinutes(slot.start);
    const endMin = toMinutes(slot.end);
    const mode = slot.mode || 'inoltro';
    const dayOffset = slot.endDayOffset
      ? Number(slot.endDayOffset)
      : slot.nextDay
        ? 1
        : 0;

    for (const d of days) {
      const startDay = Number(d);
      if (!Number.isInteger(startDay) || startDay < 0 || startDay > 6) continue;
      const start = startDay * 1440 + startMin;
      const rawEnd = (startDay + dayOffset) * 1440 + endMin;
      const end = ((rawEnd % 10080) + 10080) % 10080;

      if (start < end) {
        if (weekMinutes >= start && weekMinutes < end) return mode;
      } else if (start > end) {
        if (weekMinutes >= start || weekMinutes < end) return mode;
      }
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