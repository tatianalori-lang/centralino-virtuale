const $ = (sel) => document.querySelector(sel);

const DAY_NAMES = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mer',
  4: 'Gio',
  5: 'Ven',
  6: 'Sab'
};

const state = {
  forward: null,
  schedule: null,
  voip: null,
  twilio: null,
  blacklist: []
};

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function renderStatus() {
  const f = state.forward || {};
  const v = state.voip || {};
  const isInoltro = f.mode === 'inoltro' || f.enabled;
  const strategy = f.voipStrategy === 'voip_first' ? 'voip_first' : 'ivr_first';

  $('#pbxModeVirtuale').classList.toggle('active', !isInoltro);
  $('#pbxModeInoltro').classList.toggle('active', isInoltro);
  $('#pbxModeVirtuale').setAttribute('aria-pressed', String(!isInoltro));
  $('#pbxModeInoltro').setAttribute('aria-pressed', String(isInoltro));
  $('#strategyWrap').classList.toggle('hidden', isInoltro);
  $('#inoltroDirectBanner').classList.toggle('hidden', !isInoltro);
  $('#stratIvrFirst').classList.toggle('active', !isInoltro && strategy === 'ivr_first');
  $('#stratVoipFirst').classList.toggle('active', !isInoltro && strategy === 'voip_first');

  $('#pbxForwardNumber').value = f.number || '';
  document.querySelectorAll('[data-target]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === String(f.number || '').trim());
  });

  $('#statMode').textContent = isInoltro ? 'Inoltro diretto' : 'Centralino Virtuale';
  $('#statModeHint').textContent = isInoltro
    ? 'Le chiamate saltano il Centralino Virtuale'
    : 'Le chiamate vengono gestite dal centralino virtuale';

  if (isInoltro) {
    $('#statStrategy').textContent = 'Squillo diretto';
    $('#statStrategyHint').textContent = 'Rispondono subito i telefoni senza Centralino Virtuale';
  } else {
    $('#statStrategy').textContent =
      strategy === 'voip_first'
        ? 'Prima interni 101–106'
        : 'Prima Centralino Virtuale';
    $('#statStrategyHint').textContent =
      strategy === 'voip_first'
        ? `Squillano prima i Yealink 101–106 (${v.dialTimeout || 25}s), poi Centralino Virtuale`
        : 'Prima Centralino Virtuale; Yealink 101–106 su "operatore" o Inoltro';
  }

  $('#statTarget').textContent = f.number || '100 (101–106)';

  $('#statVoip').textContent = v.ready ? 'Attivo' : 'Disattivo (solo IVR)';
  $('#statVoipHint').textContent = v.ready
    ? `Timeout squillo: ${v.dialTimeout}s`
    : 'Imposta VOIP_TRANSFER_ENABLED=true in .env sul VPS';

  const pill = $('#voipPill');
  pill.textContent = v.ready ? 'Bridge VoIP attivo' : 'VoIP trasferimento off';
  pill.classList.toggle('ok', Boolean(v.ready));

  const dest = String(f.number || '+390686358716').trim();
  const international = dest.startsWith('+') ? `00${dest.slice(1)}` : dest;
  $('#pbxTimCode').textContent = `*21*${international}#`;
  $('#pbxTimAlt').textContent = `Se il numero è interno VoIP (100 o 101–106), la deviazione TIM verso il centralino resta *21*00390686358716#.`;
}

