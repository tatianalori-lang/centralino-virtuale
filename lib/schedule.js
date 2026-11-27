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
  holidaysVirtuale: true,
  customHolidays: [],
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

const FIXED_ITALIAN_HOLIDAYS = {
  '01-01': 'Capodanno',
  '01-06': 'Epifania',
  '04-25': 'Festa della Liberazione',
  '05-01': 'Festa dei Lavoratori',
  '06-02': 'Festa della Repubblica',
  '06-29': 'Santi Pietro e Paolo (Roma)',
  '08-15': 'Ferragosto',
  '11-01': 'Ognissanti',
  '12-08': 'Immacolata Concezione',
  '12-25': 'Natale',
  '12-26': 'Santo Stefano'
};

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

export function normalizeCustomHolidays(list) {
  const arr = Array.isArray(list)
    ? list
    : String(list || '')
        .split(/[\s,;]+/)
        .filter(Boolean);
  const out = [];
  for (const raw of arr) {
    const s = String(raw || '').trim();
    if (!s) continue;
    // Accetta DD/MM, DD-MM, MM-DD (solo se unambiguous) o YYYY-MM-DD / DD/MM/YYYY
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      out.push(`${m[1]}-${m[2]}-${m[3]}`);
    } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
      out.push(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) {
      out.push(`${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    } else if ((m = s.match(/^(\d{2})-(\d{2})$/))) {
      out.push(`${m[1]}-${m[2]}`);
    }
  }
  return [...new Set(out)];
}

export function getItalianHolidayName(year, month, day, customHolidays = []) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const mmdd = `${mm}-${dd}`;
  const yyyymmdd = `${year}-${mm}-${dd}`;

  if (FIXED_ITALIAN_HOLIDAYS[mmdd]) return FIXED_ITALIAN_HOLIDAYS[mmdd];

  const easter = easterSunday(year);
  if (month === easter.month && day === easter.day) return 'Pasqua';
  const pasquetta = new Date(Date.UTC(year, easter.month - 1, easter.day + 1));
  if (
    month === pasquetta.getUTCMonth() + 1 &&
    day === pasquetta.getUTCDate()
  ) {
    return "Lunedì dell'Angelo (Pasquetta)";
  }

  const custom = normalizeCustomHolidays(customHolidays);
  if (custom.includes(yyyymmdd) || custom.includes(mmdd)) {
    return 'Giorno festivo personalizzato';
  }
  return null;
}

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
      holidaysVirtuale: parsed.holidaysVirtuale !== false,
      customHolidays: normalizeCustomHolidays(parsed.customHolidays),
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
  const prev = loadSchedule();
  const data = {
    enabled: schedule.enabled !== undefined ? schedule.enabled !== false : prev.enabled,
    timezone: schedule.timezone || prev.timezone || config.timezone || 'Europe/Rome',
    holidaysVirtuale:
      schedule.holidaysVirtuale !== undefined
        ? schedule.holidaysVirtuale !== false
        : prev.holidaysVirtuale !== false,
    customHolidays:
      schedule.customHolidays !== undefined
        ? normalizeCustomHolidays(schedule.customHolidays)
        : prev.customHolidays,
    slots: Array.isArray(schedule.slots) ? schedule.slots : prev.slots,
    defaultMode: schedule.defaultMode || prev.defaultMode || 'virtuale'
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
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { year, month, day, dayOfWeek, minutesOfDay: hour * 60 + minute };
}

export function getActiveHoliday(schedule = loadSchedule(), now = new Date()) {
  if (schedule.holidaysVirtuale === false) return null;
  const { year, month, day } = nowInTimezone(schedule.timezone, now);
  return getItalianHolidayName(year, month, day, schedule.customHolidays);
}

const WEEKDAY_LONG = [
  'Domenica',
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato'
];

export function listUpcomingHolidays(
  schedule = loadSchedule(),
  { from = new Date(), daysAhead = 400 } = {}
) {
  const tz = schedule.timezone || config.timezone || 'Europe/Rome';
  const start = nowInTimezone(tz, from);
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const items = [];
  const customSet = new Set(normalizeCustomHolidays(schedule.customHolidays));

  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const d = new Date(startUtc + offset * 86400000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const name = getItalianHolidayName(y, m, day, schedule.customHolidays);
    if (!name) continue;
    const mm = String(m).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    items.push({
      date: `${y}-${mm}-${dd}`,
      dateLabel: `${dd}/${mm}/${y}`,
      weekday: WEEKDAY_LONG[d.getUTCDay()],
      name,
      custom: customSet.has(`${y}-${mm}-${dd}`) || customSet.has(`${mm}-${dd}`),
      isToday: offset === 0
    });
  }
  return items;
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

  const { year, month, day, dayOfWeek, minutesOfDay } = nowInTimezone(schedule.timezone, now);
  if (
    schedule.holidaysVirtuale !== false &&
    getItalianHolidayName(year, month, day, schedule.customHolidays)
  ) {
    return 'virtuale';
  }
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