function renderSchedule() {
  const s = state.schedule || {};
  $('#pbxScheduleEnabled').checked = Boolean(s.enabled);
  $('#pbxScheduleDefaultMode').value = s.defaultMode || 'virtuale';

  const currentMode = s.enabled
    ? `Attiva ora: ${
        s.currentDesiredMode === 'inoltro' ? 'Inoltro diretto' : 'Centralino Virtuale'
      }`
    : 'Programmazione disattivata (gestione manuale)';
  $('#pbxScheduleDesc').textContent = `${currentMode} · Fuso orario ${s.timezone || 'Europe/Rome'}.`;

  const container = $('#pbxScheduleSlots');
  const slots = s.slots || [];
  if (!slots.length) {
    container.innerHTML =
      '<div class="muted" style="font-size:13px">Nessuna fascia oraria configurata.</div>';
    return;
  }

  container.innerHTML = slots
    .map((slot, index) => {
      const days = (slot.days || []).map((d) => DAY_NAMES[d] ?? d).join(', ');
      let span = `${slot.start} → ${slot.end}`;
      if (slot.endDayOffset === 2) span += ' (+2 gg)';
      else if (slot.nextDay) span += ' (giorno dopo)';
      const mode = slot.mode || 'inoltro';
      return `<div class="schedule-slot">
        <span class="slot-days">${escapeHtml(days || 'Ogni giorno')}</span>
        <span class="slot-time">${escapeHtml(span)}</span>
        <span class="slot-mode ${escapeHtml(mode)}">${escapeHtml(
          mode === 'inoltro' ? 'Inoltro diretto' : 'Centralino Virtuale'
        )}</span>
        <button class="slot-remove" type="button" data-remove-slot="${index}" title="Rimuovi fascia">×</button>
      </div>`;
    })
    .join('');
}

async function loadAll() {
  try {
    const [forward, schedule, voip, twilio, bl] = await Promise.all([
      api('/api/modalita'),
      api('/api/schedule'),
      api('/api/voip/status'),
      api('/api/twilio/status'),
      api('/api/blacklist')
    ]);
    state.forward = forward;
    state.schedule = schedule;
    state.voip = voip;
    state.twilio = twilio;
    state.blacklist = bl.items || [];
    renderStatus();
    renderSchedule();
    renderBlacklist();
    $('#pbxSubtitle').textContent = `Aggiornato alle ${new Date().toLocaleTimeString('it-IT')}`;
  } catch (err) {
    toast(err.message, true);
  }
}

function renderBlacklist() {
  const container = $('#blacklistItems');
  const items = state.blacklist || [];
  if (!items.length) {
    container.innerHTML =
      '<div class="muted" style="font-size:13px">Nessun numero bloccato.</div>';
    return;
  }
  container.innerHTML = items
    .map((item) => {
      const when = item.createdAt
        ? new Date(item.createdAt).toLocaleDateString('it-IT')
        : '';
      return `<div class="schedule-slot">
        <span class="slot-days">${escapeHtml(item.number)}</span>
        <span class="slot-time">${escapeHtml(item.note || 'Bloccato')}${
          when ? ` · ${escapeHtml(when)}` : ''
        }</span>
        <button class="slot-remove" type="button" data-unblock-id="${escapeHtml(
          item.id
        )}" title="Sblocca numero">×</button>
      </div>`;
    })
    .join('');
}

async function addBlocked() {
  const number = $('#blNumber').value.trim();
  const note = $('#blNote').value.trim();
  if (!number) {
    toast('Inserisci un numero da bloccare', true);
    return;
  }
  try {
    const res = await api('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, note })
    });
    state.blacklist = res.items || [];
    $('#blNumber').value = '';
    $('#blNote').value = '';
    renderBlacklist();
    toast(`Numero ${res.item.number} bloccato`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeBlocked(id) {
  try {
    const res = await api(`/api/blacklist/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    state.blacklist = res.items || [];
    renderBlacklist();
    toast('Numero rimosso dai bloccati');
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateModalita(payload, successMsg) {
  try {
    state.forward = await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    renderStatus();
    toast(successMsg);
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveSchedule() {
  try {
    const s = state.schedule || { slots: [] };
    const enabled = $('#pbxScheduleEnabled').checked;
    const defaultMode = $('#pbxScheduleDefaultMode').value;
    const slots = s.slots || [];

    state.schedule = await api('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, defaultMode, slots })
    });
    renderSchedule();
    const allSame =
      enabled && slots.length > 0 && slots.every((sl) => (sl.mode || 'inoltro') === defaultMode);
    if (allSame) {
      toast('Attenzione: tutte le fasce e "Fuori fascia" hanno la stessa modalità', true);
    } else {
      toast('Programmazione oraria salvata');
    }
    await loadAll();
  } catch (err) {
    toast(err.message, true);
  }
}

function addSlot(slot) {
  if (!state.schedule) state.schedule = { enabled: true, defaultMode: 'virtuale', slots: [] };
  state.schedule.slots = [...(state.schedule.slots || []), slot];
  renderSchedule();
  toast('Fascia aggiunta. Premi "Salva programma orario" per applicare.');
}

function bindEvents() {
  $('#reloadAllBtn').addEventListener('click', loadAll);

  $('#pbxModeVirtuale').addEventListener('click', () =>
    updateModalita(
      { mode: 'virtuale', voipStrategy: 'ivr_first' },
      'Centralino Virtuale attivo (prima Centralino Virtuale, poi interni 101–106)'
    )
  );
  $('#pbxModeInoltro').addEventListener('click', () =>
    updateModalita(
      { mode: 'inoltro', number: $('#pbxForwardNumber').value.trim() || '100' },
      'Modalità Inoltro diretto attiva'
    )
  );

  $('#stratIvrFirst').addEventListener('click', () =>
    updateModalita(
      { voipStrategy: 'ivr_first' },
      'Ordine: prima inoltro a Centralino Virtuale, poi interni 101–106'
    )
  );
  $('#stratVoipFirst').addEventListener('click', () =>
    updateModalita(
      { voipStrategy: 'voip_first' },
      'Ordine: prima interni 101–106, poi inoltro a Centralino Virtuale'
    )
  );

  document.querySelectorAll('[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      $('#pbxForwardNumber').value = target;
      updateModalita({ number: target }, `Destinazione salvata: ${target}`);
    });
  });

  $('#pbxSaveTarget').addEventListener('click', () => {
    const num = $('#pbxForwardNumber').value.trim();
    updateModalita({ number: num }, `Destinazione salvata: ${num || 'default'}`);
  });

  $('#pbxCopyTim').addEventListener('click', async () => {
    const code = $('#pbxTimCode').textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      toast(`Copiato ${code}`);
    } catch {
      toast('Impossibile copiare negli appunti', true);
    }
  });

  $('#pbxDayPills').addEventListener('click', (event) => {
    const pill = event.target.closest('.day-pill');
    if (pill) pill.classList.toggle('active');
  });

  $('#pbxSlotAdd').addEventListener('click', () => {
    const days = [...document.querySelectorAll('#pbxDayPills .day-pill.active')].map((el) =>
      Number(el.dataset.day)
    );
    if (!days.length) {
      toast('Seleziona almeno un giorno', true);
      return;
    }
    const start = $('#pbxSlotStart').value;
    const end = $('#pbxSlotEnd').value;
    if (!start || !end) {
      toast('Inserisci ora di inizio e fine', true);
      return;
    }
    addSlot({
      days,
      start,
      end,
      mode: $('#pbxSlotMode').value,
      nextDay: $('#pbxSlotNextDay').checked
    });
  });

  $('#presetLunch').addEventListener('click', () =>
    addSlot({ days: [1, 2, 3, 4, 5], start: '13:00', end: '14:30', mode: $('#pbxSlotMode').value })
  );
  $('#presetEvening').addEventListener('click', () =>
    addSlot({
      days: [1, 2, 3, 4, 5],
      start: '17:00',
      end: '08:30',
      mode: $('#pbxSlotMode').value,
      nextDay: true
    })
  );
  $('#presetWeekend').addEventListener('click', () =>
    addSlot({
      days: [6],
      start: '13:00',
      end: '08:30',
      mode: $('#pbxSlotMode').value,
      endDayOffset: 2
    })
  );

  $('#pbxScheduleSlots').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-remove-slot]');
    if (!btn || !state.schedule) return;
    const idx = Number(btn.dataset.removeSlot);
    state.schedule.slots = state.schedule.slots.filter((_, i) => i !== idx);
    renderSchedule();
    toast('Fascia rimossa. Premi "Salva programma orario" per applicare.');
  });

  $('#pbxScheduleSave').addEventListener('click', saveSchedule);

  $('#blAddBtn').addEventListener('click', addBlocked);
  $('#blacklistItems').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-unblock-id]');
    if (btn) removeBlocked(btn.dataset.unblockId);
  });
}

bindEvents();
loadAll();
setInterval(() => {
  if (!document.hidden && !['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) {
    loadAll();
  }
}, 15000);
